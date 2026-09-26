import { OpportunityStatus } from "@prisma/client";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { findBranchWhatsappPhoneNumberId } from "../repositories/agent.repository";
import { findApprovedWhatsappTemplate } from "../repositories/whatsappTemplate.repository";
import {
  claimNextQrFollowUp,
  findQrFollowUpParaEnviar,
  markQrFollowUpCancelled,
  markQrFollowUpFailed,
  markQrFollowUpSent,
  rescheduleQrFollowUp,
  type QrFollowUpParaEnviar,
  type QrFollowUpReclamado,
} from "../repositories/qrFollowUp.repository";
import { esTransitorio } from "../services/llmProvider.service";
import { soloDigitos } from "../services/whatsappContact.service";
import {
  sendWhatsappTemplateReal,
  WhatsappGraphError,
  type SendWhatsappTemplate,
} from "../services/whatsappGraph.service";
import { describirError, resolverFalloDelJob, type ClaseDeFallo } from "../utils/backoff";

// ---------------------------------------------------------------------------
// El worker de seguimientos por WhatsApp con el QR (ítem 159 de
// docs/frontend-cambios-pendientes.md). La acción
// opportunity.send_qr_followup agenda una fila en qr_follow_ups cuando una
// oportunidad pasa a ganada; esto la manda cuando vence.
//
// MISMO PATRÓN QUE agentInboundWorker.ts —polling in-process, setTimeout
// encadenado, arranque en server.ts detrás de workersHabilitados(), stop que
// espera la pasada en curso, reclamo con lease, backoff y tope de intentos—
// con una cadencia de minutos y no de un segundo: es un agradecimiento
// post-venta que la regla demora horas, no una respuesta que alguien espera.
//
// ANTES DE MANDAR SE RELEE TODO. Entre el agendado y el envío pueden pasar
// días: la oportunidad pudo volver a abierta o perderse, el QR o el contacto
// borrarse, la regla desactivarse. Cualquiera de esos casos CANCELA la fila
// sin mandar nada (CANCELLED con el motivo en lastError): no es un error, es
// que ya no corresponde. El estado de la oportunidad se LEE; el único que lo
// escribe sigue siendo opportunity.service.ts.
//
// QUÉ SE REINTENTA, con el criterio de siempre: lo que puede salir bien la
// próxima vez. Un 429/5xx de Meta, la red o la base: backoff hasta el tope.
// Un 4xx de Meta (plantilla inexistente o no aprobada, número inválido, token
// vencido) y los datos que faltan (contacto sin teléfono, sucursal sin número
// de WhatsApp) son permanentes: FAILED en el primer intento, con el motivo.
//
// VENTANA ACEPTADA: si el proceso muere DESPUÉS de que Meta aceptó el envío y
// ANTES de marcar SENT, el lease vence y el mensaje sale dos veces. Es la
// misma ventana que el outbox y el dispatcher documentan, y no se puede
// cerrar: un WhatsApp enviado no se revierte.
// ---------------------------------------------------------------------------

export interface PlantillaDeSeguimiento {
  name: string;
  languageCode: string;
}

export interface DepsDelSeguimiento {
  accessToken: () => string | undefined;
  // La plantilla APROBADA y activa de la organización, o null (ítem 160).
  plantillaDeLaOrganizacion: (organizationId: string) => Promise<PlantillaDeSeguimiento | null>;
  numeroDeLaSucursal: (organizationId: string, branchId: string) => Promise<string | null>;
  sendTemplate: SendWhatsappTemplate;
}

export const depsDelSeguimientoReales: DepsDelSeguimiento = {
  accessToken: () => env.WHATSAPP_ACCESS_TOKEN,
  plantillaDeLaOrganizacion: async (organizationId) => {
    const plantilla = await findApprovedWhatsappTemplate(organizationId);
    return plantilla ? { name: plantilla.name, languageCode: plantilla.language } : null;
  },
  numeroDeLaSucursal: findBranchWhatsappPhoneNumberId,
  sendTemplate: sendWhatsappTemplateReal,
};

// Lo único GLOBAL que el envío necesita. Hasta el ítem 160 incluía la
// plantilla (dos variables de Render, una para toda la plataforma); ahora la
// plantilla es de cada organización y se lee al mandar.
export interface ConfiguracionDeEnvio {
  accessToken: string;
}

// Pura: la configuración completa, o los nombres de las variables que faltan.
// El string vacío cuenta como ausente (una línea `X=` en el .env).
export function leerConfiguracion(
  deps: Pick<DepsDelSeguimiento, "accessToken">,
): { ok: true; config: ConfiguracionDeEnvio } | { ok: false; faltan: string[] } {
  const accessToken = deps.accessToken()?.trim();
  if (!accessToken) {
    return { ok: false, faltan: ["WHATSAPP_ACCESS_TOKEN"] };
  }
  return { ok: true, config: { accessToken } };
}

// Un fallo que no se arregla reintentando y no viene de Meta: un dato que falta.
export class ErrorPermanenteDelSeguimiento extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErrorPermanenteDelSeguimiento";
    Object.setPrototypeOf(this, ErrorPermanenteDelSeguimiento.prototype);
  }
}

// Pura, para probarla sin base: qué errores vale la pena reintentar. Mismo
// corte que la cola de turnos para la Graph API (esTransitorio: 429 o 5xx).
export function clasificarFallo(err: unknown): ClaseDeFallo {
  if (err instanceof ErrorPermanenteDelSeguimiento) {
    return "PERMANENTE";
  }
  if (err instanceof WhatsappGraphError) {
    return esTransitorio(err.status) ? "TRANSITORIO" : "PERMANENTE";
  }
  // Red, timeout, la base que no responde, un bug: se reintenta, y el tope de
  // intentos es lo que evita que uno determinístico gire para siempre.
  return "TRANSITORIO";
}

// Pura: por qué el envío ya no corresponde, o null si sigue correspondiendo.
// El orden va de lo más general a lo más puntual, para que el motivo que queda
// en lastError sea el que explica más.
export function motivoDeCancelacion(
  fila: Pick<QrFollowUpParaEnviar, "automation" | "opportunity" | "contact" | "qrCode">,
): string | null {
  if (fila.automation.deletedAt !== null) {
    return "Se borró la automatización que lo agendó";
  }
  if (!fila.automation.isActive) {
    return "La automatización que lo agendó está desactivada";
  }
  if (fila.opportunity.deletedAt !== null) {
    return "Se borró la oportunidad";
  }
  if (fila.opportunity.status !== OpportunityStatus.WON) {
    return `La oportunidad ya no está ganada (estado actual: ${fila.opportunity.status})`;
  }
  if (fila.contact.deletedAt !== null) {
    return "Se borró el contacto";
  }
  if (fila.qrCode.deletedAt !== null) {
    return "Se borró el QR";
  }
  return null;
}

// {{1}} de la plantilla. Meta rechaza un parámetro vacío; firstName es NOT
// NULL, pero un nombre en blanco no tiene por qué costar el envío.
export function nombreParaElSaludo(firstName: string): string {
  return firstName.trim() || "cliente";
}

export type ResultadoDelEnvio =
  { resultado: "ENVIADO" } | { resultado: "CANCELADO"; motivo: string };

// Un envío reclamado: relee, decide y manda. Lanza ante cualquier fallo; el
// que llama lo clasifica. No escribe ninguna marca: eso lo hace el drenado.
export async function procesarSeguimiento(
  reclamo: QrFollowUpReclamado,
  config: ConfiguracionDeEnvio,
  deps: Pick<
    DepsDelSeguimiento,
    "plantillaDeLaOrganizacion" | "numeroDeLaSucursal" | "sendTemplate"
  >,
  leer: (id: string, organizationId: string) => Promise<QrFollowUpParaEnviar | null> = (
    id,
    organizationId,
  ) => findQrFollowUpParaEnviar(id, organizationId),
): Promise<ResultadoDelEnvio> {
  const fila = await leer(reclamo.id, reclamo.organizationId);
  if (!fila) {
    throw new ErrorPermanenteDelSeguimiento("La fila del seguimiento ya no existe");
  }

  const motivo = motivoDeCancelacion(fila);
  if (motivo !== null) {
    return { resultado: "CANCELADO", motivo };
  }

  // El wa_id de Meta: solo dígitos, con código de país. Contact.phone es texto
  // libre; si se cargó sin código de país Meta lo rechaza con un 4xx, que
  // queda en lastError tal cual lo explica Meta.
  const destino = soloDigitos(fila.contact.phone ?? "");
  if (destino === "") {
    throw new ErrorPermanenteDelSeguimiento("El contacto no tiene un teléfono cargado");
  }

  const phoneNumberId = await deps.numeroDeLaSucursal(fila.organizationId, fila.qrCode.branchId);
  if (!phoneNumberId) {
    throw new ErrorPermanenteDelSeguimiento(
      "La sucursal del QR no tiene un número de WhatsApp conectado (ningún agente de la sucursal tiene número)",
    );
  }

  // La plantilla se relee acá, justo antes de mandar, igual que todo lo demás:
  // el reclamo solo toma filas de organizaciones con plantilla aprobada, pero
  // entre el reclamo y este punto el negocio pudo borrarla, o Meta pausarla.
  // Sin plantilla no hay con qué mandar, y no es algo que un reintento
  // arregle: FAILED con el motivo. (Si la organización carga otra plantilla,
  // las filas que siguen en PENDING salen con ella.)
  const plantilla = await deps.plantillaDeLaOrganizacion(fila.organizationId);
  if (!plantilla) {
    throw new ErrorPermanenteDelSeguimiento(
      "La organización ya no tiene una plantilla de WhatsApp aprobada (se borró o Meta dejó de aprobarla antes del envío)",
    );
  }

  await deps.sendTemplate({
    phoneNumberId,
    to: destino,
    templateName: plantilla.name,
    languageCode: plantilla.languageCode,
    // Posicionales: {{1}} el nombre del contacto, {{2}} el link del QR.
    bodyParameters: [nombreParaElSaludo(fila.contact.firstName), fila.qrCode.destinationUrl],
    accessToken: config.accessToken,
  });
  return { resultado: "ENVIADO" };
}

export interface ResumenDrenado {
  enviados: number;
  cancelados: number;
  // Fallaron con un error transitorio y quedaron en PENDING con su próximo
  // intento programado por backoff.
  pospuestos: number;
  // Pasaron a FAILED: error permanente o reintentos agotados.
  fallidos: number;
  // Falta configuración: la pasada no reclamó nada.
  sinConfiguracion: boolean;
}

export interface OpcionesDrenado {
  limite?: number;
  // Acota el drenado a una organización. Producción no lo usa; los tests de
  // integración sí, para no depender de que el resto de la tabla esté vacía.
  organizationId?: string;
  deps?: DepsDelSeguimiento;
  leaseMs?: number;
  // Consultado antes de cada reclamo: el stop del worker lo pone en false.
  debeSeguir?: () => boolean;
}

async function registrarFallo(reclamo: QrFollowUpReclamado, err: unknown, resumen: ResumenDrenado) {
  const lastError = describirError(err);
  const resolucion = resolverFalloDelJob(reclamo.attempts, clasificarFallo(err), new Date(), {
    maxIntentos: env.QR_FOLLOWUP_MAX_ATTEMPTS,
    backoff: { baseMs: env.QR_FOLLOWUP_BACKOFF_BASE_MS, topeMs: env.QR_FOLLOWUP_BACKOFF_MAX_MS },
  });

  try {
    if (resolucion.estado === "FAILED") {
      await markQrFollowUpFailed(reclamo, lastError);
      resumen.fallidos++;
      logger.error(
        { err, qrFollowUpId: reclamo.id, attempts: reclamo.attempts },
        "Seguimiento con QR en FAILED: el cliente no recibió el WhatsApp",
      );
      return;
    }
    await rescheduleQrFollowUp(reclamo, { nextAttemptAt: resolucion.nextAttemptAt, lastError });
    resumen.pospuestos++;
    logger.warn(
      {
        err,
        qrFollowUpId: reclamo.id,
        attempts: reclamo.attempts,
        nextAttemptAt: resolucion.nextAttemptAt,
      },
      "Seguimiento con QR fallido: queda en PENDING para reintentar con backoff",
    );
  } catch (errContable) {
    // La base es justamente lo que falló: la fila queda en PENDING con el
    // lease corrido y se retoma cuando venza, con el intento ya contado.
    logger.error(
      { err: errContable, qrFollowUpId: reclamo.id },
      "No se pudo registrar el fallo del seguimiento con QR; se retoma cuando venza el lease",
    );
  }
}

async function registrarResultado(
  reclamo: QrFollowUpReclamado,
  resultado: ResultadoDelEnvio,
  resumen: ResumenDrenado,
) {
  try {
    if (resultado.resultado === "ENVIADO") {
      await markQrFollowUpSent(reclamo, new Date());
      resumen.enviados++;
      return;
    }
    await markQrFollowUpCancelled(reclamo, resultado.motivo);
    resumen.cancelados++;
    logger.info(
      { qrFollowUpId: reclamo.id, motivo: resultado.motivo },
      "Seguimiento con QR cancelado: ya no correspondía mandarlo",
    );
  } catch (err) {
    // El WhatsApp YA SALIÓ (o ya se decidió no mandarlo) y no se pudo anotar.
    // Es la ventana del encabezado: al vencer el lease la fila se vuelve a
    // reclamar y, si era un envío, sale de nuevo. No se registra como fallo:
    // eso reprogramaría con backoff un envío que funcionó.
    logger.error(
      { err, qrFollowUpId: reclamo.id, resultado: resultado.resultado },
      "No se pudo marcar el seguimiento con QR; se vuelve a tomar cuando venza el lease",
    );
  }
}

export async function drenarSeguimientosQr(
  opciones: OpcionesDrenado = {},
): Promise<ResumenDrenado> {
  const limite = opciones.limite ?? env.QR_FOLLOWUP_WORKER_BATCH_SIZE;
  const deps = opciones.deps ?? depsDelSeguimientoReales;
  const leaseMs = opciones.leaseMs ?? env.QR_FOLLOWUP_LEASE_MS;
  const resumen: ResumenDrenado = {
    enviados: 0,
    cancelados: 0,
    pospuestos: 0,
    fallidos: 0,
    sinConfiguracion: false,
  };

  // SIN TOKEN NO SE RECLAMA NADA: reclamar gastaría intentos de filas que no
  // pueden salir por un motivo que no es suyo. Quedan en PENDING y salen solas
  // en la primera pasada después de configurar la variable. Error en el log en
  // CADA pasada, no una vez al arrancar: si alguien creó una regla y nada
  // sale, el motivo tiene que estar donde mire. La plantilla ya no es parte de
  // esto (ítem 160): es de cada organización, y la que no tiene una aprobada
  // simplemente no se reclama (ver claimNextQrFollowUp).
  const configuracion = leerConfiguracion(deps);
  if (!configuracion.ok) {
    logger.error(
      { faltan: configuracion.faltan },
      "Seguimientos con QR: falta el token de WhatsApp, no se manda ninguno (quedan en PENDING)",
    );
    resumen.sinConfiguracion = true;
    return resumen;
  }

  // Mismo rol que en la cola de turnos: que la pasada no vuelva a elegir la
  // fila que acaba de fallar si el backoff configurado fuera muy corto.
  const pospuestos: string[] = [];

  for (let i = 0; i < limite; i++) {
    if (opciones.debeSeguir && !opciones.debeSeguir()) {
      break;
    }

    let reclamo: QrFollowUpReclamado | null;
    try {
      reclamo = await claimNextQrFollowUp(leaseMs, {
        organizationId: opciones.organizationId,
        excluir: pospuestos,
      });
    } catch (err) {
      logger.error({ err }, "No se pudo reclamar un seguimiento con QR de la cola");
      break;
    }
    if (!reclamo) {
      break;
    }

    // Una fila que volvió por lease vencido una y otra vez: el proceso muere
    // cada vez que la toma. attempts subió en cada reclamo, así que esto corta
    // el ciclo sin haber pasado por ningún catch.
    if (reclamo.attempts > env.QR_FOLLOWUP_MAX_ATTEMPTS) {
      const agotado = reclamo;
      await markQrFollowUpFailed(
        agotado,
        `Agotó sus ${String(env.QR_FOLLOWUP_MAX_ATTEMPTS)} intentos sin terminar (el proceso que lo tomaba no llegó a cerrarlo)`,
      ).catch((err: unknown) => {
        logger.error(
          { err, qrFollowUpId: agotado.id },
          "No se pudo marcar FAILED un seguimiento con QR",
        );
      });
      resumen.fallidos++;
      continue;
    }

    let resultado: ResultadoDelEnvio;
    try {
      resultado = await procesarSeguimiento(reclamo, configuracion.config, deps);
    } catch (err) {
      await registrarFallo(reclamo, err, resumen);
      pospuestos.push(reclamo.id);
      continue;
    }
    await registrarResultado(reclamo, resultado, resumen);
  }

  return resumen;
}

// SOLO PARA TESTS, mismo contrato que los otros workers (detenerWorker.test.ts).
export interface OpcionesDelWorker {
  pollMs?: number;
  drenar?: (debeSeguir: () => boolean) => Promise<ResumenDrenado>;
}

export function iniciarWorkerDeSeguimientosQr(
  opciones: OpcionesDelWorker = {},
): () => Promise<void> {
  if (!env.QR_FOLLOWUP_WORKER_ENABLED) {
    logger.info(
      "Worker de seguimientos con QR deshabilitado por QR_FOLLOWUP_WORKER_ENABLED: los envíos agendados quedan en la cola",
    );
    return () => Promise.resolve();
  }

  const pollMs = opciones.pollMs ?? env.QR_FOLLOWUP_WORKER_POLL_MS;
  const drenar =
    opciones.drenar ?? ((debeSeguir: () => boolean) => drenarSeguimientosQr({ debeSeguir }));

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
          logger.info(resumen, "Drenado de seguimientos con QR");
        }
      } catch (err) {
        // Red de seguridad del bucle: si muere, los seguimientos dejan de
        // salir en silencio.
        logger.error({ err }, "Fallo inesperado en el drenado de seguimientos con QR");
      }
    })();

    await tickEnCurso;

    if (!detenido) {
      timer = setTimeout(() => void tick(), pollMs);
    }
  };

  logger.info(
    { pollMs, batchSize: env.QR_FOLLOWUP_WORKER_BATCH_SIZE },
    "Worker de seguimientos con QR iniciado",
  );

  // Primera pasada inmediata, mismo criterio que el worker de oportunidades
  // estancadas: un deploy no tiene por qué correr cinco minutos los envíos que
  // ya vencieron. Una pasada de más no duplica nada: el reclamo es exclusivo.
  timer = setTimeout(() => void tick(), 0);

  return async () => {
    detenido = true;
    if (timer) {
      clearTimeout(timer);
    }
    await tickEnCurso;
  };
}
