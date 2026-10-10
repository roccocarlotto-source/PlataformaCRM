import { env } from "../config/env";
import { logger } from "../lib/logger";
import { soloDigitos } from "../lib/telefono";
import {
  findAgentDeLaConversacionParaElNivel,
  findBranchWhatsappPhoneNumberId,
} from "../repositories/agent.repository";
import { nivelEfectivo } from "../services/agentNivelDeIa";
import {
  claimNextInquiryFollowUp,
  existsInboundSince,
  findInquiryFollowUpParaEnviar,
  markInquiryFollowUpCancelled,
  markInquiryFollowUpFailed,
  markInquiryFollowUpSent,
  posponerInquiryFollowUpHasta,
  rescheduleInquiryFollowUp,
  type InquiryFollowUpParaEnviar,
  type InquiryFollowUpReclamado,
} from "../repositories/inquiryFollowUp.repository";
import { countOpenOpportunitiesOf } from "../repositories/opportunity.repository";
import { findApprovedWhatsappTemplate } from "../repositories/whatsappTemplate.repository";
import { vehiculoParaElMensaje } from "../services/automationActions/inquiryFollowUp";
import {
  anotarEnvioEnConversacion,
  type EnvioDePlantilla,
} from "../services/automationWhatsappConversation.service";
import { proximaAperturaDeLaSucursal } from "../services/branchBusinessHours.service";
import { generarMensajeDeSeguimientoDeConsulta } from "../services/inquiryFollowUpDraft.service";
import {
  sendWhatsappTemplateReal,
  sendWhatsappTextReal,
  type SendWhatsappTemplate,
  type SendWhatsappText,
} from "../services/whatsappGraph.service";
import { describirError, resolverFalloDelJob, type ClaseDeFallo } from "../utils/backoff";
import { esNombreProvisorio, tieneLetras } from "../utils/nombreProvisorio";
import { finDeLaVentanaDeWhatsapp, ventanaDeWhatsappAbierta } from "../utils/ventanaDeWhatsapp";
import {
  TOKEN_PRESTACION,
  TOKEN_SALUDO,
  TOKEN_VEHICULO,
  parametrosDePlantilla,
} from "../utils/whatsappTemplateText";
import { findEdicionYRubro } from "../repositories/organization.repository";
import {
  MOTIVO_TURNO_DEL_PACIENTE,
  prestacionParaElMensaje,
  turnoFrenaElSeguimiento,
} from "../clinicas/seguimientoDeConsultas";
import {
  ErrorPermanenteDelSeguimiento,
  clasificarFallo as clasificarFalloDelSeguimientoQr,
  type ResultadoDelEnvio as ResultadoDelEnvioDelSeguimiento,
} from "./qrFollowUpWorker";

// ---------------------------------------------------------------------------
// El worker de seguimientos de consultas por WhatsApp (ítem 185 de
// docs/frontend-cambios-pendientes.md). La acción inquiry.follow_up agenda
// una fila en inquiry_follow_ups (kind WHATSAPP) cuando un contacto consultó
// y se quedó callado; esto la manda.
//
// EL MISMO ESQUELETO QUE discountVoucherFollowUpWorker.ts: polling, reclamo
// con lease, backoff, tope de intentos, arranque en server.ts detrás de
// workersHabilitados(); se relee todo antes de mandar, lo que ya no
// corresponde se CANCELA sin error, y fuera del horario de la sucursal se
// pospone sin gastar el intento (G-07).
//
// LO PROPIO DE ACÁ:
//   - Qué sale. Dentro de las 24 h del último mensaje del cliente, Meta
//     acepta texto libre: el agente redacta un mensaje con el contexto de la
//     conversación (inquiryFollowUpDraft.service.ts) y se manda como texto.
//     Pasada la ventana —lo normal, porque X se mide en días— sale la
//     plantilla aprobada de la regla, con {saludo} y {vehiculo}.
//   - El saludo (decisión de Rocco, 08/10/2026): con el nombre real del
//     contacto, o el del perfil de WhatsApp (que es lo que el canal carga
//     como nombre); si no hay ninguno, "Hola" a secas. Nunca un nombre
//     provisorio ni vacío: por eso la variable es el saludo y no el nombre.
//   - Cancela también si el cliente escribió después de agendarse, si se lo
//     marcó sin interés o si abrió una oportunidad.
// ---------------------------------------------------------------------------

export interface DepsDelSeguimientoDeConsulta {
  accessToken: () => string | undefined;
  plantillaDeLaRegla: (
    organizationId: string,
    automationId: string,
  ) => Promise<{ name: string; languageCode: string; bodyText: string } | null>;
  numeroDeLaSucursal: (organizationId: string, branchId: string) => Promise<string | null>;
  proximaApertura: (organizationId: string, branchId: string, ahora: Date) => Promise<Date>;
  respondioDespues: (organizationId: string, contactId: string, desde: Date) => Promise<boolean>;
  hayOportunidadAbierta: (contactId: string, organizationId: string) => Promise<boolean>;
  sendTemplate: SendWhatsappTemplate;
  sendText: SendWhatsappText;
  // El texto libre del agente para la ventana de 24 h.
  generarTexto: (fila: InquiryFollowUpParaEnviar, ahora: Date) => Promise<string>;
  // D9 (docs/ediciones.md §4.5): si el agente de la conversación responde
  // solo (AUTONOMA, activo y no borrado). Si no, la plantilla aprobada aunque
  // la ventana esté abierta: un texto libre de la IA no le llega a nadie que
  // haya bajado la participación de la IA.
  agenteRespondeSolo: (organizationId: string, conversationId: string) => Promise<boolean>;
  registrarEnConversacion?: (envio: EnvioDePlantilla) => Promise<void>;
  // R15 (docs/rubros.md §9.1): si la organización es una clínica (siempre la
  // plantilla, D7) y si un turno del contacto frena el seguimiento.
  esClinica: (organizationId: string) => Promise<boolean>;
  turnoFrena: (
    organizationId: string,
    automationId: string,
    contactId: string,
    ahora: Date,
  ) => Promise<boolean>;
  ahora: () => Date;
}

export const depsDelSeguimientoDeConsultaReales: DepsDelSeguimientoDeConsulta = {
  accessToken: () => env.WHATSAPP_ACCESS_TOKEN,
  plantillaDeLaRegla: async (organizationId, automationId) => {
    const plantilla = await findApprovedWhatsappTemplate(organizationId, automationId);
    return plantilla
      ? { name: plantilla.name, languageCode: plantilla.language, bodyText: plantilla.bodyText }
      : null;
  },
  numeroDeLaSucursal: findBranchWhatsappPhoneNumberId,
  proximaApertura: proximaAperturaDeLaSucursal,
  respondioDespues: existsInboundSince,
  hayOportunidadAbierta: (contactId, organizationId) =>
    countOpenOpportunitiesOf({ contactId }, organizationId).then((n) => n > 0),
  sendTemplate: sendWhatsappTemplateReal,
  sendText: sendWhatsappTextReal,
  generarTexto: (fila, ahora) =>
    generarMensajeDeSeguimientoDeConsulta(
      fila.organizationId,
      fila.contactId,
      fila.conversationId,
      fila.lastInboundAt,
      { ahora },
    ),
  agenteRespondeSolo: async (organizationId, conversationId) => {
    const fila = await findAgentDeLaConversacionParaElNivel(conversationId, organizationId);
    if (!fila) return false;
    const { agent, organization } = fila;
    return (
      agent.isActive &&
      agent.deletedAt === null &&
      nivelEfectivo(agent, organization.edition) === "AUTONOMA"
    );
  },
  esClinica: (organizationId) =>
    findEdicionYRubro(organizationId).then((o) => o.industry === "CLINICA"),
  turnoFrena: (organizationId, automationId, contactId, ahora) =>
    turnoFrenaElSeguimiento(organizationId, automationId, contactId, ahora, true),
  ahora: () => new Date(),
};

export interface ConfiguracionDelEnvio {
  accessToken: string;
}

export function leerConfiguracion(
  deps: Pick<DepsDelSeguimientoDeConsulta, "accessToken">,
): { ok: true; config: ConfiguracionDelEnvio } | { ok: false; faltan: string[] } {
  const accessToken = deps.accessToken()?.trim();
  if (!accessToken) {
    return { ok: false, faltan: ["WHATSAPP_ACCESS_TOKEN"] };
  }
  return { ok: true, config: { accessToken } };
}

export const clasificarFallo = clasificarFalloDelSeguimientoQr;

// Pura: el {saludo} de la plantilla. "Hola Martín" con un nombre real o el
// del perfil de WhatsApp (firstName con letras que no sea un provisorio);
// "Hola" si no hay.
export function saludoParaElCliente(contacto: {
  firstName: string;
  lastName: string | null;
}): string {
  const nombre = contacto.firstName.trim();
  if (esNombreProvisorio(contacto) || !tieneLetras(nombre)) {
    return "Hola";
  }
  return `Hola ${nombre}`;
}

// Pura: por qué el envío ya no corresponde, o null.
export function motivoDeCancelacion(
  fila: Pick<InquiryFollowUpParaEnviar, "automation" | "contact" | "branch">,
  // turnoDelPaciente: R15, solo en una clínica.
  estado: { respondio: boolean; oportunidadAbierta: boolean; turnoDelPaciente?: boolean },
): string | null {
  if (fila.automation.deletedAt !== null) {
    return "Se borró la automatización que lo agendó";
  }
  if (!fila.automation.isActive) {
    return "La automatización que lo agendó está desactivada";
  }
  if (fila.contact.deletedAt !== null) {
    return "Se borró el contacto";
  }
  if (fila.contact.noInterestAt !== null) {
    return "El contacto está marcado sin interés";
  }
  if (fila.branch.deletedAt !== null) {
    return "Se borró la sucursal desde la que salía el WhatsApp";
  }
  if (estado.respondio) {
    return "El cliente volvió a escribir después de agendarse el seguimiento";
  }
  if (estado.oportunidadAbierta) {
    return "El contacto ya tiene una oportunidad abierta";
  }
  if (estado.turnoDelPaciente === true) {
    return MOTIVO_TURNO_DEL_PACIENTE;
  }
  return null;
}

export type ResultadoDelEnvio = ResultadoDelEnvioDelSeguimiento;

export async function procesarSeguimientoDeConsulta(
  reclamo: InquiryFollowUpReclamado,
  config: ConfiguracionDelEnvio,
  deps: Omit<DepsDelSeguimientoDeConsulta, "accessToken" | "registrarEnConversacion">,
  leer: (
    id: string,
    organizationId: string,
  ) => Promise<InquiryFollowUpParaEnviar | null> = findInquiryFollowUpParaEnviar,
): Promise<ResultadoDelEnvio> {
  const fila = await leer(reclamo.id, reclamo.organizationId);
  if (!fila) {
    throw new ErrorPermanenteDelSeguimiento("La fila del seguimiento agendado ya no existe");
  }

  const clinica = await deps.esClinica(fila.organizationId);
  const motivo = motivoDeCancelacion(fila, {
    respondio: await deps.respondioDespues(fila.organizationId, fila.contactId, fila.lastInboundAt),
    oportunidadAbierta: await deps.hayOportunidadAbierta(fila.contactId, fila.organizationId),
    // R15: solo una clínica lee los turnos.
    ...(clinica
      ? {
          turnoDelPaciente: await deps.turnoFrena(
            fila.organizationId,
            fila.automationId,
            fila.contactId,
            deps.ahora(),
          ),
        }
      : {}),
  });
  if (motivo !== null) {
    return { resultado: "CANCELADO", motivo };
  }

  const ahora = deps.ahora();
  const apertura = await deps.proximaApertura(fila.organizationId, fila.branchId, ahora);
  if (apertura.getTime() > ahora.getTime()) {
    return { resultado: "FUERA_DE_HORARIO", hasta: apertura };
  }

  const destino = soloDigitos(fila.contact.phone ?? "");
  if (destino === "") {
    throw new ErrorPermanenteDelSeguimiento("El contacto no tiene un teléfono cargado");
  }
  const phoneNumberId = await deps.numeroDeLaSucursal(fila.organizationId, fila.branchId);
  if (!phoneNumberId) {
    throw new ErrorPermanenteDelSeguimiento(
      "La sucursal de la conversación no tiene un número de WhatsApp conectado (ningún agente de la sucursal tiene número)",
    );
  }

  const base = {
    organizationId: fila.organizationId,
    contactId: fila.contactId,
    phoneNumberId,
    destino,
  };

  // Dentro de la ventana, texto libre del agente; fuera, la plantilla. El texto
  // libre, además, solo con un agente que responde solo (D9).
  // R15 (D7): en una clínica, siempre la plantilla, también en AUTONOMA.
  if (
    !clinica &&
    ventanaDeWhatsappAbierta(finDeLaVentanaDeWhatsapp(fila.lastInboundAt), ahora) &&
    (await deps.agenteRespondeSolo(fila.organizationId, fila.conversationId))
  ) {
    const texto = await deps.generarTexto(fila, ahora);
    const { wamid } = await deps.sendText({
      phoneNumberId,
      to: destino,
      body: texto,
      accessToken: config.accessToken,
    });
    return {
      resultado: "ENVIADO",
      envio: {
        ...base,
        plantilla: { name: "texto-libre", bodyText: texto },
        parametros: [],
        wamid,
      },
    };
  }

  const plantilla = await deps.plantillaDeLaRegla(fila.organizationId, fila.automationId);
  if (!plantilla) {
    throw new ErrorPermanenteDelSeguimiento(
      "La automatización no tiene una plantilla de WhatsApp aprobada (se borró o Meta dejó de aprobarla antes del envío)",
    );
  }
  const parametros = parametrosDePlantilla(plantilla.bodyText, {
    [TOKEN_SALUDO]: saludoParaElCliente(fila.contact),
    [TOKEN_VEHICULO]: vehiculoParaElMensaje(fila.contact),
    // R15: solo lo lleva la plantilla de una clínica.
    [TOKEN_PRESTACION]: prestacionParaElMensaje(fila.contact),
  });
  const { wamid } = await deps.sendTemplate({
    phoneNumberId,
    to: destino,
    templateName: plantilla.name,
    languageCode: plantilla.languageCode,
    bodyParameters: parametros,
    accessToken: config.accessToken,
  });
  return {
    resultado: "ENVIADO",
    envio: { ...base, plantilla, parametros, wamid },
  };
}

export interface ResumenDrenado {
  enviados: number;
  cancelados: number;
  pospuestos: number;
  fallidos: number;
  fueraDeHorario: number;
  sinConfiguracion: boolean;
}

export interface OpcionesDrenado {
  limite?: number;
  organizationId?: string;
  deps?: DepsDelSeguimientoDeConsulta;
  leaseMs?: number;
  debeSeguir?: () => boolean;
}

async function registrarFallo(
  reclamo: InquiryFollowUpReclamado,
  err: unknown,
  resumen: ResumenDrenado,
) {
  const lastError = describirError(err);
  const resolucion = resolverFalloDelJob(
    reclamo.attempts,
    clasificarFallo(err) as ClaseDeFallo,
    new Date(),
    {
      maxIntentos: env.INQUIRY_FOLLOWUP_MAX_ATTEMPTS,
      backoff: {
        baseMs: env.INQUIRY_FOLLOWUP_BACKOFF_BASE_MS,
        topeMs: env.INQUIRY_FOLLOWUP_BACKOFF_MAX_MS,
      },
    },
  );

  try {
    if (resolucion.estado === "FAILED") {
      await markInquiryFollowUpFailed(reclamo, lastError);
      resumen.fallidos++;
      logger.error(
        { err, inquiryFollowUpId: reclamo.id, attempts: reclamo.attempts },
        "Seguimiento de consulta en FAILED: el cliente no recibió el WhatsApp",
      );
      return;
    }
    await rescheduleInquiryFollowUp(reclamo, {
      nextAttemptAt: resolucion.nextAttemptAt,
      lastError,
    });
    resumen.pospuestos++;
    logger.warn(
      { err, inquiryFollowUpId: reclamo.id, attempts: reclamo.attempts },
      "Seguimiento de consulta fallido: queda en PENDING para reintentar con backoff",
    );
  } catch (errContable) {
    logger.error(
      { err: errContable, inquiryFollowUpId: reclamo.id },
      "No se pudo registrar el fallo del seguimiento de consulta; se retoma cuando venza el lease",
    );
  }
}

async function registrarResultado(
  reclamo: InquiryFollowUpReclamado,
  resultado: ResultadoDelEnvio,
  resumen: ResumenDrenado,
  deps: DepsDelSeguimientoDeConsulta,
) {
  try {
    if (resultado.resultado === "ENVIADO") {
      await markInquiryFollowUpSent(reclamo, new Date());
      resumen.enviados++;
      // Queda en la conversación como Automatización, igual que el cupón.
      await anotarEnvioEnConversacion(resultado.envio, deps.registrarEnConversacion);
      return;
    }
    if (resultado.resultado === "FUERA_DE_HORARIO") {
      await posponerInquiryFollowUpHasta(reclamo, resultado.hasta);
      resumen.fueraDeHorario++;
      logger.info(
        { inquiryFollowUpId: reclamo.id, hasta: resultado.hasta },
        "Seguimiento de consulta fuera del horario de la sucursal: se corre a su próxima apertura",
      );
      return;
    }
    await markInquiryFollowUpCancelled(reclamo, resultado.motivo);
    resumen.cancelados++;
    logger.info(
      { inquiryFollowUpId: reclamo.id, motivo: resultado.motivo },
      "Seguimiento de consulta cancelado: ya no correspondía mandarlo",
    );
  } catch (err) {
    logger.error(
      { err, inquiryFollowUpId: reclamo.id, resultado: resultado.resultado },
      "No se pudo marcar el seguimiento de consulta; se vuelve a tomar cuando venza el lease",
    );
  }
}

export async function drenarSeguimientosDeConsultas(
  opciones: OpcionesDrenado = {},
): Promise<ResumenDrenado> {
  const limite = opciones.limite ?? env.INQUIRY_FOLLOWUP_WORKER_BATCH_SIZE;
  const deps = opciones.deps ?? depsDelSeguimientoDeConsultaReales;
  const leaseMs = opciones.leaseMs ?? env.INQUIRY_FOLLOWUP_LEASE_MS;
  const resumen: ResumenDrenado = {
    enviados: 0,
    cancelados: 0,
    pospuestos: 0,
    fallidos: 0,
    fueraDeHorario: 0,
    sinConfiguracion: false,
  };

  const configuracion = leerConfiguracion(deps);
  if (!configuracion.ok) {
    logger.error(
      { faltan: configuracion.faltan },
      "Seguimientos de consultas: falta configuración, no se manda ninguno (quedan en PENDING)",
    );
    resumen.sinConfiguracion = true;
    return resumen;
  }

  const pospuestos: string[] = [];

  for (let i = 0; i < limite; i++) {
    if (opciones.debeSeguir && !opciones.debeSeguir()) {
      break;
    }

    let reclamo: InquiryFollowUpReclamado | null;
    try {
      reclamo = await claimNextInquiryFollowUp(leaseMs, {
        organizationId: opciones.organizationId,
        excluir: pospuestos,
      });
    } catch (err) {
      logger.error({ err }, "No se pudo reclamar un seguimiento de consulta de la cola");
      break;
    }
    if (!reclamo) {
      break;
    }

    if (reclamo.attempts > env.INQUIRY_FOLLOWUP_MAX_ATTEMPTS) {
      const agotado = reclamo;
      await markInquiryFollowUpFailed(
        agotado,
        `Agotó sus ${String(env.INQUIRY_FOLLOWUP_MAX_ATTEMPTS)} intentos sin terminar (el proceso que lo tomaba no llegó a cerrarlo)`,
      ).catch((err: unknown) => {
        logger.error(
          { err, inquiryFollowUpId: agotado.id },
          "No se pudo marcar FAILED un seguimiento de consulta",
        );
      });
      resumen.fallidos++;
      continue;
    }

    let resultado: ResultadoDelEnvio;
    try {
      resultado = await procesarSeguimientoDeConsulta(reclamo, configuracion.config, deps);
    } catch (err) {
      await registrarFallo(reclamo, err, resumen);
      pospuestos.push(reclamo.id);
      continue;
    }
    await registrarResultado(reclamo, resultado, resumen, deps);
  }

  return resumen;
}

export interface OpcionesDelWorker {
  pollMs?: number;
  drenar?: (debeSeguir: () => boolean) => Promise<ResumenDrenado>;
}

export function iniciarWorkerDeSeguimientosDeConsultas(
  opciones: OpcionesDelWorker = {},
): () => Promise<void> {
  if (!env.INQUIRY_FOLLOWUP_WORKER_ENABLED) {
    logger.info(
      "Worker de seguimientos de consultas deshabilitado por INQUIRY_FOLLOWUP_WORKER_ENABLED: los envíos agendados quedan en la cola",
    );
    return () => Promise.resolve();
  }

  const pollMs = opciones.pollMs ?? env.INQUIRY_FOLLOWUP_WORKER_POLL_MS;
  const drenar =
    opciones.drenar ??
    ((debeSeguir: () => boolean) => drenarSeguimientosDeConsultas({ debeSeguir }));

  let detenido = false;
  let timer: NodeJS.Timeout | undefined;
  let tickEnCurso: Promise<void> | undefined;

  const tick = async () => {
    if (detenido) {
      return;
    }
    tickEnCurso = (async () => {
      try {
        const resumen = await drenar(() => !detenido);
        if (resumen.enviados + resumen.cancelados + resumen.pospuestos + resumen.fallidos > 0) {
          logger.info(resumen, "Drenado de seguimientos de consultas");
        }
      } catch (err) {
        logger.error({ err }, "Fallo inesperado en el drenado de seguimientos de consultas");
      }
    })();
    await tickEnCurso;
    if (!detenido) {
      timer = setTimeout(() => void tick(), pollMs);
    }
  };

  logger.info(
    { pollMs, batchSize: env.INQUIRY_FOLLOWUP_WORKER_BATCH_SIZE },
    "Worker de seguimientos de consultas iniciado",
  );
  timer = setTimeout(() => void tick(), 0);

  return async () => {
    detenido = true;
    if (timer) {
      clearTimeout(timer);
    }
    await tickEnCurso;
  };
}
