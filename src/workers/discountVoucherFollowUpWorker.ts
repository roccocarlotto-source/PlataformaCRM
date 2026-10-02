import { OpportunityStatus } from "@prisma/client";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import {
  claimNextDiscountVoucherFollowUp,
  findDiscountVoucherFollowUpParaEnviar,
  marcarCuponEmitido,
  markDiscountVoucherFollowUpCancelled,
  markDiscountVoucherFollowUpFailed,
  markDiscountVoucherFollowUpSent,
  posponerDiscountVoucherFollowUpHasta,
  rescheduleDiscountVoucherFollowUp,
  type DiscountVoucherFollowUpParaEnviar,
  type DiscountVoucherFollowUpReclamado,
} from "../repositories/discountVoucherFollowUp.repository";
import { anotarEnvioEnConversacion } from "../services/automationWhatsappConversation.service";
import { crearDiscountVoucher, dependenciasDeCuponesEn } from "../services/discountVoucher.service";
import { soloDigitos } from "../lib/telefono";
import { AppError } from "../utils/AppError";
import { describirError, resolverFalloDelJob, type ClaseDeFallo } from "../utils/backoff";
import { baseDeLaApiPublica } from "../utils/qrImage";
import { buildVoucherPublicUrl } from "../utils/voucherPublicUrl";
import {
  ErrorPermanenteDelSeguimiento,
  clasificarFallo as clasificarFalloDelSeguimientoQr,
  armarEnvioDeLaPlantilla,
  depsDelSeguimientoReales,
  nombreParaElSaludo,
  type DepsDelSeguimiento,
  type ResultadoDelEnvio as ResultadoDelEnvioDelSeguimiento,
} from "./qrFollowUpWorker";

// ---------------------------------------------------------------------------
// El worker de cupones de descuento por WhatsApp (ítem 177 de
// docs/frontend-cambios-pendientes.md). La acción
// opportunity.send_discount_voucher agenda una fila en
// discount_voucher_follow_ups cuando una oportunidad pasa a ganada; esto
// EMITE el cupón (ítem 176) y lo manda cuando vence.
//
// EL MISMO ESQUELETO QUE qrFollowUpWorker.ts —polling in-process, reclamo con
// lease, backoff, tope de intentos, arranque en server.ts detrás de
// workersHabilitados()— y los mismos criterios: se relee todo antes de mandar,
// lo que ya no corresponde se CANCELA sin error, un 429/5xx de Meta o la red se
// reintentan y un 4xx o un dato que falta es FAILED al primer intento. De ahí
// se reusan nombreParaElSaludo, el error permanente y la clasificación.
//
// LO NUEVO: EL CUPÓN NACE ACÁ, y a lo sumo UNO por fila. Se emite recién
// cuando todo lo demás está en regla (contacto con teléfono, sucursal con
// número, plantilla aprobada), para no dejar cupones que nunca van a salir, y
// en la MISMA transacción en que se anota en la fila (emitirCuponReal). Si el
// envío después falla y se reintenta, la fila ya tiene su discountVoucherId y
// se manda ESE cupón: no se emite otro. expiresAt se calcula en ese momento,
// no al agendar.
//
// CUPÓN EMITIDO Y NO MANDADO: si un intento emite el cupón, el envío falla, y
// antes del reintento la fila se cancela (la oportunidad dejó de estar ganada)
// o agota sus intentos, el cupón queda ACTIVE sin que el cliente tenga el
// link, y vence solo. Es aceptado: nadie lo puede canjear sin el link, y la
// fila guarda cuál fue.
//
// VENTANA ACEPTADA, la misma que el del QR: si el proceso muere después de que
// Meta aceptó el envío y antes de marcar SENT, el lease vence y el mensaje sale
// dos veces — pero con el MISMO cupón, que es de un solo uso.
// ---------------------------------------------------------------------------

const MS_POR_DIA = 24 * 60 * 60 * 1000;

export interface DepsDelCupon extends DepsDelSeguimiento {
  // Emite el cupón y lo anota en la fila, atómico. Devuelve su id. Lanza si la
  // fila ya no es de este reclamo (y entonces no queda ningún cupón).
  emitirCupon: (
    reclamo: DiscountVoucherFollowUpReclamado,
    fila: DiscountVoucherFollowUpParaEnviar,
    expiresAt: Date,
  ) => Promise<string>;
  ahora: () => Date;
}

// Emisión y anotación en una transacción: si marcarCuponEmitido no afecta la
// fila (otro worker la retomó con el lease vencido, o ya tenía un cupón), el
// throw deshace el INSERT del cupón.
export async function emitirCuponReal(
  reclamo: DiscountVoucherFollowUpReclamado,
  fila: DiscountVoucherFollowUpParaEnviar,
  expiresAt: Date,
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const cupon = await crearDiscountVoucher(
      fila.organizationId,
      {
        automationId: fila.automationId,
        opportunityId: fila.opportunityId,
        contactId: fila.contactId,
        label: fila.label,
        expiresAt,
      },
      dependenciasDeCuponesEn(tx),
    );
    const anotado = await marcarCuponEmitido(reclamo, cupon.id, tx);
    if (!anotado) {
      throw new Error(
        "La fila cambió de dueño antes de anotar el cupón (otro worker la retomó): no se emite",
      );
    }
    return cupon.id;
  });
}

export const depsDelCuponReales: DepsDelCupon = {
  ...depsDelSeguimientoReales,
  emitirCupon: emitirCuponReal,
  ahora: () => new Date(),
};

export interface ConfiguracionDelCupon {
  accessToken: string;
}

// Pura: la configuración completa, o los nombres de las variables que faltan.
// El string vacío cuenta como ausente, igual que en el worker del QR.
//
// La base del link NO es configuración de este worker: el link lo arma
// buildVoucherPublicUrl (ítem 178) con QR_PUBLIC_BASE_URL, el mismo que
// codifica el QR de la página del cupón, así los dos no pueden divergir. Sin
// esa variable devuelve el id pelado, igual que en la página.
export function leerConfiguracion(
  deps: Pick<DepsDelCupon, "accessToken">,
): { ok: true; config: ConfiguracionDelCupon } | { ok: false; faltan: string[] } {
  const accessToken = deps.accessToken()?.trim();
  if (!accessToken) {
    return { ok: false, faltan: ["WHATSAPP_ACCESS_TOKEN"] };
  }
  return { ok: true, config: { accessToken } };
}

// Pura: cuándo vence un cupón emitido AHORA.
export function vencimientoDelCupon(ahora: Date, expiresInDays: number): Date {
  return new Date(ahora.getTime() + expiresInDays * MS_POR_DIA);
}

// La del QR, más un caso: un 4xx de crearDiscountVoucher (label inválido, la
// oportunidad o el contacto que ya no están) no se arregla reintentando.
export function clasificarFallo(err: unknown): ClaseDeFallo {
  if (err instanceof AppError && err.statusCode < 500) {
    return "PERMANENTE";
  }
  return clasificarFalloDelSeguimientoQr(err);
}

// Pura: por qué el envío ya no corresponde, o null. Las mismas razones que
// motivoDeCancelacion del QR, con la sucursal en lugar del QR.
export function motivoDeCancelacion(
  fila: Pick<
    DiscountVoucherFollowUpParaEnviar,
    "automation" | "opportunity" | "contact" | "branch"
  >,
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
  if (fila.branch.deletedAt !== null) {
    return "Se borró la sucursal desde la que salía el WhatsApp";
  }
  return null;
}

// El mismo que el del QR: ENVIADO lleva lo que salió para anotarlo en la
// conversación (F1).
export type ResultadoDelEnvio = ResultadoDelEnvioDelSeguimiento;

// Un envío reclamado: relee, decide, emite el cupón si hace falta y manda.
// Lanza ante cualquier fallo; el que llama lo clasifica.
export async function procesarCupon(
  reclamo: DiscountVoucherFollowUpReclamado,
  config: ConfiguracionDelCupon,
  deps: Pick<
    DepsDelCupon,
    | "plantillaDeLaRegla"
    | "numeroDeLaSucursal"
    | "proximaApertura"
    | "sendTemplate"
    | "emitirCupon"
    | "ahora"
    | "baseDeLaApi"
  >,
  leer: (
    id: string,
    organizationId: string,
  ) => Promise<DiscountVoucherFollowUpParaEnviar | null> = (id, organizationId) =>
    findDiscountVoucherFollowUpParaEnviar(id, organizationId),
): Promise<ResultadoDelEnvio> {
  const fila = await leer(reclamo.id, reclamo.organizationId);
  if (!fila) {
    throw new ErrorPermanenteDelSeguimiento("La fila del cupón agendado ya no existe");
  }

  const motivo = motivoDeCancelacion(fila);
  if (motivo !== null) {
    return { resultado: "CANCELADO", motivo };
  }

  // G-07 (docs-privados/auditoria-2026-09-30-corta.md, local): dentro del
  // horario de atención de la sucursal, igual que el del QR. ANTES de emitir el
  // cupón: su vigencia se cuenta desde que sale, no desde la madrugada en que
  // estaba agendado.
  const ahora = deps.ahora();
  const apertura = await deps.proximaApertura(fila.organizationId, fila.branchId, ahora);
  if (apertura.getTime() > ahora.getTime()) {
    return { resultado: "FUERA_DE_HORARIO", hasta: apertura };
  }

  // Todo lo que puede impedir el envío se chequea ANTES de emitir el cupón.
  const destino = soloDigitos(fila.contact.phone ?? "");
  if (destino === "") {
    throw new ErrorPermanenteDelSeguimiento("El contacto no tiene un teléfono cargado");
  }

  const phoneNumberId = await deps.numeroDeLaSucursal(fila.organizationId, fila.branchId);
  if (!phoneNumberId) {
    throw new ErrorPermanenteDelSeguimiento(
      "La sucursal de la regla no tiene un número de WhatsApp conectado (ningún agente de la sucursal tiene número)",
    );
  }

  // La de ESTA regla (ítem 181): la del QR de la misma organización habla de
  // una reseña, no del cupón.
  const plantilla = await deps.plantillaDeLaRegla(fila.organizationId, fila.automationId);
  if (!plantilla) {
    throw new ErrorPermanenteDelSeguimiento(
      "La automatización ya no tiene una plantilla de WhatsApp aprobada (se borró o Meta dejó de aprobarla antes del envío)",
    );
  }

  // Un reintento después de un envío fallido: el cupón ya existe y se manda
  // ese. Si no, nace ahora, con su vigencia contada desde ahora.
  const discountVoucherId =
    fila.discountVoucherId ??
    (await deps.emitirCupon(reclamo, fila, vencimientoDelCupon(deps.ahora(), fila.expiresInDays)));

  // Posicionales, los mismos que el del QR: {{1}} el nombre, {{2}} el link
  // (si el texto lo lleva). La imagen, si la plantilla tiene encabezado, es
  // el QR de ESTE cupón: el que el empleado escanea en "Canjear cupón".
  const { bodyParameters: parametros, headerImageUrl } = armarEnvioDeLaPlantilla(
    plantilla,
    nombreParaElSaludo(fila.contact.firstName),
    buildVoucherPublicUrl(discountVoucherId),
    { tipo: "v", id: discountVoucherId },
    { baseDeLaApi: (deps.baseDeLaApi ?? baseDeLaApiPublica)() },
  );
  const { wamid } = await deps.sendTemplate({
    phoneNumberId,
    to: destino,
    templateName: plantilla.name,
    languageCode: plantilla.languageCode,
    bodyParameters: parametros,
    ...(headerImageUrl ? { headerImageUrl } : {}),
    accessToken: config.accessToken,
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

export interface ResumenDrenado {
  enviados: number;
  cancelados: number;
  pospuestos: number;
  fallidos: number;
  // G-07: la sucursal estaba cerrada; se corrieron a su próxima apertura
  // sin gastar el intento.
  fueraDeHorario: number;
  sinConfiguracion: boolean;
}

export interface OpcionesDrenado {
  limite?: number;
  organizationId?: string;
  deps?: DepsDelCupon;
  leaseMs?: number;
  debeSeguir?: () => boolean;
}

async function registrarFallo(
  reclamo: DiscountVoucherFollowUpReclamado,
  err: unknown,
  resumen: ResumenDrenado,
) {
  const lastError = describirError(err);
  const resolucion = resolverFalloDelJob(reclamo.attempts, clasificarFallo(err), new Date(), {
    maxIntentos: env.DISCOUNT_VOUCHER_FOLLOWUP_MAX_ATTEMPTS,
    backoff: {
      baseMs: env.DISCOUNT_VOUCHER_FOLLOWUP_BACKOFF_BASE_MS,
      topeMs: env.DISCOUNT_VOUCHER_FOLLOWUP_BACKOFF_MAX_MS,
    },
  });

  try {
    if (resolucion.estado === "FAILED") {
      await markDiscountVoucherFollowUpFailed(reclamo, lastError);
      resumen.fallidos++;
      logger.error(
        { err, discountVoucherFollowUpId: reclamo.id, attempts: reclamo.attempts },
        "Cupón de descuento en FAILED: el cliente no recibió el WhatsApp",
      );
      return;
    }
    await rescheduleDiscountVoucherFollowUp(reclamo, {
      nextAttemptAt: resolucion.nextAttemptAt,
      lastError,
    });
    resumen.pospuestos++;
    logger.warn(
      {
        err,
        discountVoucherFollowUpId: reclamo.id,
        attempts: reclamo.attempts,
        nextAttemptAt: resolucion.nextAttemptAt,
      },
      "Cupón de descuento fallido: queda en PENDING para reintentar con backoff",
    );
  } catch (errContable) {
    logger.error(
      { err: errContable, discountVoucherFollowUpId: reclamo.id },
      "No se pudo registrar el fallo del cupón de descuento; se retoma cuando venza el lease",
    );
  }
}

async function registrarResultado(
  reclamo: DiscountVoucherFollowUpReclamado,
  resultado: ResultadoDelEnvio,
  resumen: ResumenDrenado,
  deps: DepsDelCupon,
) {
  try {
    if (resultado.resultado === "ENVIADO") {
      await markDiscountVoucherFollowUpSent(reclamo, new Date());
      resumen.enviados++;
      // F1, igual que el del QR: recién con la fila marcada, y nunca lanza.
      await anotarEnvioEnConversacion(resultado.envio, deps.registrarEnConversacion);
      return;
    }
    if (resultado.resultado === "FUERA_DE_HORARIO") {
      await posponerDiscountVoucherFollowUpHasta(reclamo, resultado.hasta);
      resumen.fueraDeHorario++;
      logger.info(
        { discountVoucherFollowUpId: reclamo.id, hasta: resultado.hasta },
        "Cupón de descuento fuera del horario de la sucursal: se corre a su próxima apertura",
      );
      return;
    }
    await markDiscountVoucherFollowUpCancelled(reclamo, resultado.motivo);
    resumen.cancelados++;
    logger.info(
      { discountVoucherFollowUpId: reclamo.id, motivo: resultado.motivo },
      "Cupón de descuento cancelado: ya no correspondía mandarlo",
    );
  } catch (err) {
    // Misma ventana que en el worker del QR: no se registra como fallo.
    logger.error(
      { err, discountVoucherFollowUpId: reclamo.id, resultado: resultado.resultado },
      "No se pudo marcar el cupón de descuento; se vuelve a tomar cuando venza el lease",
    );
  }
}

export async function drenarCupones(opciones: OpcionesDrenado = {}): Promise<ResumenDrenado> {
  const limite = opciones.limite ?? env.DISCOUNT_VOUCHER_FOLLOWUP_WORKER_BATCH_SIZE;
  const deps = opciones.deps ?? depsDelCuponReales;
  const leaseMs = opciones.leaseMs ?? env.DISCOUNT_VOUCHER_FOLLOWUP_LEASE_MS;
  const resumen: ResumenDrenado = {
    enviados: 0,
    cancelados: 0,
    pospuestos: 0,
    fallidos: 0,
    fueraDeHorario: 0,
    sinConfiguracion: false,
  };

  // Sin token no se reclama nada, mismo criterio que el worker del QR: las
  // filas quedan en PENDING sin gastar intentos, y el error se loguea en CADA
  // pasada.
  const configuracion = leerConfiguracion(deps);
  if (!configuracion.ok) {
    logger.error(
      { faltan: configuracion.faltan },
      "Cupones de descuento: falta configuración, no se manda ninguno (quedan en PENDING)",
    );
    resumen.sinConfiguracion = true;
    return resumen;
  }

  const pospuestos: string[] = [];

  for (let i = 0; i < limite; i++) {
    if (opciones.debeSeguir && !opciones.debeSeguir()) {
      break;
    }

    let reclamo: DiscountVoucherFollowUpReclamado | null;
    try {
      reclamo = await claimNextDiscountVoucherFollowUp(leaseMs, {
        organizationId: opciones.organizationId,
        excluir: pospuestos,
      });
    } catch (err) {
      logger.error({ err }, "No se pudo reclamar un cupón de descuento de la cola");
      break;
    }
    if (!reclamo) {
      break;
    }

    if (reclamo.attempts > env.DISCOUNT_VOUCHER_FOLLOWUP_MAX_ATTEMPTS) {
      const agotado = reclamo;
      await markDiscountVoucherFollowUpFailed(
        agotado,
        `Agotó sus ${String(env.DISCOUNT_VOUCHER_FOLLOWUP_MAX_ATTEMPTS)} intentos sin terminar (el proceso que lo tomaba no llegó a cerrarlo)`,
      ).catch((err: unknown) => {
        logger.error(
          { err, discountVoucherFollowUpId: agotado.id },
          "No se pudo marcar FAILED un cupón de descuento",
        );
      });
      resumen.fallidos++;
      continue;
    }

    let resultado: ResultadoDelEnvio;
    try {
      resultado = await procesarCupon(reclamo, configuracion.config, deps);
    } catch (err) {
      await registrarFallo(reclamo, err, resumen);
      pospuestos.push(reclamo.id);
      continue;
    }
    await registrarResultado(reclamo, resultado, resumen, deps);
  }

  return resumen;
}

// SOLO PARA TESTS, mismo contrato que los otros workers (detenerWorker.test.ts).
export interface OpcionesDelWorker {
  pollMs?: number;
  drenar?: (debeSeguir: () => boolean) => Promise<ResumenDrenado>;
}

export function iniciarWorkerDeCupones(opciones: OpcionesDelWorker = {}): () => Promise<void> {
  if (!env.DISCOUNT_VOUCHER_FOLLOWUP_WORKER_ENABLED) {
    logger.info(
      "Worker de cupones de descuento deshabilitado por DISCOUNT_VOUCHER_FOLLOWUP_WORKER_ENABLED: los envíos agendados quedan en la cola",
    );
    return () => Promise.resolve();
  }

  const pollMs = opciones.pollMs ?? env.DISCOUNT_VOUCHER_FOLLOWUP_WORKER_POLL_MS;
  const drenar = opciones.drenar ?? ((debeSeguir: () => boolean) => drenarCupones({ debeSeguir }));

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
          logger.info(resumen, "Drenado de cupones de descuento");
        }
      } catch (err) {
        logger.error({ err }, "Fallo inesperado en el drenado de cupones de descuento");
      }
    })();

    await tickEnCurso;

    if (!detenido) {
      timer = setTimeout(() => void tick(), pollMs);
    }
  };

  logger.info(
    { pollMs, batchSize: env.DISCOUNT_VOUCHER_FOLLOWUP_WORKER_BATCH_SIZE },
    "Worker de cupones de descuento iniciado",
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
