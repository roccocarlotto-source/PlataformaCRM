import { WhatsappTemplateHeaderFormat } from "@prisma/client";
import { env } from "../../config/env";
import { findQrCodeById } from "../../repositories/qrCode.repository";
import { proximaAperturaDeLaSucursal } from "../../services/branchBusinessHours.service";
import { armarEnvioDeLaPlantilla, nombreParaElSaludo } from "../../workers/qrFollowUpWorker";
import { baseDeLaApiPublica } from "../../utils/qrImage";
import {
  MOTIVO_NO_VINO,
  MOTIVO_QR_BORRADO,
  MOTIVO_SIN_INTERES,
  MOTIVO_TURNO_FUTURO_DE_LA_PRESTACION,
  MOTIVO_TURNO_NO_ATENDIDO,
  semanasDelControl,
} from "../postTurno/config";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { soloDigitos } from "../../lib/telefono";
import { createActivity as createActivityRepo } from "../../repositories/activity.repository";
import { findBranchWhatsappPhoneNumberId } from "../../repositories/agent.repository";
import { findApprovedWhatsappTemplate } from "../../repositories/whatsappTemplate.repository";
import {
  anotarEnvioEnConversacion,
  type EnvioDePlantilla,
} from "../../services/automationWhatsappConversation.service";
import {
  sendWhatsappTemplateReal,
  type SendWhatsappTemplate,
} from "../../services/whatsappGraph.service";
import { describirError, resolverFalloDelJob } from "../../utils/backoff";
import {
  TOKEN_DIA,
  TOKEN_HORA,
  TOKEN_LUGAR,
  TOKEN_NOMBRE,
  TOKEN_PROFESIONAL,
  TOKEN_SEMANAS,
  parametrosDePlantilla,
} from "../../utils/whatsappTemplateText";
import { ErrorPermanenteDelSeguimiento, clasificarFallo } from "../../workers/qrFollowUpWorker";
import { leerConfiguracionDeSede } from "../repositories/clinicSettings.repository";
import { asignadoParaLaSede } from "../services/reprogramar.service";
import {
  BOTONES_DEL_RECORDATORIO,
  MOTIVO_REGLA_INACTIVA,
  MOTIVO_SIN_TELEFONO,
  MOTIVO_TURNO_NO_VIGENTE,
  PREFIJO_TAREA_SIN_RESPUESTA,
  cuandoVaLaTareaSinRespuesta,
  diaYHora,
  lugarDelTurno,
} from "./config";
import {
  leerRecordatorioParaEnviar,
  marcarCancelado,
  marcarEnviado,
  marcarFallido,
  marcarTareaSinRespuesta,
  posponerHasta,
  reclamarRecordatorio,
  reprogramarIntento,
  sinRespuestaCandidatos,
  type RecordatorioParaEnviar,
  type RecordatorioReclamado,
} from "./repository";

// ---------------------------------------------------------------------------
// El worker de los mensajes de un turno de clínica: el recordatorio
// (docs/rubros.md §6, R13) y, desde R14, el QR de reseña y el control (§7). El patrón de
// las otras colas: polling, reclamo con lease (attempts como token), backoff y
// tope de intentos. Se relee todo antes de mandar y lo que ya no corresponde
// se CANCELA con el motivo, sin error:
//   - la regla se desactivó o se borró;
//   - el turno ya no está CONFIRMED o cambió de horario (otro recordatorio lo
//     cubre);
//   - el paciente no tiene teléfono, o se borró.
//
// SIEMPRE LA PLANTILLA aprobada de la regla (UTILITY, con los botones): es un
// mensaje que inicia la clínica, casi siempre fuera de la ventana de 24 h. Sale
// aunque la sede esté cerrada (§6.2): un turno de las 8:00 se recuerda a las
// 8:00 del día anterior.
//
// Y la barrida de "sin respuesta" (§6.5): a la hora que corresponde, una sola
// tarea para la Recepción de la sede. El turno no se cancela.
// ---------------------------------------------------------------------------

const POLL_MS = 60 * 1000;
const LEASE_MS = 5 * 60 * 1000;
const MAX_INTENTOS = 5;
const BACKOFF = { baseMs: 60 * 1000, topeMs: 60 * 60 * 1000 };
const LOTE = 50;

export interface PlantillaDelMensaje {
  name: string;
  languageCode: string;
  bodyText: string;
  // R14: el QR de reseña puede llevar la imagen del QR de encabezado.
  headerFormat?: WhatsappTemplateHeaderFormat;
}

export interface DepsDelRecordatorio {
  accessToken: () => string | undefined;
  plantillaDeLaRegla: (
    organizationId: string,
    automationId: string,
  ) => Promise<PlantillaDelMensaje | null>;
  numeroDeLaSede: (organizationId: string, branchId: string) => Promise<string | null>;
  sedesDeLaClinica: (organizationId: string) => Promise<number>;
  sendTemplate: SendWhatsappTemplate;
  registrarEnConversacion?: (envio: EnvioDePlantilla) => Promise<void>;
  // R14: el QR de reseña y el control salen dentro del horario de la sede
  // (G-07); el recordatorio no (§6.2). Sin pasarlo, abierta siempre.
  proximaApertura?: (organizationId: string, branchId: string, ahora: Date) => Promise<Date>;
  baseDeLaApi?: () => string | undefined;
}

export const depsDelRecordatorioReales: DepsDelRecordatorio = {
  accessToken: () => env.WHATSAPP_ACCESS_TOKEN,
  plantillaDeLaRegla: async (organizationId, automationId) => {
    const p = await findApprovedWhatsappTemplate(organizationId, automationId);
    return p
      ? {
          name: p.name,
          languageCode: p.language,
          bodyText: p.bodyText,
          headerFormat: p.headerFormat,
        }
      : null;
  },
  numeroDeLaSede: findBranchWhatsappPhoneNumberId,
  sedesDeLaClinica: (organizationId) =>
    prisma.branch.count({ where: { organizationId, deletedAt: null } }),
  sendTemplate: sendWhatsappTemplateReal,
  proximaApertura: proximaAperturaDeLaSucursal,
  baseDeLaApi: baseDeLaApiPublica,
};

/** Por qué el mensaje ya no corresponde, o null. Cada tipo, lo suyo:
 *   - REMINDER: el turno sigue CONFIRMED en el mismo horario.
 *   - REVIEW_QR (R14): el turno sigue COMPLETED (un No vino posterior cancela).
 *   - CONTROL (R14): el turno sigue COMPLETED, el paciente no está "sin
 *     interés" y no tiene ya un turno futuro de esa prestación.
 *  Y para todos: la regla activa y el paciente con teléfono. */
export async function motivoParaNoMandar(
  fila: RecordatorioParaEnviar,
  ahora: Date = new Date(),
): Promise<string | null> {
  if (!fila.automation.isActive || fila.automation.deletedAt !== null) return MOTIVO_REGLA_INACTIVA;
  if (fila.booking.branch.deletedAt !== null) return MOTIVO_TURNO_NO_VIGENTE;
  if (fila.kind === "REMINDER") {
    if (
      fila.booking.status !== "CONFIRMED" ||
      fila.booking.startsAt.getTime() !== fila.bookingStartsAt.getTime()
    ) {
      return MOTIVO_TURNO_NO_VIGENTE;
    }
  } else {
    if (fila.booking.status === "NO_SHOW") return MOTIVO_NO_VINO;
    if (fila.booking.status !== "COMPLETED") return MOTIVO_TURNO_NO_ATENDIDO;
  }
  if (fila.contact.deletedAt !== null || soloDigitos(fila.contact.phone ?? "") === "") {
    return MOTIVO_SIN_TELEFONO;
  }
  if (fila.kind === "CONTROL") {
    if (fila.contact.noInterestAt !== null) return MOTIVO_SIN_INTERES;
    const futuro = await prisma.booking.findFirst({
      where: {
        organizationId: fila.organizationId,
        contactId: fila.contactId,
        serviceTypeId: fila.booking.serviceTypeId,
        status: "CONFIRMED",
        startsAt: { gt: ahora },
      },
      select: { id: true },
    });
    if (futuro) return MOTIVO_TURNO_FUTURO_DE_LA_PRESTACION;
  }
  return null;
}

/** Pura: los valores de cada variable de la plantilla. */
export function valoresDelRecordatorio(fila: RecordatorioParaEnviar, sedes: number) {
  const { dia, hora } = diaYHora(fila.booking.startsAt, fila.booking.branch.timezone);
  return {
    [TOKEN_NOMBRE]: fila.contact.firstName.trim() || "paciente",
    [TOKEN_LUGAR]: lugarDelTurno(fila.organization.name, fila.booking.branch.name, sedes),
    [TOKEN_DIA]: dia,
    [TOKEN_HORA]: hora,
    [TOKEN_PROFESIONAL]: fila.booking.resource.name,
    [TOKEN_SEMANAS]: semanasDelControl(fila.booking.serviceType.followUpAfterDays ?? 7),
  };
}

export type ResultadoDelRecordatorio =
  | { resultado: "ENVIADO"; envio: EnvioDePlantilla }
  | { resultado: "CANCELADO"; motivo: string }
  // R14: la sede está cerrada; se corre a `hasta` sin gastar el intento.
  | { resultado: "FUERA_DE_HORARIO"; hasta: Date };

function qrDeLaRegla(actionConfig: unknown): string | null {
  const id = (actionConfig as { qrCodeId?: unknown } | null)?.qrCodeId;
  return typeof id === "string" ? id : null;
}

export async function procesarRecordatorio(
  reclamo: RecordatorioReclamado,
  accessToken: string,
  deps: DepsDelRecordatorio,
  ahora: Date = new Date(),
): Promise<ResultadoDelRecordatorio> {
  const fila = await leerRecordatorioParaEnviar(reclamo.id, reclamo.organizationId);
  if (!fila) throw new ErrorPermanenteDelSeguimiento("La fila del mensaje del turno ya no existe");
  const motivo = await motivoParaNoMandar(fila, ahora);
  if (motivo) return { resultado: "CANCELADO", motivo };

  // El QR y el control los inicia la clínica sin urgencia: dentro del horario
  // de la sede. El recordatorio sale aunque esté cerrada (§6.2).
  if (fila.kind !== "REMINDER" && deps.proximaApertura) {
    const apertura = await deps.proximaApertura(fila.organizationId, fila.booking.branchId, ahora);
    if (apertura.getTime() > ahora.getTime())
      return { resultado: "FUERA_DE_HORARIO", hasta: apertura };
  }

  let qr: { id: string; destinationUrl: string } | null = null;
  if (fila.kind === "REVIEW_QR") {
    const qrCodeId = qrDeLaRegla(fila.automation.actionConfig);
    qr = qrCodeId ? await findQrCodeById(qrCodeId, fila.organizationId) : null;
    if (!qr) return { resultado: "CANCELADO", motivo: MOTIVO_QR_BORRADO };
  }

  const destino = soloDigitos(fila.contact.phone ?? "");
  const phoneNumberId = await deps.numeroDeLaSede(fila.organizationId, fila.booking.branchId);
  if (!phoneNumberId) {
    throw new ErrorPermanenteDelSeguimiento(
      "La sede del turno no tiene un número de WhatsApp conectado (ningún agente de la sede tiene número)",
    );
  }
  const plantilla = await deps.plantillaDeLaRegla(fila.organizationId, fila.automationId);
  if (!plantilla) {
    throw new ErrorPermanenteDelSeguimiento("La regla no tiene una plantilla de WhatsApp aprobada");
  }

  let parametros: string[];
  let headerImageUrl: string | undefined;
  if (qr) {
    // El mismo armado que el QR de una automotora ({nombre} y {link}, con la
    // imagen del QR si la plantilla la lleva).
    const envioQr = armarEnvioDeLaPlantilla(
      plantilla,
      nombreParaElSaludo(fila.contact.firstName),
      qr.destinationUrl,
      { tipo: "r", id: qr.id },
      { baseDeLaApi: (deps.baseDeLaApi ?? baseDeLaApiPublica)() },
    );
    parametros = envioQr.bodyParameters;
    headerImageUrl = envioQr.headerImageUrl;
  } else {
    parametros = parametrosDePlantilla(
      plantilla.bodyText,
      valoresDelRecordatorio(fila, await deps.sedesDeLaClinica(fila.organizationId)),
    );
  }
  const { wamid } = await deps.sendTemplate({
    phoneNumberId,
    to: destino,
    templateName: plantilla.name,
    languageCode: plantilla.languageCode,
    bodyParameters: parametros,
    ...(headerImageUrl ? { headerImageUrl } : {}),
    ...(fila.kind === "REMINDER"
      ? { quickReplyPayloads: BOTONES_DEL_RECORDATORIO.map((b) => b.payload) }
      : {}),
    accessToken,
  });
  return {
    resultado: "ENVIADO",
    envio: {
      organizationId: fila.organizationId,
      contactId: fila.contactId,
      phoneNumberId,
      destino,
      plantilla,
      parametros,
      wamid,
    },
  };
}

export interface ResumenDelRecordatorio {
  enviados: number;
  cancelados: number;
  pospuestos: number;
  fallidos: number;
  tareas: number;
  sinConfiguracion: boolean;
}

export interface OpcionesDelDrenado {
  ahora?: Date;
  organizationId?: string;
  limite?: number;
  deps?: DepsDelRecordatorio;
}

async function registrarFallo(
  reclamo: RecordatorioReclamado,
  err: unknown,
  ahora: Date,
  resumen: ResumenDelRecordatorio,
) {
  const motivo = describirError(err);
  const resolucion = resolverFalloDelJob(reclamo.attempts, clasificarFallo(err), ahora, {
    maxIntentos: MAX_INTENTOS,
    backoff: BACKOFF,
  });
  if (resolucion.estado === "FAILED") {
    await marcarFallido(reclamo, motivo);
    resumen.fallidos++;
    logger.error(
      { err, bookingMessageId: reclamo.id, attempts: reclamo.attempts },
      "Recordatorio de turno en FAILED: el paciente no recibió el WhatsApp",
    );
    return;
  }
  await reprogramarIntento(reclamo, { nextAttemptAt: resolucion.nextAttemptAt, motivo });
  resumen.pospuestos++;
}

/** Una pasada: manda los vencidos y crea las tareas "sin respuesta". */
export async function drenarRecordatorios(
  opciones: OpcionesDelDrenado = {},
): Promise<ResumenDelRecordatorio> {
  const ahora = opciones.ahora ?? new Date();
  const deps = opciones.deps ?? depsDelRecordatorioReales;
  const limite = opciones.limite ?? LOTE;
  const resumen: ResumenDelRecordatorio = {
    enviados: 0,
    cancelados: 0,
    pospuestos: 0,
    fallidos: 0,
    tareas: 0,
    sinConfiguracion: false,
  };

  const accessToken = deps.accessToken()?.trim();
  if (!accessToken) {
    // Sin token no se reclama nada: las filas esperan, sin gastar intentos.
    resumen.sinConfiguracion = true;
  } else {
    for (let i = 0; i < limite; i++) {
      const reclamo = await reclamarRecordatorio(LEASE_MS, ahora, {
        ...(opciones.organizationId ? { organizationId: opciones.organizationId } : {}),
      });
      if (!reclamo) break;
      try {
        const r = await procesarRecordatorio(reclamo, accessToken, deps, ahora);
        if (r.resultado === "FUERA_DE_HORARIO") {
          await posponerHasta(reclamo, r.hasta);
          resumen.pospuestos++;
          continue;
        }
        if (r.resultado === "CANCELADO") {
          await marcarCancelado(reclamo, r.motivo);
          resumen.cancelados++;
          continue;
        }
        await marcarEnviado(reclamo, { sentAt: ahora, externalMessageId: r.envio.wamid });
        resumen.enviados++;
        await anotarEnvioEnConversacion(r.envio, deps.registrarEnConversacion);
      } catch (err) {
        await registrarFallo(reclamo, err, ahora, resumen);
      }
    }
  }

  resumen.tareas = await crearTareasSinRespuesta(ahora, opciones.organizationId);
  return resumen;
}

/**
 * §6.5: los recordatorios SENT sin respuesta cuya hora de tarea ya llegó.
 * Una sola tarea por mensaje (CAS sobre no_response_task_at). Si para entonces
 * faltan menos de 2 h, o el paciente ya confirmó o el turno cambió, no hay
 * tarea (y se marca, para no volver a mirarlo).
 */
export async function crearTareasSinRespuesta(
  ahora: Date,
  organizationId?: string,
): Promise<number> {
  const candidatos = await sinRespuestaCandidatos(ahora, LOTE, organizationId);
  let creadas = 0;
  for (const m of candidatos) {
    const { noResponseTaskHours } = await leerConfiguracionDeSede(
      m.organizationId,
      m.booking.branchId,
    );
    const cuando = m.sentAt
      ? cuandoVaLaTareaSinRespuesta(m.sentAt, m.bookingStartsAt, noResponseTaskHours)
      : null;
    if (cuando && cuando.getTime() > ahora.getTime()) continue;
    const vigente =
      m.booking.status === "CONFIRMED" &&
      m.booking.startsAt.getTime() === m.bookingStartsAt.getTime() &&
      m.booking.patientConfirmedAt === null;
    if (!cuando || !vigente) {
      await marcarTareaSinRespuesta(m.id, ahora);
      continue;
    }
    const asignado = await asignadoParaLaSede(m.organizationId, m.booking.branchId);
    if (!asignado) continue;
    const paciente = `${m.contact.firstName} ${m.contact.lastName}`.trim() || "el paciente";
    const { dia, hora } = diaYHora(m.bookingStartsAt, m.booking.branch.timezone);
    const hecha = await prisma.$transaction(async (tx) => {
      const { count } = await tx.bookingMessage.updateMany({
        where: { id: m.id, noResponseTaskAt: null, respondedAt: null },
        data: { noResponseTaskAt: ahora },
      });
      if (count === 0) return false;
      await createActivityRepo(
        {
          organizationId: m.organizationId,
          type: "TASK",
          authorId: asignado,
          assigneeId: asignado,
          companyId: null,
          contactId: m.contactId,
          opportunityId: null,
          branchId: m.booking.branchId,
          subject: `${PREFIJO_TAREA_SIN_RESPUESTA}${paciente} del ${dia} a las ${hora}`.slice(
            0,
            255,
          ),
          body: "El paciente no respondió el recordatorio por WhatsApp. El turno sigue en pie: llamalo para confirmarlo.",
          dueDate: ahora,
        },
        tx,
      );
      return true;
    });
    if (hecha) creadas++;
  }
  return creadas;
}

export function iniciarWorkerDeRecordatorios(
  opciones: { pollMs?: number } = {},
): () => Promise<void> {
  const pollMs = opciones.pollMs ?? POLL_MS;
  let detenido = false;
  let timer: NodeJS.Timeout | undefined;
  let tickEnCurso: Promise<void> | undefined;

  const tick = async () => {
    if (detenido) return;
    tickEnCurso = (async () => {
      try {
        const r = await drenarRecordatorios();
        if (r.enviados + r.cancelados + r.fallidos + r.tareas > 0) {
          logger.info(r, "Recordatorios de turno procesados");
        }
      } catch (err) {
        logger.error({ err }, "Fallo inesperado en el worker de recordatorios de turno");
      }
    })();
    await tickEnCurso;
    if (!detenido) timer = setTimeout(() => void tick(), pollMs);
  };

  logger.info({ pollMs }, "Worker de recordatorios de turno iniciado");
  timer = setTimeout(() => void tick(), pollMs);
  return async () => {
    detenido = true;
    if (timer) clearTimeout(timer);
    await tickEnCurso;
  };
}
