import type { Prisma } from "@prisma/client";
import { createActivity as createActivityRepo } from "../repositories/activity.repository";
import { SUFIJO_ERROR_DE_ARGUMENTOS } from "../services/agentTools.service";
import { relojDeReservas } from "../services/booking.service";
import {
  MARCA_DEL_ASISTENTE,
  PREFIJO_NOTA_REPROGRAMADO,
} from "../clinicas/services/reprogramar.service";
import {
  PREFIJO_NOTA_CANCELADO,
  crearToolsDeTurnos,
  type AvisoDeCambioDeTurno,
  type TextosDeTurnos,
} from "../clinicas/toolsDeTurnos";

// ---------------------------------------------------------------------------
// Ver, reprogramar y cancelar los turnos del cliente, en el agente de una
// AUTOMOTORA (decisión de Rocco, 2026-10-31): las mismas tres tools que una
// clínica (src/clinicas/toolsDeTurnos.ts, una sola implementación), con los
// textos de una automotora y un aviso propio.
//
// AVISO AL VENDEDOR. Además de la nota del historial (la misma que en una
// clínica), al reprogramar o cancelar se crea una TAREA para el vendedor del
// cliente —o, si no tiene, el vendedor por defecto de la sucursal— con el
// horario de antes y el de ahora, que vence en el momento para que aparezca
// arriba en su lista. Sin ninguno de los dos, queda solo la nota. Va en la
// misma transacción que el cambio: o quedan las dos cosas, o ninguna.
//
// PLAZO MÍNIMO: el mismo minHoursToChangeBooking por sucursal que en una
// clínica. Una automotora no tiene la fila de configuración, así que es "sin
// plazo". Hacerlo editable en una automotora es un pendiente (necesita
// pantalla y endpoint).
// ---------------------------------------------------------------------------

export const PREFIJO_TAREA_REPROGRAMADO = "Turno reprogramado por el cliente: ";
export const PREFIJO_TAREA_CANCELADO = "Turno cancelado por el cliente: ";

const DERIVAR = "derivá a una persona del equipo";

export const TEXTOS_DE_TURNOS_DE_AUTOMOTORA: TextosDeTurnos = {
  rubro: "AUTOMOTORA",
  termino: "cliente",
  nombrePorDefecto: "el cliente",
  sufijoErrorDeArgumentos: SUFIJO_ERROR_DE_ARGUMENTOS,
  noEncontrado:
    "Ese turno no está entre los turnos de este cliente. Usá get_contact_bookings para ver sus turnos y usá el id tal cual figura ahí.",
  noConfirmado: `Ese turno ya no está confirmado (se canceló o ya se marcó): no se puede cambiar. Si el cliente necesita algo con ese turno, ${DERIVAR}.`,
  yaEmpezo: `Ese turno ya empezó o ya pasó: no se puede cambiar. Si el cliente necesita algo con ese turno, ${DERIVAR}.`,
  sinAutor: `Por este medio no se puede cambiar el turno ahora. Decíselo al cliente y ${DERIVAR} para que lo haga.`,
  fueraDePlazo: (horas) =>
    `Falta menos de ${horas} ${horas === 1 ? "hora" : "horas"} para ese turno: por este medio ya no se puede cambiar ni cancelar. Decíselo al cliente con claridad y ${DERIVAR} para que lo resuelva. No lo intentes de otra forma.`,
  sinTurnos:
    "El cliente NO tiene turnos próximos en esta sucursal. No le digas que tiene uno: si quiere agendar, consultá la disponibilidad.",
  claves: { servicio: "servicio", recurso: "recurso" },
  descripciones: {
    getContactBookings:
      "Lista los próximos turnos confirmados del cliente de esta conversación (pruebas de manejo, visitas, lo que la sucursal agende), en esta sucursal: id, día y hora, servicio y recurso. Usala siempre antes de reprogramar o cancelar, para saber de qué turno se trata: nunca supongas cuál es ni inventes un id.",
    rescheduleBooking: `Cambia de día u hora (o de recurso) un turno del cliente de esta conversación: es el mismo turno, no uno nuevo, y no cuenta para el tope de turnos. Usala solo después de que el cliente confirmó qué turno mueve y a qué horario, y con un horario que devolvió get_availability para ese servicio. El vendedor se entera solo: no hace falta derivar para avisarle. Si devuelve que no se puede, no insistas: decíselo al cliente y ${DERIVAR}.`,
    cancelBooking:
      "Cancela un turno del cliente de esta conversación, en dos pasos. Primero llamala sin confirmado: NO cancela nada, te devuelve un resumen del turno. Mostráselo al cliente y preguntale si confirma que lo quiere cancelar. Recién cuando conteste que sí, en su mensaje siguiente, llamala de nuevo con confirmado: true. El vendedor se entera solo. Si devuelve que no se puede, no insistas: decíselo al cliente.",
    bookingId: "Id del turno, tal cual lo devolvió get_contact_bookings.",
    startsAt: "Inicio del horario nuevo, ISO 8601 con zona.",
    resourceId:
      "Id del recurso nuevo, solo si el cliente pidió cambiarlo y get_availability lo ofreció. Sin él, el mismo.",
    confirmado:
      "true solo si ya le mostraste el resumen de ESTE turno en tu mensaje anterior y el cliente te contestó que sí lo cancela. Sin eso, no lo mandes.",
  },
  queHacerAlCancelar:
    "El turno NO está cancelado. Mostrale al cliente este resumen (el día tal cual figura en cuando y el servicio) y preguntale si confirma que lo quiere cancelar. Recién cuando te conteste que sí, en su mensaje siguiente, volvé a llamar a esta herramienta con confirmado: true.",
  cancelo: "Canceló: el asistente, a pedido del cliente.",
};

/** El texto de la tarea del vendedor. Pura. */
export function tareaDelCambio(
  aviso: Pick<AvisoDeCambioDeTurno, "tipo" | "nombre" | "antes" | "ahora">,
): {
  subject: string;
  body: string;
} {
  if (aviso.tipo === "REPROGRAMADO") {
    return {
      subject: `${MARCA_DEL_ASISTENTE}${PREFIJO_TAREA_REPROGRAMADO}${aviso.nombre}`.slice(0, 255),
      body:
        `${aviso.nombre} pidió cambiar su turno. Antes: ${aviso.antes}. Ahora: ${aviso.ahora ?? ""}. ` +
        "Lo reprogramó el asistente; revisá que te quede bien.",
    };
  }
  return {
    subject: `${MARCA_DEL_ASISTENTE}${PREFIJO_TAREA_CANCELADO}${aviso.nombre}`.slice(0, 255),
    body: `${aviso.nombre} canceló su turno del ${aviso.antes}. Lo canceló el asistente, a pedido del cliente.`,
  };
}

/** El vendedor que recibe la tarea: el del cliente, si no el de la sucursal.
 *  null = ninguno, y queda solo la nota. */
async function vendedorDelAviso(
  tx: Prisma.TransactionClient,
  aviso: AvisoDeCambioDeTurno,
): Promise<string | null> {
  const { organizationId } = aviso.contexto;
  const [contacto, sucursal] = await Promise.all([
    tx.contact.findFirst({
      where: { id: aviso.turno.contactId, organizationId },
      select: { owner: { select: { id: true, isActive: true, deletedAt: true } } },
    }),
    tx.branch.findFirst({
      where: { id: aviso.turno.branchId, organizationId },
      select: { defaultOwner: { select: { id: true, isActive: true, deletedAt: true } } },
    }),
  ]);
  const activo = (
    u: { id: string; isActive: boolean; deletedAt: Date | null } | null | undefined,
  ) => (u && u.isActive && u.deletedAt === null ? u.id : null);
  return activo(contacto?.owner) ?? activo(sucursal?.defaultOwner) ?? null;
}

export async function avisarAlVendedor(
  tx: Prisma.TransactionClient,
  aviso: AvisoDeCambioDeTurno,
): Promise<void> {
  const vendedor = await vendedorDelAviso(tx, aviso);
  if (!vendedor) return;
  const { subject, body } = tareaDelCambio(aviso);
  await createActivityRepo(
    {
      organizationId: aviso.contexto.organizationId,
      authorId: aviso.autorId,
      type: "TASK",
      assigneeId: vendedor,
      companyId: null,
      contactId: aviso.turno.contactId,
      opportunityId: null,
      branchId: aviso.turno.branchId,
      subject,
      body,
      dueDate: relojDeReservas.ahora(),
    },
    tx,
  );
}

/** Las tools de turnos de una automotora, por nombre. */
export const TOOLS_DE_TURNOS_DE_AUTOMOTORA = crearToolsDeTurnos(TEXTOS_DE_TURNOS_DE_AUTOMOTORA, {
  alCambiar: avisarAlVendedor,
});

// Los prefijos de la NOTA son los mismos que en una clínica (la pantalla del
// historial los reconoce igual).
export { PREFIJO_NOTA_CANCELADO, PREFIJO_NOTA_REPROGRAMADO };
