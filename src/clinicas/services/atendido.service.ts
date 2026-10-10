import { DateTime } from "luxon";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { createActivity as createActivityRepo } from "../../repositories/activity.repository";
import { findBookingById } from "../../repositories/booking.repository";
import { findOldestActiveAdmin } from "../../repositories/user.repository";
import { relojDeReservas } from "../../services/booking.service";
import { exigirSedeDelActor, type ActorConSedes } from "../../services/permisos";
import { AppError } from "../../utils/AppError";
import { EVENTO_TURNO_ATENDIDO, EVENTO_TURNO_NO_VINO, emitirEventoDeTurno } from "./eventosDeTurno";

// ---------------------------------------------------------------------------
// Atendido / No vino de un turno de clínica (docs/rubros.md §4.8, D6, R10).
//
// - Lo marcan ADMIN y Recepción, en sus sedes (404 fuera de ellas), sobre un
//   turno que ya empezó. El agente no marca nada (no hay tool).
// - CONFIRMED → COMPLETED o NO_SHOW. CORRECCIÓN (decisión de Rocco del
//   2026-10-10): COMPLETED ↔ NO_SHOW, sin límite de tiempo; volver a CONFIRMED
//   no. Marcar lo mismo otra vez no hace nada: ni nota ni evento.
// - Historial: una NOTE en el paciente con qué se marcó, cuándo y quién, y la
//   nota opcional (corta; la pantalla avisa que no se carguen datos de salud).
//   La nota vive solo en la actividad: el turno no guarda texto.
// - Evento booking.completed o booking.no_show en la misma transacción, con
//   esCorreccion y estadoAnterior. Los consumidores tienen que ser idempotentes
//   por turno (eventosDeTurno.ts).
//
// El cierre automático de las 3 h (D6) también vive acá: cerrarTurnosVencidos.
// ---------------------------------------------------------------------------

export type EstadoDeCierre = "COMPLETED" | "NO_SHOW";

export const LARGO_MAXIMO_DE_NOTA = 200;
export const PREFIJO_NOTA_ATENDIDO = "Turno atendido: ";
export const PREFIJO_NOTA_NO_VINO = "No vino al turno: ";
export const PREFIJO_NOTA_CORRECCION = "Corrección del turno: ";
export const PREFIJO_NOTA_CIERRE_AUTOMATICO = "Turno cerrado automáticamente: ";

const ROTULO: Record<EstadoDeCierre, string> = { COMPLETED: "Atendido", NO_SHOW: "No vino" };

function formato(fecha: Date, zona: string): string {
  return DateTime.fromJSDate(fecha, { zone: zona })
    .setLocale("es")
    .toFormat("cccc d 'de' LLLL 'a las' HH:mm");
}

export async function marcarTurno(
  organizationId: string,
  bookingId: string,
  estado: EstadoDeCierre,
  quien: ActorConSedes & { userId: string; descripcion: string },
  nota?: string | null,
) {
  const booking = await findBookingById(bookingId, organizationId);
  if (!booking) throw new AppError("Reserva no encontrada", 404);
  exigirSedeDelActor(quien, booking.branchId, "Reserva no encontrada");

  if (booking.status === "CANCELLED") {
    throw new AppError("Un turno cancelado no se marca", 409);
  }
  const ahora = relojDeReservas.ahora();
  if (booking.startsAt.getTime() > ahora.getTime()) {
    throw new AppError("El turno todavía no empezó", 400);
  }
  if (booking.status === estado) {
    // Idempotente: lo mismo otra vez no deja nota ni emite un evento.
    return booking;
  }
  const notaLimpia = nota?.trim() ? nota.trim().slice(0, LARGO_MAXIMO_DE_NOTA) : null;
  const anterior = booking.status;
  const esCorreccion = anterior !== "CONFIRMED";

  return prisma.$transaction(async (tx) => {
    // CAS sobre el estado leído: dos marcas simultáneas no se pisan.
    const { count } = await tx.booking.updateMany({
      where: { id: bookingId, organizationId, status: anterior },
      data: { status: estado, completedAt: ahora, completedBy: "PERSONA" },
    });
    if (count === 0) {
      const actual = await tx.booking.findFirst({ where: { id: bookingId, organizationId } });
      if (actual?.status === estado) return actual;
      throw new AppError("El turno cambió mientras se marcaba: volvé a intentarlo", 409);
    }
    const fila = await tx.booking.findFirstOrThrow({ where: { id: bookingId, organizationId } });
    const [contacto, sede] = await Promise.all([
      tx.contact.findFirst({
        where: { id: booking.contactId, organizationId },
        select: { firstName: true, lastName: true },
      }),
      tx.branch.findFirstOrThrow({
        where: { id: booking.branchId, organizationId },
        select: { timezone: true },
      }),
    ]);
    const paciente = contacto ? `${contacto.firstName} ${contacto.lastName}`.trim() : "el paciente";
    const titulo = esCorreccion
      ? `${PREFIJO_NOTA_CORRECCION}de ${ROTULO[anterior as EstadoDeCierre]} a ${ROTULO[estado]}`
      : `${estado === "COMPLETED" ? PREFIJO_NOTA_ATENDIDO : PREFIJO_NOTA_NO_VINO}${paciente}`;
    await createActivityRepo(
      {
        organizationId,
        authorId: quien.userId,
        type: "NOTE",
        assigneeId: null,
        companyId: null,
        contactId: booking.contactId,
        opportunityId: null,
        branchId: booking.branchId,
        subject: titulo.slice(0, 255),
        body:
          `${ROTULO[estado]}: el turno de ${paciente} del ${formato(booking.startsAt, sede.timezone)}. ` +
          `Marcó: ${quien.descripcion}, el ${formato(ahora, sede.timezone)}.` +
          (notaLimpia ? ` Nota: ${notaLimpia}` : ""),
      },
      tx,
    );
    await emitirEventoDeTurno(
      tx,
      estado === "COMPLETED" ? EVENTO_TURNO_ATENDIDO : EVENTO_TURNO_NO_VINO,
      fila,
      {
        esCorreccion,
        estadoAnterior: anterior,
        automatico: false,
        marcadoPorUserId: quien.userId,
      },
    );
    return fila;
  });
}

// ---------------------------------------------------------------------------
// El cierre automático (D6): los turnos CONFIRMED de clínicas cuyo endsAt pasó
// hace más de 3 h pasan a COMPLETED (completedBy AUTO), con una nota y
// booking.completed marcado automatico: true (R14 decide si espera antes de
// pedir la reseña; una corrección posterior a No vino usa el camino de arriba).
// IDEMPOTENTE: el CAS sobre CONFIRMED hace que dos pasadas (o dos procesos) no
// cierren dos veces el mismo turno. Una automotora nunca cambia sola: el
// barrido filtra por rubro.
// ---------------------------------------------------------------------------

export const HORAS_HASTA_EL_CIERRE_AUTOMATICO = 3;
const LOTE_DEL_CIERRE = 200;

export async function cerrarTurnosVencidos(
  opciones: { ahora?: Date; organizationId?: string } = {},
): Promise<{ cerrados: number }> {
  const ahora = opciones.ahora ?? relojDeReservas.ahora();
  const limite = new Date(ahora.getTime() - HORAS_HASTA_EL_CIERRE_AUTOMATICO * 60 * 60 * 1000);
  const vencidos = await prisma.booking.findMany({
    where: {
      status: "CONFIRMED",
      endsAt: { lt: limite },
      organization: { industry: "CLINICA" },
      ...(opciones.organizationId ? { organizationId: opciones.organizationId } : {}),
    },
    select: { id: true, organizationId: true },
    orderBy: { endsAt: "asc" },
    take: LOTE_DEL_CIERRE,
  });
  let cerrados = 0;
  for (const v of vencidos) {
    try {
      const cerro = await prisma.$transaction(async (tx) => {
        const { count } = await tx.booking.updateMany({
          where: { id: v.id, organizationId: v.organizationId, status: "CONFIRMED" },
          data: { status: "COMPLETED", completedAt: ahora, completedBy: "AUTO" },
        });
        if (count === 0) return false;
        const fila = await tx.booking.findFirstOrThrow({ where: { id: v.id } });
        const autor = await findOldestActiveAdmin(v.organizationId, tx);
        if (autor) {
          const sede = await tx.branch.findFirstOrThrow({
            where: { id: fila.branchId, organizationId: v.organizationId },
            select: { timezone: true },
          });
          const contacto = await tx.contact.findFirst({
            where: { id: fila.contactId, organizationId: v.organizationId },
            select: { firstName: true, lastName: true },
          });
          const paciente = contacto
            ? `${contacto.firstName} ${contacto.lastName}`.trim()
            : "el paciente";
          await createActivityRepo(
            {
              organizationId: v.organizationId,
              authorId: autor.id,
              type: "NOTE",
              assigneeId: null,
              companyId: null,
              contactId: fila.contactId,
              opportunityId: null,
              branchId: fila.branchId,
              subject: `${PREFIJO_NOTA_CIERRE_AUTOMATICO}${paciente}`.slice(0, 255),
              body:
                `El turno del ${formato(fila.startsAt, sede.timezone)} se cerró como atendido ` +
                `${HORAS_HASTA_EL_CIERRE_AUTOMATICO} h después de terminar. Si no vino, marcalo como No vino.`,
            },
            tx,
          );
        }
        await emitirEventoDeTurno(tx, EVENTO_TURNO_ATENDIDO, fila, {
          esCorreccion: false,
          estadoAnterior: "CONFIRMED",
          automatico: true,
        });
        return true;
      });
      if (cerro) cerrados++;
    } catch (err) {
      logger.error(
        { err, bookingId: v.id, organizationId: v.organizationId },
        "No se pudo cerrar automáticamente un turno; se sigue con los demás",
      );
    }
  }
  return { cerrados };
}
