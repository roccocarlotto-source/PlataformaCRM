import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { createActivity as createActivityRepo } from "../../repositories/activity.repository";
import { findResourceById } from "../../repositories/resource.repository";
import { findOldestActiveAdmin } from "../../repositories/user.repository";
import { getBranchById } from "../../services/branch.service";
import {
  getClienteGoogleCalendar,
  GoogleAuthError,
  GoogleScopeInsuficienteError,
  type CalendarioDeLaCuenta,
  type ClienteGoogleCalendar,
} from "../../services/googleCalendar.service";
import {
  detenerCanalDeConexion,
  obtenerAccessToken,
} from "../../services/googleCalendarConnection.service";
import { AppError } from "../../utils/AppError";
import { firmarWebhookToken } from "../../utils/webhookToken";
import {
  asegurarFilasDeProfesionales,
  desvincularEventoDeGoogle,
  findOtroProfesionalConElCalendario,
  guardarCalendarioDelProfesional,
  guardarCanalDeProfesional,
  quitarFilaDelProfesional,
  registrarErrorDelCanal,
} from "../repositories/googlePorProfesional.repository";
import { recepcionistaParaElAviso } from "./sedesDeUsuarios.service";

// ---------------------------------------------------------------------------
// Un calendario de Google por profesional de clínica (docs/rubros.md §4.6, D4,
// D16, R8).
//
// LA AGENDA DE LA PLATAFORMA ES LA FUENTE DE VERDAD; Google es el espejo y el
// bloqueo externo. Un profesional sin calendario propio sigue funcionando solo
// con la plataforma. Todo lo de acá corre solo para clínicas: las rutas son del
// módulo agenda_clinica, y el worker y el sync solo miran filas de canal con
// resource_id (que solo una clínica escribe).
// ---------------------------------------------------------------------------

type ClienteInyectado = ClienteGoogleCalendar | undefined;

function resolverCliente(cliente: ClienteInyectado): ClienteGoogleCalendar {
  return cliente ?? getClienteGoogleCalendar();
}

/** Los calendarios de la cuenta conectada a la sede donde se pueden crear
 *  eventos (calendarList.list, minAccessRole=writer). Sin el scope de la lista
 *  (una conexión anterior a R8): 409, y la pantalla ofrece pegar el ID. */
export async function listarCalendariosDeLaSede(
  organizationId: string,
  branchId: string,
  cliente?: ClienteInyectado,
): Promise<CalendarioDeLaCuenta[]> {
  await getBranchById(organizationId, branchId);
  const { accessToken } = await obtenerAccessToken(organizationId, branchId, cliente);
  const google = resolverCliente(cliente);
  if (!google.listarCalendarios) throw new GoogleScopeInsuficienteError();
  return google.listarCalendarios(accessToken);
}

/** Asigna (o quita, con null) el calendario de Google de un profesional. Lo
 *  valida con un freebusy sobre ese calendario: si Google no lo puede leer con
 *  la cuenta conectada, 400. Cambiarlo detiene el canal del calendario viejo;
 *  el del nuevo lo abre el worker de renovación en su próxima pasada. Los
 *  turnos ya creados conservan su Booking.googleCalendarId. */
export async function asignarCalendarioAlProfesional(
  organizationId: string,
  resourceId: string,
  calendarIdPedido: string | null,
  cliente?: ClienteInyectado,
) {
  const recurso = await findResourceById(resourceId, organizationId);
  if (!recurso) throw new AppError("Profesional no encontrado", 404);
  if (recurso.type !== "PERSON") {
    throw new AppError("Solo un profesional (una persona) puede tener calendario propio", 400);
  }
  const calendarId = calendarIdPedido?.trim() ? calendarIdPedido.trim() : null;
  if (calendarId === recurso.googleCalendarId) {
    return { id: recurso.id, googleCalendarId: recurso.googleCalendarId };
  }

  if (calendarId !== null) {
    const { accessToken, calendarId: delaSede } = await obtenerAccessToken(
      organizationId,
      recurso.branchId,
      cliente,
    );
    if (calendarId === delaSede || calendarId === "primary") {
      throw new AppError(
        "Ese es el calendario de la sede: elegí un calendario propio del profesional",
        400,
      );
    }
    const otro = await findOtroProfesionalConElCalendario(
      organizationId,
      recurso.branchId,
      calendarId,
      resourceId,
    );
    if (otro) {
      throw new AppError(`Ese calendario ya es de ${otro.name}`, 400);
    }
    const sede = await getBranchById(organizationId, recurso.branchId);
    const ahora = new Date();
    try {
      await resolverCliente(cliente).consultarFreeBusy({
        accessToken,
        calendarIds: [calendarId],
        timeMin: ahora.toISOString(),
        timeMax: new Date(ahora.getTime() + 60 * 60 * 1000).toISOString(),
        timeZone: sede.timezone,
      });
    } catch (err) {
      if (err instanceof GoogleAuthError) {
        throw new AppError(
          "La cuenta de Google conectada no puede usar ese calendario. Tiene que ser suyo o estar compartido con ella con permiso de edición.",
          400,
        );
      }
      throw err;
    }
  }

  const viejos = await prisma.$transaction(async (tx) => {
    const quitadas = await quitarFilaDelProfesional(organizationId, resourceId, tx);
    await guardarCalendarioDelProfesional(organizationId, resourceId, calendarId, tx);
    return quitadas;
  });
  for (const viejo of viejos) {
    if (viejo.channelId && viejo.channelResourceId) {
      await detenerCanalDeConexion(
        organizationId,
        viejo.branchId,
        { channelId: viejo.channelId, resourceId: viejo.channelResourceId },
        cliente,
      );
    }
  }
  return { id: recurso.id, googleCalendarId: calendarId };
}

// ---------------------------------------------------------------------------
// Canales de los calendarios de profesionales (el worker de renovación).
// ---------------------------------------------------------------------------

type FilaDeCanal = Awaited<ReturnType<typeof asegurarFilasDeProfesionales>>[number];

async function renovarCanalDeProfesional(fila: FilaDeCanal, cliente?: ClienteInyectado) {
  if (!env.GOOGLE_WEBHOOK_URL) {
    throw new AppError(
      "GOOGLE_WEBHOOK_URL no está configurada en el servidor: sin ella no se pueden abrir canales de notificaciones",
      500,
      false,
    );
  }
  const { organizationId, branchId } = fila;
  const { accessToken } = await obtenerAccessToken(organizationId, branchId, cliente);
  const channelId = randomUUID();
  const token = await firmarWebhookToken({ organizationId, branchId, channelId });
  const google = resolverCliente(cliente);
  const creado = await google.crearCanalDeNotificaciones({
    accessToken,
    calendarId: fila.calendarId,
    channelId,
    address: env.GOOGLE_WEBHOOK_URL,
    token,
    ttlSegundos: env.GOOGLE_CHANNEL_TTL_SECONDS,
  });
  const guardado = await guardarCanalDeProfesional(fila.id, fila.resourceId!, {
    channelId: creado.channelId,
    channelResourceId: creado.resourceId,
    channelExpiration: creado.expiration,
  });
  if (guardado.count !== 1) {
    // El profesional cambió de calendario mientras se abría el canal: el canal
    // nuevo quedó huérfano y se cierra (mismo criterio que B-7 en renovarCanal).
    try {
      await google.detenerCanal({
        accessToken,
        channelId: creado.channelId,
        resourceId: creado.resourceId,
      });
    } catch (err) {
      logger.warn({ err, organizationId, branchId }, "No se pudo cerrar un canal huérfano");
    }
    throw new AppError("El calendario del profesional cambió mientras se abría el canal", 409);
  }
  if (fila.channelId && fila.channelResourceId) {
    await detenerCanalDeConexion(
      organizationId,
      branchId,
      { channelId: fila.channelId, resourceId: fila.channelResourceId },
      cliente,
    );
  }
  return creado;
}

/** Abre o renueva los canales de los calendarios de profesionales. Un
 *  calendario que falla (se borró, le sacaron el permiso) guarda el error en su
 *  fila y no frena a los demás. Un access token por conexión: lo cachea
 *  obtenerAccessToken. */
export async function renovarCanalesDeProfesionales(
  limiteDeVencimiento: Date,
  opciones: { cliente?: ClienteInyectado; organizationId?: string } = {},
): Promise<{ renovados: number; fallidos: number }> {
  const resumen = { renovados: 0, fallidos: 0 };
  const filas = await asegurarFilasDeProfesionales(limiteDeVencimiento, {
    organizationId: opciones.organizationId,
  });
  for (const fila of filas) {
    try {
      await renovarCanalDeProfesional(fila, opciones.cliente);
      resumen.renovados++;
    } catch (err) {
      resumen.fallidos++;
      const mensaje = err instanceof Error ? err.message : String(err);
      await registrarErrorDelCanal(fila.id, mensaje).catch(() => undefined);
      logger.error(
        { err, organizationId: fila.organizationId, branchId: fila.branchId, canal: fila.id },
        "No se pudo abrir o renovar el canal del calendario de un profesional; se sigue con los demás",
      );
    }
  }
  return resumen;
}

// ---------------------------------------------------------------------------
// D16 (decisión de Rocco del 2026-10-10): en una clínica, un turno BORRADO o
// MOVIDO directamente en Google no se cancela ni se mueve solo. Se registra y
// se crea una tarea para la Recepción de la sede del turno (§11.4), con el
// paciente, el profesional, la fecha y qué pasó en Google. La plataforma sigue
// siendo la fuente de verdad. (En una automotora, la cancelación inversa
// automática sigue como siempre: googleCalendarSync.service.ts.)
// ---------------------------------------------------------------------------

export const PREFIJO_TAREA_BORRADO_EN_GOOGLE = "Turno borrado en Google: ";
export const PREFIJO_TAREA_MOVIDO_EN_GOOGLE = "Turno movido en Google: ";

export async function avisarCambioEnGoogle(
  organizationId: string,
  booking: {
    id: string;
    branchId: string;
    contactId: string;
    resourceId: string;
    startsAt: Date;
  },
  cambio: { tipo: "borrado" } | { tipo: "movido"; inicioEnGoogle?: Date },
): Promise<void> {
  const [sede, contacto, profesional] = await Promise.all([
    getBranchById(organizationId, booking.branchId),
    prisma.contact.findFirst({
      where: { id: booking.contactId, organizationId },
      select: { firstName: true, lastName: true },
    }),
    prisma.resource.findFirst({
      where: { id: booking.resourceId, organizationId },
      select: { name: true },
    }),
  ]);
  const paciente = contacto ? `${contacto.firstName} ${contacto.lastName}`.trim() : "el paciente";
  const quien = profesional?.name ?? "el profesional";
  const formato = (fecha: Date) =>
    DateTime.fromJSDate(fecha, { zone: sede.timezone })
      .setLocale("es")
      .toFormat("cccc d 'de' LLLL 'a las' HH:mm");
  const enLaPlataforma = formato(booking.startsAt);

  const subject = (
    cambio.tipo === "borrado"
      ? `${PREFIJO_TAREA_BORRADO_EN_GOOGLE}${paciente} (${enLaPlataforma})`
      : `${PREFIJO_TAREA_MOVIDO_EN_GOOGLE}${paciente} (${enLaPlataforma})`
  ).slice(0, 255);
  const body =
    cambio.tipo === "borrado"
      ? `El turno de ${paciente} con ${quien} del ${enLaPlataforma} se borró en Google Calendar. ` +
        "En la plataforma sigue en pie: confirmá con el paciente y cancelalo acá si corresponde."
      : `El turno de ${paciente} con ${quien} se movió en Google Calendar` +
        (cambio.inicioEnGoogle ? ` al ${formato(cambio.inicioEnGoogle)}` : "") +
        `. En la plataforma sigue el ${enLaPlataforma}: reprogramalo o avisale al paciente.`;

  // Una notificación se puede reprocesar: no se repite la tarea si ya hay una
  // abierta igual para ese paciente.
  const yaAvisado = await prisma.activity.findFirst({
    where: {
      organizationId,
      contactId: booking.contactId,
      subject,
      completedAt: null,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!yaAvisado) {
    const asignadoId =
      (await recepcionistaParaElAviso(organizationId, booking.branchId)) ??
      sede.defaultOwnerId ??
      (await findOldestActiveAdmin(organizationId))?.id ??
      null;
    if (!asignadoId) {
      logger.warn(
        { organizationId, bookingId: booking.id },
        "Turno cambiado en Google sin nadie a quien avisar: no se crea la tarea",
      );
    } else {
      await createActivityRepo({
        organizationId,
        authorId: asignadoId,
        type: "TASK",
        assigneeId: asignadoId,
        companyId: null,
        contactId: booking.contactId,
        opportunityId: null,
        branchId: booking.branchId,
        subject,
        body,
      });
    }
  }

  // Un evento borrado ya no es espejo de nada: la reserva queda sin evento (y
  // una próxima notificación de ese evento no la encuentra).
  if (cambio.tipo === "borrado") {
    await desvincularEventoDeGoogle(booking.id, organizationId);
  }
}
