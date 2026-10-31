import type { OrganizationIndustry, Prisma } from "@prisma/client";
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
// Las tools de turnos del agente (docs/rubros.md §5.1 y §4.7, R11): ver,
// reprogramar y cancelar los turnos del contacto de la conversación.
//
// Nacieron para la CLÍNICA. Desde el PR de reprogramar en automotoras
// (2026-10-31, decisión de Rocco) una automotora tiene las MISMAS tres, con
// sus textos (src/automotora/toolsDeTurnos.ts): esta es la única
// implementación, armada con crearToolsDeTurnos(textos, opciones). Ninguna
// está en CATALOGO_DE_TOOLS: entran por ReglasDelRubro.toolsExclusivas de cada
// rubro. Por nivel, solo AUTONOMA (no están en TOOLS_DE_PRIMER_CONTACTO).
//
// REGLAS PROPIAS, antes del servicio (las mismas para reprogramar y cancelar):
//   1. el candado de identidad (bloqueoPorIdentidad), antes de mirar el turno;
//   2. el turno tiene que ser del contacto Y de la sede de la conversación: si
//      no, el MISMO error que uno inexistente (sin oráculo);
//   3. confirmado y futuro;
//   4. minHoursToChangeBooking de la sede, contra el horario ACTUAL del turno:
//      dentro del plazo, { ok: false } y el agente deriva. Sin fila de
//      configuración (una automotora no la tiene), sin plazo.
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
// clínica. Antes dependía de que el modelo derivara, y no lo hizo. Una
// automotora no tiene esa regla: el texto del rechazo le pide al modelo que
// derive.
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
//
// AVISO (opciones.alCambiar): lo que el rubro suma, en la MISMA transacción
// que el cambio. En una automotora, una tarea para el vendedor (decisión de
// Rocco, 2026-10-31); en una clínica, nada (la nota alcanza).
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

const id = (campo: string) => z.string().guid(`${campo} debe ser un UUID`);
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

export function formatoDelTurno(fecha: Date, zona: string): string {
  return DateTime.fromJSDate(fecha, { zone: zona })
    .setLocale("es")
    .toFormat("cccc d 'de' LLLL 'a las' HH:mm");
}

// ---------------------------------------------------------------------------
// Los textos de cada rubro
// ---------------------------------------------------------------------------

export interface TextosDeTurnos {
  /** El rubro: va en `quien` de reprogramarTurno (decide si se emite el
   *  evento del turno, R10). */
  rubro: OrganizationIndustry;
  /** Para el candado de identidad ("paciente", "cliente"). */
  termino: string;
  /** Cuando el contacto no tiene nombre ("el paciente"). */
  nombrePorDefecto: string;
  sufijoErrorDeArgumentos: string;
  noEncontrado: string;
  noConfirmado: string;
  yaEmpezo: string;
  sinAutor: string;
  fueraDePlazo: (horas: number) => string;
  sinTurnos: string;
  /** Las claves del servicio y del recurso en lo que ve el modelo. */
  claves: { servicio: string; recurso: string };
  descripciones: {
    getContactBookings: string;
    rescheduleBooking: string;
    cancelBooking: string;
    bookingId: string;
    startsAt: string;
    resourceId: string;
    confirmado: string;
  };
  queHacerAlCancelar: string;
  /** El final del cuerpo de la nota al cancelar. */
  cancelo: string;
}

export const TEXTOS_DE_TURNOS_DE_CLINICA: TextosDeTurnos = {
  rubro: "CLINICA",
  termino: TERMINO_DE_LAS_TOOLS,
  nombrePorDefecto: "el paciente",
  sufijoErrorDeArgumentos: SUFIJO_ERROR_DE_ARGUMENTOS_DE_CLINICA,
  noEncontrado: MENSAJE_TURNO_NO_ENCONTRADO,
  noConfirmado: MENSAJE_TURNO_NO_CONFIRMADO,
  yaEmpezo: MENSAJE_TURNO_YA_EMPEZO,
  sinAutor: MENSAJE_SIN_AUTOR,
  fueraDePlazo: mensajeFueraDePlazo,
  sinTurnos:
    "El paciente NO tiene turnos próximos en esta sede. No le digas que tiene uno: si quiere agendar, consultá la disponibilidad.",
  claves: { servicio: "prestacion", recurso: "profesional" },
  descripciones: {
    getContactBookings:
      "Lista los próximos turnos confirmados del paciente de esta conversación, en esta sede: id, día y hora, prestación y profesional. Usala siempre antes de reprogramar o cancelar, para saber de qué turno se trata: nunca supongas cuál es ni inventes un id.",
    rescheduleBooking:
      "Cambia de día, hora o profesional un turno del paciente de esta conversación (el mismo turno, no uno nuevo). Usala solo después de que el paciente confirmó qué turno mueve y a qué horario, y con un horario que devolvió get_availability para esa prestación. Si devuelve que no se puede, no insistas: decíselo al paciente y derivá a una persona del equipo.",
    cancelBooking:
      "Cancela un turno del paciente de esta conversación, en dos pasos. Primero llamala sin confirmado: NO cancela nada, te devuelve un resumen del turno. Mostráselo al paciente y preguntale si confirma que lo quiere cancelar. Recién cuando conteste que sí, en su mensaje siguiente, llamala de nuevo con confirmado: true. Si devuelve que no se puede, no insistas: decíselo al paciente.",
    bookingId: "Id del turno, tal cual lo devolvió get_contact_bookings.",
    startsAt: "Inicio del horario nuevo, ISO 8601 con zona.",
    resourceId:
      "Id del profesional nuevo, solo si el paciente pidió cambiar de profesional. Sin él, el mismo.",
    confirmado:
      "true solo si ya le mostraste el resumen de ESTE turno en tu mensaje anterior y el paciente te contestó que sí lo cancela. Sin eso, no lo mandes.",
  },
  queHacerAlCancelar:
    "El turno NO está cancelado. Mostrale al paciente este resumen (el día tal cual figura en cuando, la prestación y el profesional) y preguntale si confirma que lo quiere cancelar. Recién cuando te conteste que sí, en su mensaje siguiente, volvé a llamar a esta herramienta con confirmado: true.",
  cancelo: "Canceló: el asistente, a pedido del paciente.",
};

// ---------------------------------------------------------------------------
// El aviso del rubro
// ---------------------------------------------------------------------------

export interface AvisoDeCambioDeTurno {
  tipo: "REPROGRAMADO" | "CANCELADO";
  contexto: ContextoDeEjecucionDeTool;
  turno: { id: string; contactId: string; branchId: string };
  /** El nombre del contacto, como va en la nota. */
  nombre: string;
  /** Quién firma la nota (ver AUTOR arriba). */
  autorId: string;
  /** "lunes 2 de noviembre a las 10:00 con Juan". */
  antes: string;
  /** Solo al reprogramar. */
  ahora?: string;
}

export interface OpcionesDeToolsDeTurnos {
  alCambiar?: (tx: Prisma.TransactionClient, aviso: AvisoDeCambioDeTurno) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Las tools
// ---------------------------------------------------------------------------

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

/** Arma las tres tools de turnos con los textos de un rubro. */
export function crearToolsDeTurnos(
  t: TextosDeTurnos,
  opciones: OpcionesDeToolsDeTurnos = {},
): Readonly<Record<string, ToolDelAgente>> {
  function nombreDelContacto(turno: TurnoDelContacto): string {
    return (
      `${turno.contact.firstName} ${turno.contact.lastName ?? ""}`.trim() || t.nombrePorDefecto
    );
  }

  /** Las reglas 1 a 4 de arriba. */
  async function turnoQueSePuedeCambiar(
    bookingId: string,
    contexto: ContextoDeEjecucionDeTool,
  ): Promise<{ ok: true; turno: TurnoDelContacto } | { ok: false; resultado: ResultadoDeTool }> {
    const bloqueo = await bloqueoPorIdentidad(contexto, t.termino);
    if (bloqueo) return { ok: false, resultado: bloqueo };

    const turno = await buscarTurnoDelContacto(bookingId, contexto);
    if (!turno) return { ok: false, resultado: fallo(t.noEncontrado) };
    if (turno.status !== "CONFIRMED") {
      return { ok: false, resultado: fallo(t.noConfirmado) };
    }
    const ahora = relojDeReservas.ahora();
    if (turno.startsAt.getTime() <= ahora.getTime()) {
      return { ok: false, resultado: fallo(t.yaEmpezo) };
    }
    const { minHoursToChangeBooking: horas } = await leerConfiguracionDeSede(
      contexto.organizationId,
      turno.branchId,
    );
    if (horas !== null && turno.startsAt.getTime() - ahora.getTime() < horas * 60 * 60 * 1000) {
      return { ok: false, resultado: fallo(t.fueraDePlazo(horas), CODIGO_FUERA_DE_PLAZO) };
    }
    return { ok: true, turno };
  }

  const getContactBookingsTool: ToolDelAgente = {
    definition: {
      name: "get_contact_bookings",
      description: t.descripciones.getContactBookings,
      parameters: sinParametros,
    },

    ejecutar(_args, contexto) {
      return conErroresDeNegocio(async () => {
        const bloqueo = await bloqueoPorIdentidad(contexto, t.termino);
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
          return exitoVacio({ turnos: [] }, t.sinTurnos);
        }
        const zona = await zonaDeLaSucursal(contexto);
        return exito({
          zonaHoraria: zona,
          turnos: turnos.map((turno) => ({
            bookingId: turno.id,
            cuando: cuandoEnLaSede(turno.startsAt, zona),
            inicio: isoEnZona(turno.startsAt, zona),
            fin: isoEnZona(turno.endsAt, zona),
            [t.claves.servicio]: turno.serviceType.name,
            [t.claves.recurso]: { id: turno.resource.id, name: turno.resource.name },
          })),
        });
      });
    },
  };

  const rescheduleBookingTool: ToolDelAgente = {
    definition: {
      name: "reschedule_booking",
      description: t.descripciones.rescheduleBooking,
      parameters: {
        type: "object",
        properties: {
          bookingId: { type: "string", description: t.descripciones.bookingId },
          startsAt: { type: "string", description: t.descripciones.startsAt },
          resourceId: { type: "string", description: t.descripciones.resourceId },
        },
        required: ["bookingId", "startsAt"],
        additionalProperties: false,
      },
    },

    ejecutar(args, contexto) {
      const validacion = validarArgs(rescheduleBookingArgs, args, t.sufijoErrorDeArgumentos);
      if (!validacion.ok) return Promise.resolve(validacion.resultado);
      const input = validacion.value;

      return conErroresDeNegocio(async () => {
        const cambiable = await turnoQueSePuedeCambiar(input.bookingId, contexto);
        if (!cambiable.ok) return cambiable.resultado;
        const { turno: anterior } = cambiable;
        const autor = await autorParaElAsistente(contexto);
        if (!autor) return fallo(t.sinAutor, CODIGO_SIN_AUTOR);
        const zona = await zonaDeLaSucursal(contexto);

        // Como una Recepción de la sede de la conversación: sin `force` ni
        // sobreturno (no se mandan), y acotado a esa sede.
        const quien: QuienReprograma = {
          userId: autor,
          role: "RECEPCION",
          industry: t.rubro,
          sedes: [contexto.conversation.branchId],
          descripcion: "el asistente",
          esAsistente: true,
        };
        const { alCambiar } = opciones;
        const turno = await reprogramarTurno(
          contexto.organizationId,
          input.bookingId,
          {
            startsAt: input.startsAt,
            ...(input.resourceId !== undefined ? { resourceId: input.resourceId } : {}),
          },
          quien,
          undefined,
          alCambiar
            ? async (tx, fila, recursoNuevo) =>
                alCambiar(tx, {
                  tipo: "REPROGRAMADO",
                  contexto,
                  turno: fila,
                  nombre: nombreDelContacto(anterior),
                  autorId: autor,
                  antes: `${formatoDelTurno(anterior.startsAt, zona)} con ${anterior.resource.name}`,
                  ahora: `${formatoDelTurno(fila.startsAt, zona)} con ${recursoNuevo}`,
                })
            : undefined,
        );
        return exito({
          bookingId: turno.id,
          zonaHoraria: zona,
          cuando: cuandoEnLaSede(turno.startsAt, zona),
          startsAt: isoEnZona(turno.startsAt, zona),
          endsAt: isoEnZona(turno.endsAt, zona),
          [`${t.claves.recurso}Id`]: turno.resourceId,
        });
      });
    },
  };

  const cancelBookingTool: ToolDelAgente = {
    definition: {
      name: "cancel_booking",
      description: t.descripciones.cancelBooking,
      parameters: {
        type: "object",
        properties: {
          bookingId: { type: "string", description: t.descripciones.bookingId },
          confirmado: { type: "boolean", description: t.descripciones.confirmado },
        },
        required: ["bookingId"],
        additionalProperties: false,
      },
    },

    ejecutar(args, contexto) {
      const validacion = validarArgs(cancelBookingArgs, args, t.sufijoErrorDeArgumentos);
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
              [t.claves.servicio]: turno.serviceType.name,
              [t.claves.recurso]: turno.resource.name,
            },
            queHacer: t.queHacerAlCancelar,
          });
        }

        const autor = await autorParaElAsistente(contexto);
        if (!autor) return fallo(t.sinAutor, CODIGO_SIN_AUTOR);

        const nombre = nombreDelContacto(turno);
        const antes = `${formatoDelTurno(turno.startsAt, zona)} con ${turno.resource.name}`;
        // El servicio de siempre (booking.cancelled, Google), con la nota del
        // historial (y el aviso del rubro) en la misma transacción.
        await cancelBooking(
          contexto.organizationId,
          bookingId,
          undefined,
          undefined,
          async (tx) => {
            await createActivityRepo(
              {
                organizationId: contexto.organizationId,
                authorId: autor,
                type: "NOTE",
                assigneeId: null,
                companyId: null,
                contactId: turno.contactId,
                opportunityId: null,
                branchId: turno.branchId,
                subject: `${MARCA_DEL_ASISTENTE}${PREFIJO_NOTA_CANCELADO}${nombre}`.slice(0, 255),
                body: `Era: ${antes} (${turno.serviceType.name}). ${t.cancelo}`,
              },
              tx,
            );
            if (opciones.alCambiar) {
              await opciones.alCambiar(tx, {
                tipo: "CANCELADO",
                contexto,
                turno,
                nombre,
                autorId: autor,
                antes,
              });
            }
          },
        );
        return exito({ bookingId, cancelado: true, cuando: cuandoEnLaSede(turno.startsAt, zona) });
      });
    },
  };

  return {
    get_contact_bookings: getContactBookingsTool,
    reschedule_booking: rescheduleBookingTool,
    cancel_booking: cancelBookingTool,
  };
}

/** Las tools que tiene una clínica, por nombre. */
export const TOOLS_DE_TURNOS_DE_CLINICA = crearToolsDeTurnos(TEXTOS_DE_TURNOS_DE_CLINICA);
