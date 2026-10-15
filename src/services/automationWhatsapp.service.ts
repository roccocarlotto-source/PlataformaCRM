import { AppError } from "../utils/AppError";
import { baseDeLaApiPublica } from "../utils/qrImage";
import { formatoLlevaImagen } from "../utils/whatsappTemplateText";
import { mensajeDeLaRegla } from "./automationActions/mensajeDeWhatsapp";
import {
  createAutomation,
  getAutomationById,
  listAutomations,
  updateAutomation,
  type CreateAutomationInput,
  type ListAutomationsParams,
  type UpdateAutomationInput,
} from "./automation.service";
import {
  depsDePlantillasReales,
  esAccionConPlantilla,
  getAprobacionDeLaRegla,
  getAprobacionesDeLasReglas,
  sincronizarPlantillaDeLaRegla,
  type DepsDePlantillas,
  type ResumenDeAprobacion,
} from "./whatsappTemplate.service";
import {
  SIN_ERROR_DE_SINCRONIZACION,
  resumenDeSincronizacion,
  type EstadoDeSincronizacion,
  type EstadoGuardadoDeSincronizacion,
} from "./whatsappTemplateReintento";
import { updateEstadoDeSincronizacion } from "../repositories/automation.repository";
import { wabaPropioDe } from "./whatsappConexion.service";

// ---------------------------------------------------------------------------
// La regla y su plantilla de WhatsApp, juntas. Lo que la pantalla de
// automatizaciones guarda y lee pasa por acá para que el negocio no tenga que
// pensar en la plantilla: al guardar una regla que manda WhatsApp, la
// plantilla de Meta se crea o se reemplaza sola (sincronizarPlantillaDeLaRegla),
// y al leerla vuelve con un único estado de aprobación.
//
// automation.service.ts no sabe nada de esto a propósito: es el CRUD de la
// regla y no habla con Meta. Esto lo envuelve.
// ---------------------------------------------------------------------------

export interface DepsDeReglaConMensaje {
  plantillas: DepsDePlantillas;
  // El origen público del backend (utils/qrImage.ts). Sin él no hay imagen.
  baseDeLaApi: () => string | undefined;
}

export const depsDeReglaConMensajeReales: DepsDeReglaConMensaje = {
  plantillas: depsDePlantillasReales,
  baseDeLaApi: () => baseDeLaApiPublica(),
};

// Una imagen sin URL pública desde donde Meta la baje no se puede mandar. Se
// frena ANTES de guardar: guardar la regla con un formato que nunca va a
// poder salir sería peor que un 400.
function assertFormatoDisponible(
  actionType: string,
  actionConfig: unknown,
  deps: DepsDeReglaConMensaje,
): void {
  if (!esAccionConPlantilla(actionType)) return;
  if (!formatoLlevaImagen(mensajeDeLaRegla(actionConfig).formato)) return;
  if (!deps.baseDeLaApi()) {
    throw new AppError(
      'La imagen del QR todavía no está disponible en esta instalación. Elegí "Solo link" o avisale al soporte.',
      400,
    );
  }
}

// Decisión de Rocco del 2026-10-12 (docs/whatsapp-alta-clinica.md): una
// clínica usa SU número, así que sin WABA propio no activa una regla que manda
// una plantilla, y ni siquiera se sincroniza con Meta (se crearía en el WABA
// global, desde donde sus números no pueden mandarla). Una inactiva se guarda
// igual, sin plantilla. Una automotora sigue con el WABA global, como hoy.
export const CONECTA_EL_NUMERO_DE_LA_CLINICA = "Conectá el número de WhatsApp de la clínica";

const SIN_PLANTILLA_HASTA_CONECTAR =
  "La plantilla se manda a aprobación cuando la clínica tenga su número de WhatsApp conectado.";

async function clinicaSinWabaPropio(
  organizationId: string,
  actionType: string,
  deps: DepsDeReglaConMensaje,
): Promise<boolean> {
  if (!esAccionConPlantilla(actionType)) return false;
  const rubro = deps.plantillas.rubroDe
    ? await deps.plantillas.rubroDe(organizationId)
    : "AUTOMOTORA";
  if (rubro !== "CLINICA") return false;
  return (await wabaPropioDe(organizationId, deps.plantillas)) === null;
}

type ReglaGuardada = Awaited<ReturnType<typeof getAutomationById>>;

// H-1: las columnas del reintento no viajan crudas; la pantalla recibe su
// resumen (whatsappSync).
type ReglaSinSincronizacion = Omit<ReglaGuardada, keyof EstadoGuardadoDeSincronizacion>;

function separarSincronizacion<T extends EstadoGuardadoDeSincronizacion>(regla: T) {
  const {
    templateSyncAttempts,
    templateSyncNextAt,
    templateSyncError,
    templateSyncErrorKind,
    ...resto
  } = regla;
  return {
    resto,
    sincronizacion: resumenDeSincronizacion({
      templateSyncAttempts,
      templateSyncNextAt,
      templateSyncError,
      templateSyncErrorKind,
    }),
  };
}

export type ReglaConAprobacion = ReglaSinSincronizacion & {
  // H-1: si el último intento de mandar la plantilla a Meta falló, por qué y
  // si se reintenta sola. Null sin error (o si la regla no manda WhatsApp).
  whatsappSync: EstadoDeSincronizacion | null;
  // Null para una regla que no manda WhatsApp.
  whatsappApproval: ResumenDeAprobacion | null;
  // Solo al guardar: por qué no se pudo mandar la versión nueva a Meta. La
  // regla quedó guardada igual.
  whatsappSyncError?: string | null;
};

async function conSincronizacion(
  organizationId: string,
  regla: ReglaGuardada,
  deps: DepsDeReglaConMensaje,
): Promise<ReglaConAprobacion> {
  const { resto } = separarSincronizacion(regla);
  if (!esAccionConPlantilla(regla.actionType)) {
    // Una regla que dejó de mandar WhatsApp no tiene nada que reintentar.
    if (regla.templateSyncError !== null || regla.templateSyncNextAt !== null) {
      await updateEstadoDeSincronizacion(regla.id, organizationId, SIN_ERROR_DE_SINCRONIZACION);
    }
    return { ...resto, whatsappApproval: null, whatsappSync: null };
  }
  const { aprobacion, error, sincronizacion } = await sincronizarPlantillaDeLaRegla(
    organizationId,
    regla,
    deps.plantillas,
    { reiniciar: true },
  );
  return {
    ...resto,
    whatsappApproval: aprobacion,
    whatsappSync: sincronizacion,
    whatsappSyncError: error,
  };
}

// Una regla de clínica guardada sin WABA propio: sin llamar a Meta, con el
// estado de lo que ya tenga y el motivo para la pantalla.
async function sinSincronizar(
  organizationId: string,
  regla: ReglaGuardada,
): Promise<ReglaConAprobacion> {
  const { resto, sincronizacion } = separarSincronizacion(regla);
  return {
    ...resto,
    whatsappApproval: await getAprobacionDeLaRegla(organizationId, regla.id),
    whatsappSync: sincronizacion,
    whatsappSyncError: SIN_PLANTILLA_HASTA_CONECTAR,
  };
}

export async function crearReglaConMensaje(
  organizationId: string,
  input: CreateAutomationInput,
  deps: DepsDeReglaConMensaje = depsDeReglaConMensajeReales,
): Promise<ReglaConAprobacion> {
  assertFormatoDisponible(input.actionType, input.actionConfig, deps);
  if (await clinicaSinWabaPropio(organizationId, input.actionType, deps)) {
    if (input.isActive ?? true) throw new AppError(CONECTA_EL_NUMERO_DE_LA_CLINICA, 409);
    const regla = await createAutomation(organizationId, input);
    return sinSincronizar(organizationId, regla);
  }
  const regla = await createAutomation(organizationId, input);
  return conSincronizacion(organizationId, regla, deps);
}

export async function actualizarReglaConMensaje(
  organizationId: string,
  id: string,
  input: UpdateAutomationInput,
  deps: DepsDeReglaConMensaje = depsDeReglaConMensajeReales,
): Promise<ReglaConAprobacion> {
  const existente = await getAutomationById(organizationId, id);
  const actionType = input.actionType ?? existente.actionType;
  if (input.actionConfig !== undefined || input.actionType !== undefined) {
    assertFormatoDisponible(actionType, input.actionConfig ?? existente.actionConfig, deps);
  }
  if (await clinicaSinWabaPropio(organizationId, actionType, deps)) {
    if (input.isActive ?? existente.isActive) {
      throw new AppError(CONECTA_EL_NUMERO_DE_LA_CLINICA, 409);
    }
    const regla = await updateAutomation(organizationId, id, input);
    return sinSincronizar(organizationId, regla);
  }
  const regla = await updateAutomation(organizationId, id, input);
  return conSincronizacion(organizationId, regla, deps);
}

export async function obtenerReglaConAprobacion(
  organizationId: string,
  id: string,
): Promise<ReglaConAprobacion> {
  const regla = await getAutomationById(organizationId, id);
  const { resto, sincronizacion } = separarSincronizacion(regla);
  const conPlantilla = esAccionConPlantilla(regla.actionType);
  return {
    ...resto,
    whatsappApproval: conPlantilla ? await getAprobacionDeLaRegla(organizationId, regla.id) : null,
    whatsappSync: conPlantilla ? sincronizacion : null,
  };
}

// H-1: "Reintentar" en la pantalla de la regla. Vuelve a mandar la plantilla
// a Meta ahora, con la cuenta de intentos automáticos en cero. Las mismas
// reglas que guardar: una clínica sin su número conectado no sincroniza.
export async function reintentarPlantillaDeLaRegla(
  organizationId: string,
  id: string,
  deps: DepsDeReglaConMensaje = depsDeReglaConMensajeReales,
): Promise<ReglaConAprobacion> {
  const regla = await getAutomationById(organizationId, id);
  if (!esAccionConPlantilla(regla.actionType)) {
    throw new AppError("Esta regla no manda WhatsApp.", 400);
  }
  if (await clinicaSinWabaPropio(organizationId, regla.actionType, deps)) {
    throw new AppError(CONECTA_EL_NUMERO_DE_LA_CLINICA, 409);
  }
  return conSincronizacion(organizationId, regla, deps);
}

// H-1: el reintento del worker (workers/plantillaReintentoWorker.ts). Sigue la
// cuenta de intentos. Una regla que ya no manda WhatsApp, o una clínica que se
// quedó sin su número, deja de reintentar.
export async function reintentoAutomaticoDeLaPlantilla(
  regla: { id: string; organizationId: string; actionType: string; actionConfig: unknown },
  deps: DepsDeReglaConMensaje = depsDeReglaConMensajeReales,
): Promise<EstadoDeSincronizacion | null> {
  if (
    !esAccionConPlantilla(regla.actionType) ||
    (await clinicaSinWabaPropio(regla.organizationId, regla.actionType, deps))
  ) {
    await updateEstadoDeSincronizacion(regla.id, regla.organizationId, SIN_ERROR_DE_SINCRONIZACION);
    return null;
  }
  const { sincronizacion } = await sincronizarPlantillaDeLaRegla(
    regla.organizationId,
    regla,
    deps.plantillas,
    { reiniciar: false },
  );
  return sincronizacion;
}

// El listado, con el estado de aprobación de las reglas que mandan WhatsApp
// (null en las demás). Una sola query de plantillas para toda la página.
export async function listarReglasConAprobacion(
  organizationId: string,
  params: ListAutomationsParams,
) {
  const pagina = await listAutomations(organizationId, params);
  const conPlantilla = pagina.data.filter((r) => esAccionConPlantilla(r.actionType));
  const aprobaciones = await getAprobacionesDeLasReglas(
    organizationId,
    conPlantilla.map((r) => r.id),
  );
  return {
    ...pagina,
    data: pagina.data.map((r) => {
      const { resto, sincronizacion } = separarSincronizacion(r);
      const conPlantilla = esAccionConPlantilla(r.actionType);
      return {
        ...resto,
        whatsappApproval: aprobaciones.get(r.id) ?? null,
        whatsappSync: conPlantilla ? sincronizacion : null,
      };
    }),
  };
}
