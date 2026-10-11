import { DateTime } from "luxon";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { createActivity as createActivityRepo } from "../repositories/activity.repository";
import { findOldestActiveAdmin } from "../repositories/user.repository";
import {
  bloqueoPorIdentidad,
  conErroresDeNegocio,
  exito,
  exitoVacio,
  fallo,
  instanteIso,
  sinParametros,
  validarArgs,
  zonaDeLaSucursal,
  type ContextoDeEjecucionDeTool,
  type ResultadoDeTool,
  type ToolDelAgente,
} from "../services/agentTools.service";
import { cancelBooking, relojDeReservas } from "../services/booking.service";
import { isoEnZona } from "../utils/timezone";
import {
  SUFIJO_ERROR_DE_ARGUMENTOS_DE_CLINICA,
  TERMINO_DE_LAS_TOOLS,
} from "./config/textosDelAgente";
import { leerConfiguracionDeSede } from "./repositories/clinicSettings.repository";
import { cuandoEnLaSede } from "./toolsDeAgenda";
import {
  MARCA_DEL_ASISTENTE,
  reprogramarTurno,
  type QuienReprograma,
} from "./services/reprogramar.service";
import { recepcionistaParaElAviso } from "./services/sedesDeUsuarios.service";

// ---------------------------------------------------------------------------
// Las tools de turnos del agente de una CLÍNICA (docs/rubros.md §5.1 y §4.7,
// R11): ver, reprogramar y cancelar los turnos del paciente de la conversación.
//
// Solo existen en una clínica: no están en CATALOGO_DE_TOOLS (el de una
// automotora no cambia), entran por ReglasDelRubro.toolsExclusivas, y
// toolDelRubro las saca de AUTOMOTORA. Por nivel, solo AUTONOMA (no están en
// TOOLS_DE_PRIMER_CONTACTO).
//
// REGLAS PROPIAS, antes del servicio (las mismas para reprogramar y cancelar):
//   1. el candado de identidad (bloqueoPorIdentidad), antes de mirar el turno;
//   2. el turno tiene que ser del contacto Y de la sede de la conversación: si
//      no, el MISMO error que uno inexistente (sin oráculo);
//   3. confirmado y futuro;
//   4. minHoursToChangeBooking de la sede, contra el horario ACTUAL del turno:
//      dentro del plazo, { ok: false } y el agente deriva.
// Todo lo demás (horario, grilla, bloqueos, capacidad, Google, el evento) lo
// hace el servicio único: reprogramarTurno (R9) o cancelBooking. Sin
// sobreturno ni `force`: el agente nunca los pide. Reprogramar no consume el
// tope de turnos futuros (MAX_RESERVAS_FUTURAS_POR_CONTACTO).
//
// DERIVA EL CÓDIGO, NO EL MODELO (hallazgo de la prueba de la Clínica Demo,
// 2026-10-11): el rechazo por plazo (4) y el de "nadie firma" llevan un
// `codigo` además del texto. Después de la ronda, la regla del rubro
// (reglasDeClinica.ts → desenlaceDeLasTools) lo lee y deriva: mensaje fijo,
// tarea para la Recepción de la sede y el agente callado, como una consulta
// clínica. Antes dependía de que el modelo derivara, y no lo hizo.
//
// CANCELAR VA EN DOS PASOS (mismo hallazgo: canceló en el acto). La primera
// llamada pasa las reglas 1 a 4 y devuelve un resumen, sin tocar nada. Con
// `confirmado: true` cancela solo si el ÚLTIMO mensaje del agente en esta
// conversación ya traía ese resumen para ese turno, y el contacto contestó
// después: o sea, en un turno anterior, nunca en el mismo. Sin migración: la
// marca es la propia llamada, guardada en Message.toolCalls. Si no, vuelve a
// dar el resumen.
//
// AUTOR: Activity.authorId no admite nulos, así que la nota la firma el
// responsable de la conversación, si no la Recepción de la sede, si no el ADMIN
// más antiguo. Pero el asunto lleva MARCA_DEL_ASISTENTE y la pantalla muestra
// "Asistente" como autor, nunca el nombre de esa persona.
// ---------------------------------------------------------------------------

export const MAX_TURNOS_DEL_CONTACTO = 10;

export const PREFIJO_NOTA_CANCELADO = "Turno cancelado: ";

export const MENSAJE_TURNO_NO_ENCONTRADO =
  "Ese turno no está entre los turnos de este paciente. Usá get_contact_bookings para ver sus turnos y usá el id tal cual figura ahí.";
export const MENSAJE_TURNO_NO_CONFIRMADO =
  "Ese turno ya no está confirmado (se canceló o ya se marcó): no se puede cambiar. Si el paciente necesita algo con ese turno, derivá a una persona del equipo.";
export const MENSAJE_TURNO_YA_EMPEZO =
  "Ese turno ya empezó o ya pasó: no se puede cambiar. Si el paciente necesita algo con ese turno, derivá a una persona del equipo.";
export const MENSAJE_SIN_AUTOR =
  "Por este medio no se puede cambiar el turno ahora. Derivá a una persona del equipo para que lo haga.";

/** Los `codigo` de los rechazos que derivan (ver arriba). */
export const CODIGO_FUERA_DE_PLAZO = "FUERA_DE_PLAZO";
export const CODIGO_SIN_AUTOR = "SIN_AUTOR";

export function mensajeFueraDePlazo(horas: number): string {
  return `Falta menos de ${horas} ${horas === 1 ? "hora" : "horas"} para ese turno: por este medio ya no se puede cambiar ni cancelar. Decíselo al paciente con claridad y derivá a una persona del equipo para que lo resuelva. No lo intentes de otra forma.`;
}

const id = (campo: string) => z.string().uuid(`${campo} debe ser un UUID`);
const vacioComoAusente = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" || v === null ? undefined : v), schema.optional());

export const rescheduleBookingArgs = z.object({
  bookingId: id("bookingId"),
  startsAt: instanteIso,
  resourceId: vacioComoAusente(id("resourceId")),
});

export const cancelBookingArgs = z.object({
  bookingId: id("bookingId"),
  // Un modelo chico manda "true" o null: lo que no es true, no confirma.
  confirmado: z.preprocess((v) => v === true || v === "true", z.boolean()).optional(),
});

/** Si un Message.toolCalls guardado tiene el resumen de cancelar ESE turno
 *  (la primera llamada de cancel_booking, ok y sin cancelar). Pura. */
export function mostroElResumenDeCancelar(toolCalls: unknown, bookingId: string): boolean {
  return (
    Array.isArray(toolCalls) &&
    toolCalls.some((entrada) => {
      if (typeof entrada !== "object" || entrada === null) return false;
      const { name, result } = entrada as { name?: unknown; result?: unknown };
      if (name !== "cancel_booking" || typeof result !== "object" || result === null) {
        return false;
      }
      const { ok, data } = result as { ok?: unknown; data?: unknown };
      if (ok !== true || typeof data !== "object" || data === null) return false;
      const d = data as { bookingId?: unknown; requiereConfirmacion?: unknown };
      return d.bookingId === bookingId && d.requiereConfirmacion === true;
    })
  );
}

/** El paso 2 vale si el último mensaje del agente traía el resumen de ese
 *  turno y el contacto escribió después (ver CANCELAR VA EN DOS PASOS). */
async function resumenYaMostrado(
  bookingId: string,
  contexto: ContextoDeEjecucionDeTool,
): Promise<boolean> {
  const where = {
    organizationId: contexto.organizationId,
    conversationId: contexto.conversation.id,
  };
  const ultimo = await prisma.message.findFirst({
    where: { ...where, direction: "OUTBOUND", senderType: "AGENT" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { createdAt: true, toolCalls: true },
  });
  if (!ultimo || !mostroElResumenDeCancelar(ultimo.toolCalls, bookingId)) return false;
  const respuestas = await prisma.message.count({
    where: { ...where, direction: "INBOUND", createdAt: { gt: ultimo.createdAt } },
  });
  return respuestas > 0;
}

function formato(fecha: Date, zona: string): string {
  return DateTime.fromJSDate(fecha, { zone: zona })
    .setLocale("es")
    .toFormat("cccc d 'de' LLLL 'a las' HH:mm");
}

type TurnoDelContacto = NonNullable<Awaited<ReturnType<typeof buscarTurnoDelContacto>>>;

function buscarTurnoDelContacto(bookingId: string, contexto: ContextoDeEjecucionDeTool) {
  return prisma.booking.findFirst({
    where: {
      id: bookingId,
      organizationId: contexto.organizationId,
      contactId: contexto.conversation.contactId,
      branchId: contexto.conversation.branchId,
    },
    include: {
      resource: { select: { name: true } },
      serviceType: { select: { name: true } },
      contact: { select: { firstName: true, lastName: true } },
    },
  });
}

/** Las reglas 1 a 4 de arriba. */
async function turnoQueSePuedeCambiar(
  bookingId: string,
  contexto: ContextoDeEjecucionDeTool,
): Promise<{ ok: true; turno: TurnoDelContacto } | { ok: false; resultado: ResultadoDeTool }> {
  const bloqueo = await bloqueoPorIdentidad(contexto, TERMINO_DE_LAS_TOOLS);
  if (bloqueo) return { ok: false, resultado: bloqueo };

  const turno = await buscarTurnoDelContacto(bookingId, contexto);
  if (!turno) return { ok: false, resultado: fallo(MENSAJE_TURNO_NO_ENCONTRADO) };
  if (turno.status !== "CONFIRMED") {
    return { ok: false, resultado: fallo(MENSAJE_TURNO_NO_CONFIRMADO) };
  }
  const ahora = relojDeReservas.ahora();
  if (turno.startsAt.getTime() <= ahora.getTime()) {
    return { ok: false, resultado: fallo(MENSAJE_TURNO_YA_EMPEZO) };
  }
  const { minHoursToChangeBooking: horas } = await leerConfiguracionDeSede(
    contexto.organizationId,
    turno.branchId,
  );
  if (horas !== null && turno.startsAt.getTime() - ahora.getTime() < horas * 60 * 60 * 1000) {
    return { ok: false, resultado: fallo(mensajeFueraDePlazo(horas), CODIGO_FUERA_DE_PLAZO) };
  }
  return { ok: true, turno };
}

/** Quién firma la nota (ver AUTOR arriba). null = la organización no tiene a
 *  nadie, y la tool deriva. */
export async function autorParaElAsistente(
  contexto: ContextoDeEjecucionDeTool,
): Promise<string | null> {
  const conversacion = await prisma.conversation.findFirst({
    where: { id: contexto.conversation.id, organizationId: contexto.organizationId },
    select: { assignedUserId: true },
  });
  return (
    conversacion?.assignedUserId ??
    (await recepcionistaParaElAviso(contexto.organizationId, contexto.conversation.branchId)) ??
    (await findOldestActiveAdmin(contexto.organizationId))?.id ??
    null
  );
}

function nombreDelPaciente(turno: TurnoDelContacto): string {
  return `${turno.contact.firstName} ${turno.contact.lastName ?? ""}`.trim() || "el paciente";
}

const getContactBookingsTool: ToolDelAgente = {
  definition: {
    name: "get_contact_bookings",
    description:
      "Lista los próximos turnos confirmados del paciente de esta conversación, en esta sede: id, día y hora, prestación y profesional. Usala siempre antes de reprogramar o cancelar, para saber de qué turno se trata: nunca supongas cuál es ni inventes un id.",
    parameters: sinParametros,
  },

  ejecutar(_args, contexto) {
    return conErroresDeNegocio(async () => {
      const bloqueo = await bloqueoPorIdentidad(contexto, TERMINO_DE_LAS_TOOLS);
      if (bloqueo) return bloqueo;
      const turnos = await prisma.booking.findMany({
        where: {
          organizationId: contexto.organizationId,
          contactId: contexto.conversation.contactId,
          branchId: contexto.conversation.branchId,
          status: "CONFIRMED",
          startsAt: { gt: relojDeReservas.ahora() },
        },
        orderBy: { startsAt: "asc" },
        take: MAX_TURNOS_DEL_CONTACTO,
        include: {
          resource: { select: { id: true, name: true } },
          serviceType: { select: { name: true } },
        },
      });
      if (turnos.length === 0) {
        return exitoVacio(
          { turnos: [] },
          "El paciente NO tiene turnos próximos en esta sede. No le digas que tiene uno: si quiere agendar, consultá la disponibilidad.",
        );
      }
      const zona = await zonaDeLaSucursal(contexto);
      return exito({
        zonaHoraria: zona,
        turnos: turnos.map((t) => ({
          bookingId: t.id,
          cuando: cuandoEnLaSede(t.startsAt, zona),
          inicio: isoEnZona(t.startsAt, zona),
          fin: isoEnZona(t.endsAt, zona),
          prestacion: t.serviceType.name,
          profesional: { id: t.resource.id, name: t.resource.name },
        })),
      });
    });
  },
};

const rescheduleBookingTool: ToolDelAgente = {
  definition: {
    name: "reschedule_booking",
    description:
      "Cambia de día, hora o profesional un turno del paciente de esta conversación (el mismo turno, no uno nuevo). Usala solo después de que el paciente confirmó qué turno mueve y a qué horario, y con un horario que devolvió get_availability para esa prestación. Si devuelve que no se puede, no insistas: decíselo al paciente y derivá a una persona del equipo.",
    parameters: {
      type: "object",
      properties: {
        bookingId: {
          type: "string",
          description: "Id del turno, tal cual lo devolvió get_contact_bookings.",
        },
        startsAt: {
          type: "string",
          description: "Inicio del horario nuevo, ISO 8601 con zona.",
        },
        resourceId: {
          type: "string",
          description:
            "Id del profesional nuevo, solo si el paciente pidió cambiar de profesional. Sin él, el mismo.",
        },
      },
      required: ["bookingId", "startsAt"],
      additionalProperties: false,
    },
  },

  ejecutar(args, contexto) {
    const validacion = validarArgs(
      rescheduleBookingArgs,
      args,
      SUFIJO_ERROR_DE_ARGUMENTOS_DE_CLINICA,
    );
    if (!validacion.ok) return Promise.resolve(validacion.resultado);
    const input = validacion.value;

    return conErroresDeNegocio(async () => {
      const cambiable = await turnoQueSePuedeCambiar(input.bookingId, contexto);
      if (!cambiable.ok) return cambiable.resultado;
      const autor = await autorParaElAsistente(contexto);
      if (!autor) return fallo(MENSAJE_SIN_AUTOR, CODIGO_SIN_AUTOR);

      // Como una Recepción de la sede de la conversación: sin `force` ni
      // sobreturno (no se mandan), y acotado a esa sede.
      const quien: QuienReprograma = {
        userId: autor,
        role: "RECEPCION",
        industry: "CLINICA",
        sedes: [contexto.conversation.branchId],
        descripcion: "el asistente",
        esAsistente: true,
      };
      const turno = await reprogramarTurno(
        contexto.organizationId,
        input.bookingId,
        {
          startsAt: input.startsAt,
          ...(input.resourceId !== undefined ? { resourceId: input.resourceId } : {}),
        },
        quien,
      );
      const zona = await zonaDeLaSucursal(contexto);
      return exito({
        bookingId: turno.id,
        zonaHoraria: zona,
        cuando: cuandoEnLaSede(turno.startsAt, zona),
        startsAt: isoEnZona(turno.startsAt, zona),
        endsAt: isoEnZona(turno.endsAt, zona),
        profesionalId: turno.resourceId,
      });
    });
  },
};

const cancelBookingTool: ToolDelAgente = {
  definition: {
    name: "cancel_booking",
    description:
      "Cancela un turno del paciente de esta conversación, en dos pasos. Primero llamala sin confirmado: NO cancela nada, te devuelve un resumen del turno. Mostráselo al paciente y preguntale si confirma que lo quiere cancelar. Recién cuando conteste que sí, en su mensaje siguiente, llamala de nuevo con confirmado: true. Si devuelve que no se puede, no insistas: decíselo al paciente.",
    parameters: {
      type: "object",
      properties: {
        bookingId: {
          type: "string",
          description: "Id del turno, tal cual lo devolvió get_contact_bookings.",
        },
        confirmado: {
          type: "boolean",
          description:
            "true solo si ya le mostraste el resumen de ESTE turno en tu mensaje anterior y el paciente te contestó que sí lo cancela. Sin eso, no lo mandes.",
        },
      },
      required: ["bookingId"],
      additionalProperties: false,
    },
  },

  ejecutar(args, contexto) {
    const validacion = validarArgs(cancelBookingArgs, args, SUFIJO_ERROR_DE_ARGUMENTOS_DE_CLINICA);
    if (!validacion.ok) return Promise.resolve(validacion.resultado);
    const { bookingId, confirmado } = validacion.value;

    return conErroresDeNegocio(async () => {
      const cambiable = await turnoQueSePuedeCambiar(bookingId, contexto);
      if (!cambiable.ok) return cambiable.resultado;
      const { turno } = cambiable;
      const zona = await zonaDeLaSucursal(contexto);

      // Paso 1 (o un confirmado que no vale todavía): el resumen, sin tocar
      // nada. Ver CANCELAR VA EN DOS PASOS arriba.
      if (confirmado !== true || !(await resumenYaMostrado(bookingId, contexto))) {
        return exito({
          bookingId,
          requiereConfirmacion: true,
          cancelado: false,
          turno: {
            cuando: cuandoEnLaSede(turno.startsAt, zona),
            prestacion: turno.serviceType.name,
            profesional: turno.resource.name,
          },
          queHacer:
            "El turno NO está cancelado. Mostrale al paciente este resumen (el día tal cual figura en cuando, la prestación y el profesional) y preguntale si confirma que lo quiere cancelar. Recién cuando te conteste que sí, en su mensaje siguiente, volvé a llamar a esta herramienta con confirmado: true.",
        });
      }

      const autor = await autorParaElAsistente(contexto);
      if (!autor) return fallo(MENSAJE_SIN_AUTOR, CODIGO_SIN_AUTOR);

      // El servicio de siempre (booking.cancelled, Google), con la nota del
      // historial en la misma transacción.
      await cancelBooking(contexto.organizationId, bookingId, undefined, undefined, (tx) =>
        createActivityRepo(
          {
            organizationId: contexto.organizationId,
            authorId: autor,
            type: "NOTE",
            assigneeId: null,
            companyId: null,
            contactId: turno.contactId,
            opportunityId: null,
            branchId: turno.branchId,
            subject:
              `${MARCA_DEL_ASISTENTE}${PREFIJO_NOTA_CANCELADO}${nombreDelPaciente(turno)}`.slice(
                0,
                255,
              ),
            body:
              `Era: ${formato(turno.startsAt, zona)} con ${turno.resource.name} (${turno.serviceType.name}). ` +
              "Canceló: el asistente, a pedido del paciente.",
          },
          tx,
        ).then(() => undefined),
      );
      return exito({ bookingId, cancelado: true, cuando: cuandoEnLaSede(turno.startsAt, zona) });
    });
  },
};

/** Las tools que solo tiene una clínica, por nombre. */
export const TOOLS_DE_TURNOS_DE_CLINICA: Readonly<Record<string, ToolDelAgente>> = {
  get_contact_bookings: getContactBookingsTool,
  reschedule_booking: rescheduleBookingTool,
  cancel_booking: cancelBookingTool,
};
