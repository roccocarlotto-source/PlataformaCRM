import { Prisma, WhatsappTemplateStatus } from "@prisma/client";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import {
  discardWhatsappTemplateReservation,
  findActiveWhatsappTemplate,
  findPublicWhatsappTemplateById,
  findWhatsappTemplateById,
  isWhatsappTemplateNameTaken,
  reserveWhatsappTemplate,
  setWhatsappTemplateMetaId,
  setWhatsappTemplateStatus,
  setWhatsappTemplateStatusByMetaId,
  softDeleteWhatsappTemplate,
  type EstadoDePlantilla,
  type WhatsappTemplatePublica,
} from "../repositories/whatsappTemplate.repository";
import { AppError } from "../utils/AppError";
import {
  EJEMPLO_LINK,
  EJEMPLO_NOMBRE,
  textoParaMeta,
  validarTextoDePlantilla,
} from "../utils/whatsappTemplateText";
import { esTransitorio } from "./llmProvider.service";
import {
  createWhatsappTemplateReal,
  deleteWhatsappTemplateReal,
  getWhatsappTemplateStatusReal,
  mensajeDeMeta,
  WhatsappGraphError,
  type CreateWhatsappTemplate,
  type DeleteWhatsappTemplate,
  type GetWhatsappTemplateStatus,
} from "./whatsappGraph.service";

// ---------------------------------------------------------------------------
// La plantilla de seguimiento post-venta de cada organización (ítem 160 de
// docs/frontend-cambios-pendientes.md): el negocio la arma desde el CRM y
// esto la da de alta, la consulta y la borra en Meta, sobre el WABA
// compartido (WHATSAPP_BUSINESS_ACCOUNT_ID).
//
// EL ALTA RESERVA ANTES DE HABLAR CON META. La fila se crea primero —en
// PENDING, sin metaTemplateId— y recién después se llama a Meta. Así los dos
// UNIQUE parciales de la migración (una activa por organización, nombre único
// en la tabla) frenan un alta duplicada ANTES de que llegue a Meta: al revés,
// dos altas concurrentes crearían dos plantillas en Meta y una quedaría
// huérfana allá. Si Meta rechaza el alta, la reserva se descarta (borrado
// físico: la plantilla no llegó a existir). Si el proceso muere entre que Meta
// la aceptó y guardar su id, la fila queda PENDING sin metaTemplateId: no se
// puede refrescar, pero sí borrar, porque el DELETE de Meta va por nombre.
//
// ESTADO: EL DE META, NO EL NUESTRO. El CRM no decide si una plantilla está
// aprobada: lo lee del webhook message_template_status_update o del refresh a
// mano, y lo traduce a tres estados con estadoLocalDeMeta.
//
// Las llamadas a Meta se inyectan (DepsDePlantillas), mismo criterio que los
// workers: producción usa las *Real, los tests un doble.
// ---------------------------------------------------------------------------

export interface DepsDePlantillas {
  wabaId: () => string | undefined;
  accessToken: () => string | undefined;
  create: CreateWhatsappTemplate;
  delete: DeleteWhatsappTemplate;
  getStatus: GetWhatsappTemplateStatus;
}

export const depsDePlantillasReales: DepsDePlantillas = {
  wabaId: () => env.WHATSAPP_BUSINESS_ACCOUNT_ID,
  accessToken: () => env.WHATSAPP_ACCESS_TOKEN,
  create: createWhatsappTemplateReal,
  delete: deleteWhatsappTemplateReal,
  getStatus: getWhatsappTemplateStatusReal,
};

const MENSAJE_SIN_CONEXION =
  "La conexión con WhatsApp no está configurada en la plataforma. Avisale al soporte.";

// Sin WABA o sin token, ninguna operación con Meta tiene sentido. 503
// operacional con un mensaje para el negocio (no es un error suyo y no lo
// puede arreglar), y el nombre de la variable que falta en el log, que es
// donde lo busca quien sí lo puede arreglar. El string vacío cuenta como
// ausente, igual que en el worker.
function leerConexion(deps: Pick<DepsDePlantillas, "wabaId" | "accessToken">) {
  const wabaId = deps.wabaId()?.trim();
  const accessToken = deps.accessToken()?.trim();
  if (!wabaId || !accessToken) {
    logger.error(
      {
        faltan: [
          ...(wabaId ? [] : ["WHATSAPP_BUSINESS_ACCOUNT_ID"]),
          ...(accessToken ? [] : ["WHATSAPP_ACCESS_TOKEN"]),
        ],
      },
      "Plantilla de WhatsApp: falta configuración de la conexión con Meta",
    );
    throw new AppError(MENSAJE_SIN_CONEXION, 503);
  }
  return { wabaId, accessToken };
}

// Pura: el estado de Meta -> el estado local. Meta tiene muchos más (ver el
// enum WhatsappTemplateStatus en schema.prisma); al CRM le importa si se puede
// mandar o no, y si no, por qué.
//
// - APPROVED, y REINSTATED (volvió a estar activa después de una pausa):
//   APPROVED. FLAGGED también: Meta la marcó por calidad pero SIGUE
//   aceptando envíos hasta que la pause, y si la pausa llega otro evento.
// - PENDING e IN_APPEAL (el negocio apeló un rechazo): PENDING.
// - Todo lo demás —REJECTED, PAUSED, DISABLED, DELETED, un estado nuevo que
//   Meta invente—: REJECTED, con el motivo. Un estado desconocido no manda:
//   ante la duda, no se le escribe al cliente con una plantilla que Meta
//   podría no aceptar.
//
// "NONE" es lo que Meta pone en `reason` cuando no hay motivo: cuenta como
// ausente.
export function estadoLocalDeMeta(estadoMeta: string, motivo?: string | null): EstadoDePlantilla {
  const estado = estadoMeta.trim().toUpperCase();
  const recortado = motivo?.trim();
  const razon = recortado && recortado.toUpperCase() !== "NONE" ? recortado : null;
  if (estado === "APPROVED" || estado === "REINSTATED" || estado === "FLAGGED") {
    return { status: WhatsappTemplateStatus.APPROVED, rejectedReason: null };
  }
  if (estado === "PENDING" || estado === "IN_APPEAL") {
    return { status: WhatsappTemplateStatus.PENDING, rejectedReason: null };
  }
  if (estado === "REJECTED") {
    return {
      status: WhatsappTemplateStatus.REJECTED,
      rejectedReason: razon ?? "Meta la rechazó sin dar un motivo",
    };
  }
  return {
    status: WhatsappTemplateStatus.REJECTED,
    rejectedReason: `Meta la dejó en estado ${estado}${razon ? ` (${razon})` : ""}`,
  };
}

// Pura: ¿el error de Meta dice que la plantilla ya no existe allá? Al borrar,
// eso no es un fallo — alguien la borró desde el WhatsApp Manager, o es una
// reserva cuyo alta nunca llegó — y se sigue con la baja local. Meta no
// documenta un código estable para "no existe"; se reconoce el 404 y el
// mensaje, y todo lo demás sigue siendo error.
export function esPlantillaInexistenteEnMeta(err: unknown): boolean {
  if (!(err instanceof WhatsappGraphError)) {
    return false;
  }
  if (err.status === 404) {
    return true;
  }
  const mensaje = mensajeDeMeta(err) ?? err.detalle;
  return err.status === 400 && /not found|does not exist|no existe/i.test(mensaje);
}

// Un fallo de Meta -> el AppError que ve el negocio.
// - 429/5xx, red, timeout: transitorio, "probá de nuevo" (502).
// - 401/403: el token de la PLATAFORMA no sirve. No es culpa del negocio ni
//   lo puede arreglar: el mismo 503 que la conexión sin configurar.
// - Cualquier otro 4xx: Meta rechazó el pedido (nombre ya usado en el WABA,
//   texto que no cumple sus reglas, idioma inexistente). Su motivo, tal cual
//   lo redacta Meta, en un 400.
function traducirErrorDeMeta(err: unknown, accion: string): AppError {
  if (err instanceof WhatsappGraphError && !esTransitorio(err.status)) {
    if (err.status === 401 || err.status === 403) {
      logger.error({ err }, `Plantilla de WhatsApp: Meta rechazó el token al ${accion}`);
      return new AppError(MENSAJE_SIN_CONEXION, 503);
    }
    const motivo = mensajeDeMeta(err);
    return new AppError(`Meta rechazó el pedido al ${accion}${motivo ? `: ${motivo}` : ""}`, 400);
  }
  logger.warn({ err }, `Plantilla de WhatsApp: no se pudo contactar a Meta al ${accion}`);
  return new AppError(
    `No se pudo contactar a WhatsApp al ${accion}. Probá de nuevo en unos minutos.`,
    502,
  );
}

export function getCurrentWhatsappTemplate(organizationId: string) {
  return findActiveWhatsappTemplate(organizationId);
}

export interface CrearPlantillaInput {
  name: string;
  language: string;
  bodyText: string;
}

async function borrarEnMetaYLocal(
  organizationId: string,
  plantilla: { id: string; name: string; metaTemplateId: string | null },
  conexion: { wabaId: string; accessToken: string },
  deps: DepsDePlantillas,
) {
  try {
    await deps.delete({
      wabaId: conexion.wabaId,
      accessToken: conexion.accessToken,
      name: plantilla.name,
      metaTemplateId: plantilla.metaTemplateId,
    });
  } catch (err) {
    if (!esPlantillaInexistenteEnMeta(err)) {
      throw traducirErrorDeMeta(err, "borrar la plantilla");
    }
  }
  await softDeleteWhatsappTemplate(organizationId, plantilla.id);
}

export async function createWhatsappTemplate(
  organizationId: string,
  input: CrearPlantillaInput,
  deps: DepsDePlantillas = depsDePlantillasReales,
): Promise<WhatsappTemplatePublica> {
  const problema = validarTextoDePlantilla(input.bodyText);
  if (problema) {
    throw new AppError(problema, 400);
  }
  const bodyText = input.bodyText.trim();
  const conexion = leerConexion(deps);

  // Una activa por organización. PENDING o APPROVED: el negocio tiene que
  // borrarla a propósito (409). REJECTED no sirve para nada, y rehacerla es
  // justamente lo que el negocio vino a hacer: se borra sola —en Meta también,
  // para liberar el nombre allá— y sigue el alta.
  const actual = await findActiveWhatsappTemplate(organizationId);
  if (actual && actual.status !== WhatsappTemplateStatus.REJECTED) {
    throw new AppError(
      "Ya hay una plantilla pendiente o aprobada. Para cambiarla, borrá la actual primero.",
      409,
    );
  }
  if (actual) {
    const conMeta = await findWhatsappTemplateById(organizationId, actual.id);
    if (conMeta) {
      await borrarEnMetaYLocal(organizationId, conMeta, conexion, deps);
    }
  }

  if (await isWhatsappTemplateNameTaken(input.name)) {
    throw new AppError("Ese nombre de plantilla ya está en uso. Elegí otro.", 409);
  }

  let reserva: WhatsappTemplatePublica;
  try {
    reserva = await reserveWhatsappTemplate({
      organizationId,
      name: input.name,
      language: input.language,
      bodyText,
    });
  } catch (err) {
    // Otra alta concurrente ganó el lugar o el nombre entre los chequeos de
    // arriba y este INSERT: el UNIQUE parcial es la garantía real.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError(
        "Ya hay una plantilla con ese nombre, o esta organización ya tiene una. Recargá y probá de nuevo.",
        409,
      );
    }
    throw err;
  }

  let enMeta;
  try {
    enMeta = await deps.create({
      wabaId: conexion.wabaId,
      accessToken: conexion.accessToken,
      name: input.name,
      language: input.language,
      bodyText: textoParaMeta(bodyText),
      bodyExamples: [EJEMPLO_NOMBRE, EJEMPLO_LINK],
    });
  } catch (err) {
    await discardWhatsappTemplateReservation(organizationId, reserva.id);
    throw traducirErrorDeMeta(err, "crear la plantilla");
  }

  const estado = estadoLocalDeMeta(enMeta.status);
  await setWhatsappTemplateMetaId(organizationId, reserva.id, {
    ...estado,
    metaTemplateId: enMeta.id,
  });
  return (
    (await findPublicWhatsappTemplateById(organizationId, reserva.id)) ?? {
      ...reserva,
      ...estado,
    }
  );
}

export async function deleteWhatsappTemplate(
  organizationId: string,
  id: string,
  deps: DepsDePlantillas = depsDePlantillasReales,
): Promise<void> {
  const plantilla = await findWhatsappTemplateById(organizationId, id);
  if (!plantilla) {
    throw new AppError("Plantilla no encontrada", 404);
  }
  await borrarEnMetaYLocal(organizationId, plantilla, leerConexion(deps), deps);
}

// Repregunta el estado a Meta: la red de seguridad por si la suscripción del
// webhook a message_template_status_update no está puesta, o tarda.
export async function refreshWhatsappTemplate(
  organizationId: string,
  id: string,
  deps: DepsDePlantillas = depsDePlantillasReales,
): Promise<WhatsappTemplatePublica> {
  const plantilla = await findWhatsappTemplateById(organizationId, id);
  if (!plantilla) {
    throw new AppError("Plantilla no encontrada", 404);
  }
  if (!plantilla.metaTemplateId) {
    throw new AppError(
      "La plantilla no llegó a registrarse en Meta. Borrala y volvé a intentar.",
      409,
    );
  }
  const conexion = leerConexion(deps);

  let enMeta;
  try {
    enMeta = await deps.getStatus({
      metaTemplateId: plantilla.metaTemplateId,
      accessToken: conexion.accessToken,
    });
  } catch (err) {
    throw traducirErrorDeMeta(err, "consultar el estado");
  }

  const estado = estadoLocalDeMeta(enMeta.status, enMeta.rejectedReason);
  await setWhatsappTemplateStatus(organizationId, id, estado);
  // Releída y no armada a mano: vuelve con el updatedAt real y sin los campos
  // de la integración. Null solo si la borraron en el medio.
  const actualizada = await findPublicWhatsappTemplateById(organizationId, id);
  if (!actualizada) {
    throw new AppError("Plantilla no encontrada", 404);
  }
  return actualizada;
}

// El webhook message_template_status_update (whatsappWebhook.service.ts).
// Devuelve cuántas filas actualizó: 0 si la plantilla no es de este CRM (el
// WABA puede tener otras, dadas de alta a mano) o ya se borró.
export function applyWhatsappTemplateStatusFromMeta(
  metaTemplateId: string,
  estadoMeta: string,
  motivo: string | null,
) {
  return setWhatsappTemplateStatusByMetaId(metaTemplateId, estadoLocalDeMeta(estadoMeta, motivo));
}
