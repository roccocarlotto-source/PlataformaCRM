import {
  Prisma,
  WhatsappTemplateHeaderFormat,
  WhatsappTemplateStatus,
  type OrganizationIndustry,
} from "@prisma/client";
import { findEdicionYRubro } from "../repositories/organization.repository";
import { randomUUID } from "node:crypto";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import {
  discardWhatsappTemplateReservation,
  findPlantillasDeLaRegla,
  findPlantillasDeLasReglas,
  findWhatsappTemplateById,
  isWhatsappTemplateNameTaken,
  reserveWhatsappTemplate,
  setWhatsappTemplateMetaId,
  setWhatsappTemplateStatus,
  setWhatsappTemplateStatusByMetaId,
  softDeleteWhatsappTemplate,
  type PlantillaConMeta,
  type PlantillaReemplazada,
} from "../repositories/whatsappTemplate.repository";
import { AppError } from "../utils/AppError";
import { contenidoDelQr, qrPng, type TipoDeQr } from "../utils/qrImage";
import {
  TOKEN_LINK,
  VARIABLES_DE_CONSULTA,
  VARIABLES_DE_CONSULTA_DE_CLINICA,
  VARIABLES_DE_RECORDATORIO,
  VARIABLES_DE_CONTROL,
  ejemplosDelCuerpo,
  formatoLlevaImagen,
  formatoLlevaLink,
  textoParaMeta,
  validarTextoDePlantilla,
  variablesDeSeguimiento,
  type FormatoDeMensaje,
  type VariableDePlantilla,
} from "../utils/whatsappTemplateText";
import { ACTION_INQUIRY_FOLLOW_UP } from "./automationActions/inquiryFollowUp";
import {
  ACTION_BOOKING_SEND_REMINDER,
  BOTONES_DEL_RECORDATORIO,
} from "../clinicas/recordatorios/config";
import {
  ACTION_BOOKING_SCHEDULE_CONTROL,
  ACTION_BOOKING_SEND_QR_REVIEW,
} from "../clinicas/postTurno/config";
import { mensajeDeLaRegla } from "./automationActions/mensajeDeWhatsapp";
import { ACTION_SEND_DISCOUNT_VOUCHER } from "./automationActions/sendDiscountVoucherFollowup";
import { ACTION_SEND_QR_FOLLOWUP } from "./automationActions/sendQrFollowup";
import { esTransitorio } from "./llmProvider.service";
import {
  createWhatsappTemplateReal,
  deleteWhatsappTemplateReal,
  getWhatsappTemplateStatusReal,
  mensajeDeMeta,
  uploadTemplateSampleReal,
  WhatsappGraphError,
  type CategoriaDePlantilla,
  type CreateWhatsappTemplate,
  type DeleteWhatsappTemplate,
  type GetWhatsappTemplateStatus,
  type UploadTemplateSample,
} from "./whatsappGraph.service";

// ---------------------------------------------------------------------------
// Las plantillas de WhatsApp de las reglas que mandan uno (ítem 160; por
// regla desde el 181). El negocio YA NO LAS ARMA: elige en la regla el
// formato (solo link, solo imagen del QR, o los dos) y, si quiere, el texto, y
// al guardar la regla esto crea la plantilla en Meta solo, con el encabezado
// que corresponda (sincronizarPlantillaDeLaRegla). La pantalla muestra un
// único estado: pendiente, aprobada o rechazada (resumenDeAprobacion).
//
// UNA PLANTILLA EN META NO SE EDITA: SE REEMPLAZA, SIN CORTAR LOS ENVÍOS. El
// seguimiento sale horas después de la venta, fuera de la ventana de 24 h,
// así que solo puede salir con una plantilla APROBADA. Si cambiar el formato
// o el texto pide una nueva, se da de alta como CANDIDATA y la regla sigue
// mandando con la aprobada anterior hasta que Meta apruebe la nueva; ahí la
// anterior se da de baja (repositorio: aplicarEstadoDePlantilla) y se borra
// en Meta. Editar la aprobada en el lugar (POST /{template-id}) la habría
// dejado en revisión SIN poder mandarse, y Meta limita las ediciones.
//
// EL ALTA RESERVA ANTES DE HABLAR CON META. La fila se crea primero —en
// PENDING, sin metaTemplateId— y recién después se llama a Meta. El UNIQUE
// parcial de candidatas frena una segunda alta concurrente ANTES de que
// llegue a Meta. Si Meta rechaza el alta, la reserva se descarta (borrado
// físico: la plantilla no llegó a existir).
//
// ESTADO: EL DE META, NO EL NUESTRO. Lo lee del webhook
// message_template_status_update o del refresh a mano, y lo traduce a tres
// estados con estadoLocalDeMeta.
//
// Las llamadas a Meta se inyectan (DepsDePlantillas), mismo criterio que los
// workers: producción usa las *Real, los tests un doble.
// ---------------------------------------------------------------------------

export interface DepsDePlantillas {
  wabaId: () => string | undefined;
  accessToken: () => string | undefined;
  // El id de la app de Meta: lo pide la Resumable Upload API para subir la
  // imagen de ejemplo de una plantilla con encabezado IMAGE.
  appId: () => string | undefined;
  create: CreateWhatsappTemplate;
  delete: DeleteWhatsappTemplate;
  getStatus: GetWhatsappTemplateStatus;
  uploadSample: UploadTemplateSample;
  // El nombre único de una plantilla nueva. Inyectable para los tests.
  nombreNuevo?: (actionType: string, automationId: string) => string;
  // R15: el rubro de la organización (en una clínica, el seguimiento de
  // consultas lleva {prestacion}). Sin pasarlo, AUTOMOTORA: lo de siempre.
  rubroDe?: (organizationId: string) => Promise<OrganizationIndustry>;
}

export const depsDePlantillasReales: DepsDePlantillas = {
  wabaId: () => env.WHATSAPP_BUSINESS_ACCOUNT_ID,
  accessToken: () => env.WHATSAPP_ACCESS_TOKEN,
  appId: () => env.META_APP_ID,
  create: createWhatsappTemplateReal,
  delete: deleteWhatsappTemplateReal,
  getStatus: getWhatsappTemplateStatusReal,
  uploadSample: uploadTemplateSampleReal,
  rubroDe: (organizationId) => findEdicionYRubro(organizationId).then((o) => o.industry),
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
export function estadoLocalDeMeta(estadoMeta: string, motivo?: string | null) {
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
// - Cualquier otro 4xx: Meta rechazó el pedido (texto que no cumple sus
//   reglas, idioma inexistente). Su motivo, tal cual lo redacta Meta, en un
//   400.
function traducirErrorDeMeta(err: unknown, accion: string): AppError {
  if (err instanceof AppError) return err;
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

// Las acciones de automatización que mandan un WhatsApp con plantilla, y qué
// QR va en su imagen: el de la sucursal (`r`) o el del cupón (`v`). Una acción
// nueva de este tipo se suma acá (y al catálogo del frontend).
const QR_DE_LA_ACCION: Record<string, TipoDeQr> = {
  [ACTION_SEND_QR_FOLLOWUP]: "r",
  [ACTION_SEND_DISCOUNT_VOUCHER]: "v",
  // R14: el QR de reseña de una clínica, con la misma forma que el de arriba.
  [ACTION_BOOKING_SEND_QR_REVIEW]: "r",
};

// La categoría con la que se da de alta la plantilla de cada acción. Las dos
// van como MARKETING, que es la que Meta les asigna:
// - Cupón de descuento: es una promoción. Meta recategorizó a MARKETING la
//   que se mandó como UTILITY.
// - QR de reseñas: es un pedido de reseña genérico ({nombre} y un link, sin
//   número de pedido ni detalle de la compra). Meta: "Specificity of the order
//   or interaction to which these relate is necessary. A general/generic
//   survey or request for feedback will not be approved as utility."
//   developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization
//   (sección Utility templates > Feedback surveys).
// Solo afecta las altas nuevas: las plantillas ya creadas no se tocan.
// - Seguimiento de una consulta (ítem 185): es un mensaje comercial para
//   retomar una venta, MARKETING por definición de Meta.
const CATEGORIA_DE_LA_ACCION: Record<string, CategoriaDePlantilla> = {
  [ACTION_SEND_QR_FOLLOWUP]: "MARKETING",
  [ACTION_SEND_DISCOUNT_VOUCHER]: "MARKETING",
  [ACTION_INQUIRY_FOLLOW_UP]: "MARKETING",
  // R13 (docs/rubros.md §6.3): el recordatorio de un turno que pidió el
  // paciente es UTILITY. La plantilla no lleva nada más que el turno.
  [ACTION_BOOKING_SEND_REMINDER]: "UTILITY",
};

// R13: los botones de respuesta rápida de la plantilla de cada acción (el
// texto). Solo el recordatorio; las demás, sin botones, como siempre.
export function botonesDeLaAccion(actionType: string): string[] | undefined {
  return actionType === ACTION_BOOKING_SEND_REMINDER
    ? BOTONES_DEL_RECORDATORIO.map((b) => b.texto)
    : undefined;
}

export function categoriaDeLaAccion(actionType: string): CategoriaDePlantilla {
  return CATEGORIA_DE_LA_ACCION[actionType] ?? "MARKETING";
}

// Más el seguimiento de consultas (ítem 185), que manda solo texto (sin
// imagen) con sus propias variables.
export const ACCIONES_CON_PLANTILLA: readonly string[] = [
  ...Object.keys(QR_DE_LA_ACCION),
  ACTION_INQUIRY_FOLLOW_UP,
  ACTION_BOOKING_SEND_REMINDER,
  // R14: el control después del turno (solo texto).
  ACTION_BOOKING_SCHEDULE_CONTROL,
];

// Las variables de la plantilla de cada acción (utils/whatsappTemplateText.ts):
// {saludo} y {vehiculo} para el seguimiento de consultas; {nombre} y, si el
// formato lleva link, {link} para el QR y el cupón.
export function variablesDeLaAccion(
  actionType: string,
  formato: FormatoDeMensaje,
  industry: OrganizationIndustry = "AUTOMOTORA",
): readonly VariableDePlantilla[] {
  if (actionType === ACTION_INQUIRY_FOLLOW_UP) {
    return industry === "CLINICA" ? VARIABLES_DE_CONSULTA_DE_CLINICA : VARIABLES_DE_CONSULTA;
  }
  if (actionType === ACTION_BOOKING_SEND_REMINDER) return VARIABLES_DE_RECORDATORIO;
  if (actionType === ACTION_BOOKING_SCHEDULE_CONTROL) return VARIABLES_DE_CONTROL;
  return variablesDeSeguimiento(formatoLlevaLink(formato));
}

export function esAccionConPlantilla(actionType: string): boolean {
  return ACCIONES_CON_PLANTILLA.includes(actionType);
}

const PREFIJO_DEL_NOMBRE: Record<string, string> = {
  [ACTION_SEND_QR_FOLLOWUP]: "seguimiento_qr",
  [ACTION_SEND_DISCOUNT_VOUCHER]: "cupon_descuento",
  [ACTION_INQUIRY_FOLLOW_UP]: "seguimiento_consulta",
  [ACTION_BOOKING_SEND_REMINDER]: "recordatorio_turno",
  [ACTION_BOOKING_SEND_QR_REVIEW]: "resena_turno",
  [ACTION_BOOKING_SCHEDULE_CONTROL]: "control_turno",
};

// Minúsculas, números y guion bajo (regla de Meta), único en el WABA
// compartido: un pedazo de la regla y uno al azar. El negocio no lo ve.
export function nombreDePlantillaNuevo(actionType: string, automationId: string): string {
  const prefijo = PREFIJO_DEL_NOMBRE[actionType] ?? "seguimiento";
  const regla = automationId.replace(/-/g, "").slice(0, 8);
  const azar = randomUUID().replace(/-/g, "").slice(0, 8);
  return `${prefijo}_${regla}_${azar}`;
}

const IDIOMA_POR_DEFECTO = "es_AR";

// ---------------------------------------------------------------------------
// Lo que la pantalla de la regla muestra
// ---------------------------------------------------------------------------

export type EstadoDeAprobacion = "SIN_PLANTILLA" | "PENDIENTE" | "APROBADA" | "RECHAZADA";

export interface ResumenDeAprobacion {
  estado: EstadoDeAprobacion;
  // El motivo de Meta, solo en RECHAZADA.
  motivo: string | null;
  // true si hay una versión nueva en revisión (o rechazada) y, mientras
  // tanto, se sigue mandando con la aprobada anterior.
  mandaLaAnterior: boolean;
  // El texto y el formato de la versión más nueva: con eso se completa el
  // formulario de una regla vieja que no tiene messageText guardado.
  bodyText: string | null;
  formato: FormatoDeMensaje | null;
}

function formatoDeLaPlantilla(
  p: Pick<PlantillaConMeta, "bodyText" | "headerFormat">,
): FormatoDeMensaje {
  const conImagen = p.headerFormat === WhatsappTemplateHeaderFormat.IMAGE;
  const conLink = p.bodyText.includes(TOKEN_LINK);
  if (conImagen) return conLink ? "LINK_AND_IMAGE" : "IMAGE";
  return "LINK";
}

// Pura: un solo estado para la pantalla, de la versión más nueva.
export function resumenDeAprobacion(par: {
  aprobada: PlantillaConMeta | null;
  candidata: PlantillaConMeta | null;
}): ResumenDeAprobacion {
  const { aprobada, candidata } = par;
  const ultima = candidata ?? aprobada;
  if (!ultima) {
    return {
      estado: "SIN_PLANTILLA",
      motivo: null,
      mandaLaAnterior: false,
      bodyText: null,
      formato: null,
    };
  }
  const estado: EstadoDeAprobacion =
    ultima.status === WhatsappTemplateStatus.APPROVED
      ? "APROBADA"
      : ultima.status === WhatsappTemplateStatus.REJECTED
        ? "RECHAZADA"
        : "PENDIENTE";
  return {
    estado,
    motivo: estado === "RECHAZADA" ? (ultima.rejectedReason ?? null) : null,
    mandaLaAnterior: candidata !== null && aprobada !== null,
    bodyText: ultima.bodyText,
    formato: formatoDeLaPlantilla(ultima),
  };
}

export async function getAprobacionDeLaRegla(
  organizationId: string,
  automationId: string,
): Promise<ResumenDeAprobacion> {
  return resumenDeAprobacion(await findPlantillasDeLaRegla(organizationId, automationId));
}

// El estado de aprobación de varias reglas con una sola query, para el
// listado. Devuelve un resumen por cada id pedido.
export async function getAprobacionesDeLasReglas(
  organizationId: string,
  automationIds: string[],
): Promise<Map<string, ResumenDeAprobacion>> {
  const pares = await findPlantillasDeLasReglas(organizationId, automationIds);
  return new Map([...pares].map(([id, par]) => [id, resumenDeAprobacion(par)]));
}

// ---------------------------------------------------------------------------
// Sincronización: la plantilla que la regla pide vs. las que tiene
// ---------------------------------------------------------------------------

export interface PlantillaDeseada {
  bodyText: string;
  headerFormat: WhatsappTemplateHeaderFormat;
}

export type DecisionDeSincronizacion =
  | { accion: "NADA" }
  | { accion: "DESCARTAR_CANDIDATA" }
  | { accion: "CREAR"; descartarCandidata: boolean };

function coincide(
  p: Pick<PlantillaConMeta, "bodyText" | "headerFormat"> | null,
  deseada: PlantillaDeseada,
): boolean {
  return p !== null && p.bodyText === deseada.bodyText && p.headerFormat === deseada.headerFormat;
}

// Pura, para probarla sin base ni red:
// - lo que pide la regla ya está aprobado: nada que hacer (y si había una
//   versión nueva en curso, el negocio volvió atrás: se descarta);
// - ya está en revisión, o rechazado con ESE mismo texto: nada. Volver a
//   mandar lo mismo que Meta rechazó daría el mismo rechazo — el negocio tiene
//   que cambiar el texto;
// - cualquier otra cosa: una versión nueva, descartando la candidata vieja.
export function decidirSincronizacion(
  par: { aprobada: PlantillaConMeta | null; candidata: PlantillaConMeta | null },
  deseada: PlantillaDeseada | null,
): DecisionDeSincronizacion {
  if (deseada === null) return { accion: "NADA" };
  if (coincide(par.aprobada, deseada)) {
    return par.candidata ? { accion: "DESCARTAR_CANDIDATA" } : { accion: "NADA" };
  }
  if (coincide(par.candidata, deseada)) return { accion: "NADA" };
  return { accion: "CREAR", descartarCandidata: par.candidata !== null };
}

// Pura: la plantilla que pide la regla, o null si no hay con qué armarla (una
// regla vieja sin texto propio y sin ninguna plantilla). Sin messageText, el
// texto es el de la versión más nueva que ya tiene.
export function plantillaDeseada(
  actionConfig: unknown,
  par: { aprobada: PlantillaConMeta | null; candidata: PlantillaConMeta | null },
): PlantillaDeseada | null {
  const { formato, texto } = mensajeDeLaRegla(actionConfig);
  const bodyText = texto ?? par.candidata?.bodyText ?? par.aprobada?.bodyText ?? null;
  if (bodyText === null) return null;
  return {
    bodyText,
    headerFormat: formatoLlevaImagen(formato)
      ? WhatsappTemplateHeaderFormat.IMAGE
      : WhatsappTemplateHeaderFormat.NONE,
  };
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
      throw traducirErrorDeMeta(err, "borrar la versión anterior de la plantilla");
    }
  }
  await softDeleteWhatsappTemplate(organizationId, plantilla.id);
}

// La aprobada anterior que la promoción ya dio de baja localmente: se borra
// también en Meta para no acumular plantillas muertas en el WABA. Best effort:
// si Meta no contesta, queda allá sin uso y se loguea.
async function borrarReemplazadaEnMeta(reemplazada: PlantillaReemplazada, deps: DepsDePlantillas) {
  const wabaId = deps.wabaId()?.trim();
  const accessToken = deps.accessToken()?.trim();
  if (!wabaId || !accessToken) return;
  try {
    await deps.delete({
      wabaId,
      accessToken,
      name: reemplazada.name,
      metaTemplateId: reemplazada.metaTemplateId,
    });
  } catch (err) {
    if (!esPlantillaInexistenteEnMeta(err)) {
      logger.warn(
        { err, plantilla: reemplazada.name },
        "No se pudo borrar en Meta la plantilla reemplazada; queda allá sin uso",
      );
    }
  }
}

// El handle de la imagen de ejemplo para el alta de una plantilla con
// encabezado IMAGE: un QR de muestra del mismo tipo que el real.
async function subirImagenDeEjemplo(
  actionType: string,
  accessToken: string,
  deps: DepsDePlantillas,
): Promise<string> {
  const appId = deps.appId()?.trim();
  if (!appId) {
    logger.error(
      { faltan: ["META_APP_ID"] },
      "Plantilla de WhatsApp con imagen: falta el id de la app de Meta",
    );
    throw new AppError(MENSAJE_SIN_CONEXION, 503);
  }
  const tipo = QR_DE_LA_ACCION[actionType] ?? "r";
  const ejemplo =
    contenidoDelQr(tipo, "00000000-0000-4000-8000-000000000000") ?? "https://nexoraqrs.com";
  return deps.uploadSample({
    appId,
    accessToken,
    fileName: `ejemplo_${tipo}.png`,
    png: await qrPng(ejemplo),
  });
}

async function crearVersionNueva(
  organizationId: string,
  regla: { id: string; actionType: string },
  deseada: PlantillaDeseada,
  variables: readonly VariableDePlantilla[],
  language: string,
  conexion: { wabaId: string; accessToken: string },
  deps: DepsDePlantillas,
) {
  const nombre = (deps.nombreNuevo ?? nombreDePlantillaNuevo)(regla.actionType, regla.id);
  if (await isWhatsappTemplateNameTaken(nombre)) {
    // Con 8 caracteres al azar no pasa; si pasa, el próximo guardado lo
    // resuelve con otro nombre.
    throw new AppError("No se pudo reservar un nombre para la plantilla. Guardá de nuevo.", 409);
  }

  const conImagen = deseada.headerFormat === WhatsappTemplateHeaderFormat.IMAGE;
  // La imagen de ejemplo ANTES de reservar: si falla, no queda una reserva
  // huérfana que descartar.
  let headerImageHandle: string | undefined;
  if (conImagen) {
    try {
      headerImageHandle = await subirImagenDeEjemplo(regla.actionType, conexion.accessToken, deps);
    } catch (err) {
      throw traducirErrorDeMeta(err, "subir la imagen de ejemplo");
    }
  }

  let reserva;
  try {
    reserva = await reserveWhatsappTemplate({
      organizationId,
      automationId: regla.id,
      name: nombre,
      language,
      bodyText: deseada.bodyText,
      headerFormat: deseada.headerFormat,
    });
  } catch (err) {
    // Otro guardado concurrente de la misma regla ganó el lugar de candidata
    // entre la lectura y este INSERT: el UNIQUE parcial es la garantía real.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError(
        "La regla se está guardando desde otro lado al mismo tiempo. Recargá y probá de nuevo.",
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
      name: nombre,
      language,
      category: categoriaDeLaAccion(regla.actionType),
      bodyText: textoParaMeta(deseada.bodyText),
      bodyExamples: ejemplosDelCuerpo(deseada.bodyText, variables),
      ...(headerImageHandle ? { headerImageHandle } : {}),
      ...(botonesDeLaAccion(regla.actionType)
        ? { quickReplyButtons: botonesDeLaAccion(regla.actionType) }
        : {}),
    });
  } catch (err) {
    await discardWhatsappTemplateReservation(organizationId, reserva.id);
    throw traducirErrorDeMeta(err, "mandar la plantilla a aprobación");
  }

  const { reemplazada } = await setWhatsappTemplateMetaId(organizationId, reserva.id, {
    ...estadoLocalDeMeta(enMeta.status),
    metaTemplateId: enMeta.id,
  });
  if (reemplazada) await borrarReemplazadaEnMeta(reemplazada, deps);
}

export interface ResultadoDeSincronizacion {
  aprobacion: ResumenDeAprobacion;
  // El motivo por el que no se pudo mandar la versión nueva a Meta, para la
  // pantalla. La regla quedó guardada igual: el próximo guardado reintenta.
  error: string | null;
}

// Al guardar una regla que manda WhatsApp: deja en Meta la plantilla que la
// regla pide. No lanza por un fallo de Meta ni de configuración: la regla ya
// está guardada, y el error vuelve como dato para que la pantalla lo muestre.
// Lo que sí lanza (la base que no responde, un bug) es un 500 de siempre.
export async function sincronizarPlantillaDeLaRegla(
  organizationId: string,
  regla: { id: string; actionType: string; actionConfig: unknown },
  deps: DepsDePlantillas = depsDePlantillasReales,
): Promise<ResultadoDeSincronizacion> {
  let error: string | null = null;
  try {
    const par = await findPlantillasDeLaRegla(organizationId, regla.id);
    const deseada = plantillaDeseada(regla.actionConfig, par);
    const decision = decidirSincronizacion(par, deseada);
    if (deseada && decision.accion !== "NADA") {
      // Una regla vieja sin messageText cuyo formato nuevo no admite su texto
      // (pasar a "solo imagen" con un {link} heredado): se dice, no se manda.
      const { formato } = mensajeDeLaRegla(regla.actionConfig);
      const industry = deps.rubroDe ? await deps.rubroDe(organizationId) : "AUTOMOTORA";
      const variables = variablesDeLaAccion(regla.actionType, formato, industry);
      const problema = validarTextoDePlantilla(deseada.bodyText, { variables });
      if (problema) throw new AppError(problema, 400);

      const conexion = leerConexion(deps);
      if (decision.accion === "DESCARTAR_CANDIDATA" || decision.descartarCandidata) {
        await borrarEnMetaYLocal(organizationId, par.candidata!, conexion, deps);
      }
      if (decision.accion === "CREAR") {
        const language = par.aprobada?.language ?? par.candidata?.language ?? IDIOMA_POR_DEFECTO;
        await crearVersionNueva(
          organizationId,
          regla,
          deseada,
          variables,
          language,
          conexion,
          deps,
        );
      }
    }
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    error = err.message;
  }
  return { aprobacion: await getAprobacionDeLaRegla(organizationId, regla.id), error };
}

// ---------------------------------------------------------------------------
// Estado: refresh a mano y webhook
// ---------------------------------------------------------------------------

async function refrescarUna(
  organizationId: string,
  plantilla: PlantillaConMeta,
  accessToken: string,
  deps: DepsDePlantillas,
) {
  if (!plantilla.metaTemplateId) return;
  let enMeta;
  try {
    enMeta = await deps.getStatus({ metaTemplateId: plantilla.metaTemplateId, accessToken });
  } catch (err) {
    throw traducirErrorDeMeta(err, "consultar el estado");
  }
  const { reemplazada } = await setWhatsappTemplateStatus(
    organizationId,
    plantilla.id,
    estadoLocalDeMeta(enMeta.status, enMeta.rejectedReason),
  );
  if (reemplazada) await borrarReemplazadaEnMeta(reemplazada, deps);
}

// Repregunta a Meta el estado de las plantillas de la regla: la red de
// seguridad por si la suscripción del webhook a
// message_template_status_update no está puesta, o tarda.
export async function refreshAprobacionDeLaRegla(
  organizationId: string,
  automationId: string,
  deps: DepsDePlantillas = depsDePlantillasReales,
): Promise<ResumenDeAprobacion> {
  const { accessToken } = leerConexion(deps);
  const { aprobada, candidata } = await findPlantillasDeLaRegla(organizationId, automationId);
  // La candidata primero: si Meta la aprobó, la promoción da de baja a la
  // aprobada y no hay que preguntar por ella.
  if (candidata) await refrescarUna(organizationId, candidata, accessToken, deps);
  if (aprobada && (await findWhatsappTemplateById(organizationId, aprobada.id))) {
    await refrescarUna(organizationId, aprobada, accessToken, deps);
  }
  return getAprobacionDeLaRegla(organizationId, automationId);
}

// El webhook message_template_status_update (whatsappWebhook.service.ts).
// Devuelve cuántas filas actualizó: 0 si la plantilla no es de este CRM (el
// WABA puede tener otras, dadas de alta a mano) o ya se borró.
export async function applyWhatsappTemplateStatusFromMeta(
  metaTemplateId: string,
  estadoMeta: string,
  motivo: string | null,
  deps: DepsDePlantillas = depsDePlantillasReales,
): Promise<number> {
  const { count, reemplazadas } = await setWhatsappTemplateStatusByMetaId(
    metaTemplateId,
    estadoLocalDeMeta(estadoMeta, motivo),
  );
  for (const reemplazada of reemplazadas) await borrarReemplazadaEnMeta(reemplazada, deps);
  return count;
}
