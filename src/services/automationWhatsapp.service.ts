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

type ReglaGuardada = Awaited<ReturnType<typeof getAutomationById>>;

export type ReglaConAprobacion = ReglaGuardada & {
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
  if (!esAccionConPlantilla(regla.actionType)) {
    return { ...regla, whatsappApproval: null };
  }
  const { aprobacion, error } = await sincronizarPlantillaDeLaRegla(
    organizationId,
    regla,
    deps.plantillas,
  );
  return { ...regla, whatsappApproval: aprobacion, whatsappSyncError: error };
}

export async function crearReglaConMensaje(
  organizationId: string,
  input: CreateAutomationInput,
  deps: DepsDeReglaConMensaje = depsDeReglaConMensajeReales,
): Promise<ReglaConAprobacion> {
  assertFormatoDisponible(input.actionType, input.actionConfig, deps);
  const regla = await createAutomation(organizationId, input);
  return conSincronizacion(organizationId, regla, deps);
}

export async function actualizarReglaConMensaje(
  organizationId: string,
  id: string,
  input: UpdateAutomationInput,
  deps: DepsDeReglaConMensaje = depsDeReglaConMensajeReales,
): Promise<ReglaConAprobacion> {
  if (input.actionConfig !== undefined || input.actionType !== undefined) {
    const existente = await getAutomationById(organizationId, id);
    assertFormatoDisponible(
      input.actionType ?? existente.actionType,
      input.actionConfig ?? existente.actionConfig,
      deps,
    );
  }
  const regla = await updateAutomation(organizationId, id, input);
  return conSincronizacion(organizationId, regla, deps);
}

export async function obtenerReglaConAprobacion(
  organizationId: string,
  id: string,
): Promise<ReglaConAprobacion> {
  const regla = await getAutomationById(organizationId, id);
  return {
    ...regla,
    whatsappApproval: esAccionConPlantilla(regla.actionType)
      ? await getAprobacionDeLaRegla(organizationId, regla.id)
      : null,
  };
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
    data: pagina.data.map((r) => ({ ...r, whatsappApproval: aprobaciones.get(r.id) ?? null })),
  };
}
