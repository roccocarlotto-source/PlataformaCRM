import { env } from "../../config/env";
import { salidasPara } from "../../services/modoDemo.service";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { soloDigitos } from "../../lib/telefono";
import { findBranchWhatsappPhoneNumberId } from "../../repositories/agent.repository";
import { findApprovedWhatsappTemplate } from "../../repositories/whatsappTemplate.repository";
import {
  anotarEnvioEnConversacion,
  type EnvioDePlantilla,
} from "../../services/automationWhatsappConversation.service";
import { proximaAperturaDeLaSucursal } from "../../services/branchBusinessHours.service";
import {
  WhatsappGraphError,
  sendWhatsappTemplateReal,
  type SendWhatsappTemplate,
} from "../../services/whatsappGraph.service";
import { describirError, resolverFalloDelJob } from "../../utils/backoff";
import {
  TOKEN_FECHA,
  TOKEN_LUGAR,
  TOKEN_NOMBRE,
  TOKEN_VEHICULO,
  parametrosDePlantilla,
} from "../../utils/whatsappTemplateText";
import { ErrorPermanenteDelSeguimiento, clasificarFallo } from "../../workers/qrFollowUpWorker";
import { configDelRecordatorioDelServiceSchema } from "./accion";
import {
  CODIGOS_SIN_MARKETING,
  MOTIVO_CONTACTO_NO_VIGENTE,
  MOTIVO_FECHA_CAMBIO,
  MOTIVO_NO_RECORDAR,
  MOTIVO_ORDEN_ABIERTA,
  MOTIVO_REGLA_INACTIVA,
  MOTIVO_SIN_MARKETING,
  MOTIVO_SIN_MODULO,
  MOTIVO_SIN_NUMERO,
  MOTIVO_SIN_PLANTILLA,
  MOTIVO_SIN_WHATSAPP,
  MOTIVO_VEHICULO_NO_VIGENTE,
  textoDeLaFecha,
  textoDelLugar,
  textoDelVehiculo,
} from "./config";
import {
  findOrganizationWhatsappPhoneNumberId,
  leerMensajeParaEnviar,
  marcarCancelado,
  marcarEnviado,
  marcarFallido,
  posponerHasta,
  reclamarMensaje,
  reprogramarIntento,
  tieneElModulo,
  type MensajeParaEnviar,
  type MensajeReclamado,
} from "./repository";
import { crearTareaDelAviso } from "./tarea";

// ---------------------------------------------------------------------------
// El envío del recordatorio del próximo service (docs/servicios.md §6.3, S7),
// con el patrón del recordatorio de turno (recordatorioWorker.ts): reclama con
// lease, revalida, respeta el horario de la sucursal sin gastar el intento,
// manda la plantilla aprobada de la regla y reintenta con backoff.
//
// SIN WHATSAPP (D8): el cliente sin teléfono, que apagó el marketing en
// WhatsApp (131050), o la organización sin número o sin plantilla aprobada. La
// fila queda CANCELLED con el motivo y, si la regla tiene la casilla (default),
// se crea la tarea "Llamar a…" del aviso: el taller lo llama igual.
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
}

export interface DepsDelEnvio {
  accessToken: () => string | undefined;
  plantillaDeLaRegla: (
    organizationId: string,
    automationId: string,
  ) => Promise<PlantillaDelMensaje | null>;
  numeroDeLaSucursal: (organizationId: string, branchId: string) => Promise<string | null>;
  numeroDeLaOrganizacion: (organizationId: string) => Promise<string | null>;
  sucursales: (organizationId: string) => Promise<number>;
  sendTemplate: SendWhatsappTemplate;
  registrarEnConversacion?: (envio: EnvioDePlantilla) => Promise<void>;
  proximaApertura?: (organizationId: string, branchId: string, ahora: Date) => Promise<Date>;
}

export const depsDelEnvioReales: DepsDelEnvio = {
  accessToken: () => env.WHATSAPP_ACCESS_TOKEN,
  plantillaDeLaRegla: async (organizationId, automationId) => {
    const p = await findApprovedWhatsappTemplate(organizationId, automationId);
    return p ? { name: p.name, languageCode: p.language, bodyText: p.bodyText } : null;
  },
  numeroDeLaSucursal: findBranchWhatsappPhoneNumberId,
  numeroDeLaOrganizacion: findOrganizationWhatsappPhoneNumberId,
  sucursales: (organizationId) =>
    prisma.branch.count({ where: { organizationId, deletedAt: null } }),
  sendTemplate: sendWhatsappTemplateReal,
  proximaApertura: proximaAperturaDeLaSucursal,
};

/** Por qué el mensaje ya no corresponde (§6.3), o null. Va de lo más general
 *  a lo más puntual. Sin teléfono no es un motivo de acá: es "sin WhatsApp"
 *  (con la tarea), que decide procesarMensaje. */
export async function motivoParaNoMandar(fila: MensajeParaEnviar): Promise<string | null> {
  if (!(await tieneElModulo(fila.organizationId))) return MOTIVO_SIN_MODULO;
  if (!fila.automation.isActive || fila.automation.deletedAt !== null) return MOTIVO_REGLA_INACTIVA;
  const v = fila.customerVehicle;
  if (!v || v.deletedAt !== null || v.ownershipEndedAt !== null || v.contactId !== fila.contactId) {
    return MOTIVO_VEHICULO_NO_VIGENTE;
  }
  if (
    !fila.dueKey ||
    !v.nextServiceDueOn ||
    v.nextServiceDueOn.getTime() !== fila.dueKey.getTime()
  ) {
    return MOTIVO_FECHA_CAMBIO;
  }
  if (v.serviceOrders.length > 0) return MOTIVO_ORDEN_ABIERTA;
  if (v.remindersOptOut) return MOTIVO_NO_RECORDAR;
  if (fila.contact.deletedAt !== null || fila.contact.noInterestAt !== null) {
    return MOTIVO_CONTACTO_NO_VIGENTE;
  }
  return null;
}

/** Pura: los valores de cada variable de la plantilla (§6.4). */
export function valoresDelMensaje(fila: MensajeParaEnviar, sucursales: number) {
  const v = fila.customerVehicle!;
  return {
    [TOKEN_NOMBRE]: fila.contact.firstName.trim() || "cliente",
    [TOKEN_LUGAR]: textoDelLugar(fila.organization.name, v.branch?.name ?? null, sucursales),
    [TOKEN_VEHICULO]: textoDelVehiculo(v),
    [TOKEN_FECHA]: textoDeLaFecha(fila.dueKey!),
  };
}

function quiereTarea(fila: MensajeParaEnviar): boolean {
  const config = configDelRecordatorioDelServiceSchema.safeParse(fila.automation.actionConfig);
  return config.success ? config.data.tareaSiNoTieneWhatsapp : true;
}

/** ¿Meta rechazó el envío porque el cliente apagó el marketing? (D8) */
export function esSinMarketing(err: unknown): boolean {
  return err instanceof WhatsappGraphError && err.codigo !== null
    ? CODIGOS_SIN_MARKETING.has(err.codigo)
    : false;
}

export type ResultadoDelMensaje =
  | { resultado: "ENVIADO"; envio: EnvioDePlantilla }
  | { resultado: "CANCELADO"; motivo: string }
  // Sin WhatsApp (D8): se cancela y, con la casilla, va la tarea.
  | { resultado: "SIN_WHATSAPP"; motivo: string; tarea: boolean }
  | { resultado: "FUERA_DE_HORARIO"; hasta: Date };

export async function procesarMensaje(
  reclamo: MensajeReclamado,
  accessToken: string,
  deps: DepsDelEnvio,
  ahora: Date = new Date(),
): Promise<ResultadoDelMensaje> {
  const fila = await leerMensajeParaEnviar(reclamo.id, reclamo.organizationId);
  if (!fila) throw new ErrorPermanenteDelSeguimiento("La fila del mensaje del taller ya no existe");
  const motivo = await motivoParaNoMandar(fila);
  if (motivo) return { resultado: "CANCELADO", motivo };
  const tarea = quiereTarea(fila);
  const v = fila.customerVehicle!;

  // El taller inicia el contacto: dentro del horario de la sucursal.
  const sucursalDelEnvio = fila.branchId ?? v.branchId;
  if (sucursalDelEnvio && deps.proximaApertura) {
    const apertura = await deps.proximaApertura(fila.organizationId, sucursalDelEnvio, ahora);
    if (apertura.getTime() > ahora.getTime())
      return { resultado: "FUERA_DE_HORARIO", hasta: apertura };
  }

  const destino = soloDigitos(fila.contact.phone ?? "");
  if (destino === "") return { resultado: "SIN_WHATSAPP", motivo: MOTIVO_SIN_WHATSAPP, tarea };
  const phoneNumberId =
    (sucursalDelEnvio
      ? await deps.numeroDeLaSucursal(fila.organizationId, sucursalDelEnvio)
      : null) ?? (await deps.numeroDeLaOrganizacion(fila.organizationId));
  if (!phoneNumberId) return { resultado: "SIN_WHATSAPP", motivo: MOTIVO_SIN_NUMERO, tarea };
  const plantilla = await deps.plantillaDeLaRegla(fila.organizationId, fila.automationId);
  if (!plantilla) return { resultado: "SIN_WHATSAPP", motivo: MOTIVO_SIN_PLANTILLA, tarea };

  const parametros = parametrosDePlantilla(
    plantilla.bodyText,
    valoresDelMensaje(fila, await deps.sucursales(fila.organizationId)),
  );
  try {
    const salidas = await salidasPara(fila.organizationId, deps);
    const { wamid } = await salidas.sendTemplate({
      phoneNumberId,
      to: destino,
      templateName: plantilla.name,
      languageCode: plantilla.languageCode,
      bodyParameters: parametros,
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
  } catch (err) {
    if (esSinMarketing(err))
      return { resultado: "SIN_WHATSAPP", motivo: MOTIVO_SIN_MARKETING, tarea };
    throw err;
  }
}

export interface ResumenDelEnvio {
  enviados: number;
  cancelados: number;
  sinWhatsapp: number;
  tareas: number;
  pospuestos: number;
  fallidos: number;
  sinConfiguracion: boolean;
}

export interface OpcionesDelDrenado {
  ahora?: Date;
  organizationId?: string;
  limite?: number;
  deps?: DepsDelEnvio;
}

async function registrarFallo(
  reclamo: MensajeReclamado,
  err: unknown,
  ahora: Date,
  resumen: ResumenDelEnvio,
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
      { err, serviceMessageId: reclamo.id, attempts: reclamo.attempts },
      "Recordatorio del próximo service en FAILED: el cliente no recibió el WhatsApp",
    );
    return;
  }
  await reprogramarIntento(reclamo, { nextAttemptAt: resolucion.nextAttemptAt, motivo });
  resumen.pospuestos++;
}

/** Una pasada: manda los vencidos. */
export async function drenarMensajesDelTaller(
  opciones: OpcionesDelDrenado = {},
): Promise<ResumenDelEnvio> {
  const ahora = opciones.ahora ?? new Date();
  const deps = opciones.deps ?? depsDelEnvioReales;
  const limite = opciones.limite ?? LOTE;
  const resumen: ResumenDelEnvio = {
    enviados: 0,
    cancelados: 0,
    sinWhatsapp: 0,
    tareas: 0,
    pospuestos: 0,
    fallidos: 0,
    sinConfiguracion: false,
  };

  // Sin el token de la plataforma no se reclama nada: las filas esperan sin
  // gastar intentos (lo mismo que el recordatorio de turno).
  const accessToken = deps.accessToken()?.trim();
  if (!accessToken) {
    resumen.sinConfiguracion = true;
    return resumen;
  }

  for (let i = 0; i < limite; i++) {
    const reclamo = await reclamarMensaje(LEASE_MS, ahora, {
      ...(opciones.organizationId ? { organizationId: opciones.organizationId } : {}),
    });
    if (!reclamo) break;
    try {
      const r = await procesarMensaje(reclamo, accessToken, deps, ahora);
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
      if (r.resultado === "SIN_WHATSAPP") {
        await marcarCancelado(reclamo, r.motivo);
        resumen.sinWhatsapp++;
        if (r.tarea) {
          const fila = await leerMensajeParaEnviar(reclamo.id, reclamo.organizationId);
          if (fila?.noticeId) {
            const hecha = await crearTareaDelAviso({
              organizationId: fila.organizationId,
              automationId: fila.automationId,
              noticeId: fila.noticeId,
              notes: `No se pudo mandar el recordatorio por WhatsApp: ${r.motivo}.`,
              ahora,
            });
            if (hecha === "CREADA") resumen.tareas++;
          }
        }
        continue;
      }
      await marcarEnviado(reclamo, { sentAt: ahora, externalMessageId: r.envio.wamid });
      resumen.enviados++;
      await anotarEnvioEnConversacion(r.envio, deps.registrarEnConversacion);
    } catch (err) {
      await registrarFallo(reclamo, err, ahora, resumen);
    }
  }
  return resumen;
}

export function iniciarWorkerDeMensajesDelTaller(
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
        const r = await drenarMensajesDelTaller();
        if (r.enviados + r.cancelados + r.sinWhatsapp + r.fallidos > 0) {
          logger.info(r, "Recordatorios del próximo service procesados");
        }
      } catch (err) {
        logger.error({ err }, "Fallo inesperado en el worker de mensajes del taller");
      }
    })();
    await tickEnCurso;
    if (!detenido) timer = setTimeout(() => void tick(), pollMs);
  };

  logger.info({ pollMs }, "Worker de mensajes del taller iniciado");
  timer = setTimeout(() => void tick(), pollMs);
  return async () => {
    detenido = true;
    if (timer) clearTimeout(timer);
    await tickEnCurso;
  };
}
