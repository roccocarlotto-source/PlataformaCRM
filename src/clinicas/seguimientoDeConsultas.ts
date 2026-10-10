import { Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { configDeConsultaSinAvanceSchema } from "../services/automationTriggers";

// ---------------------------------------------------------------------------
// El seguimiento de consultas estancadas (#446) en una CLÍNICA (docs/rubros.md
// §9.1, R15). Tres cosas, solo en CLINICA; en una automotora el seguimiento es
// el de siempre (suite "automotora sin cambios"):
//
//   1. FILTRO POR TURNOS: no se le escribe a un contacto con un turno
//      CONFIRMED futuro ni a uno atendido (COMPLETED, R10) en los últimos
//      `daysSinceLastMessage` días de la regla. Se mira en el barrido, en la
//      acción y en el worker antes de mandar, donde ya se mira la oportunidad.
//      Un "No vino" no frena: §9.1 solo nombra el atendido.
//   2. TEXTO Y VARIABLES: {prestacion} (de leadServiceOfInterest, con el
//      respaldo "lo que consultaste") en lugar de {vehiculo}.
//   3. SIEMPRE LA PLANTILLA (D7): nunca texto libre de la IA, ni en AUTONOMA.
// ---------------------------------------------------------------------------

const MS_POR_DIA = 24 * 60 * 60 * 1000;

export const MOTIVO_TURNO_DEL_PACIENTE =
  "El paciente tiene un turno próximo o fue atendido en los últimos días";

/** El texto por defecto de una regla nueva en una clínica (espejo en
 *  frontend/src/features/automation/catalog.ts). */
export const TEXTO_POR_DEFECTO_DE_CLINICA =
  "¡{saludo}! Te escribimos por tu consulta sobre {prestacion}. ¿Querés que te ayudemos a coordinar un turno?";

/** Pura: con qué se nombra lo que consultó: la prestación que buscó, o un
 *  texto genérico. */
export function prestacionParaElMensaje(contacto: {
  leadServiceOfInterest: string | null;
}): string {
  const buscada = contacto.leadServiceOfInterest?.trim();
  return buscada && buscada.length > 0 ? buscada : "lo que consultaste";
}

/** Desde cuándo un turno atendido frena el seguimiento. */
export function desdeDelAtendido(ahora: Date, dias: number): Date {
  return new Date(ahora.getTime() - dias * MS_POR_DIA);
}

/** La condición del barrido (findStalledInquiries), sobre el contacto `c`. */
export function sinTurnoQueFrene(ahora: Date, dias: number): Prisma.Sql {
  return Prisma.sql`AND NOT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.organization_id = c.organization_id
      AND b.contact_id = c.id
      AND (
        (b.status = 'CONFIRMED'::"BookingStatus" AND b.starts_at > ${ahora})
        OR (
          b.status = 'COMPLETED'::"BookingStatus"
          AND b.ends_at >= ${desdeDelAtendido(ahora, dias)}
          AND b.starts_at <= ${ahora}
        )
      )
  )`;
}

/** Lo mismo, para un contacto (la acción y el worker). */
export async function tieneTurnoQueFrena(
  organizationId: string,
  contactId: string,
  dias: number,
  ahora: Date,
  db: Db = prisma,
): Promise<boolean> {
  const turno = await db.booking.findFirst({
    where: {
      organizationId,
      contactId,
      OR: [
        { status: "CONFIRMED", startsAt: { gt: ahora } },
        {
          status: "COMPLETED",
          endsAt: { gte: desdeDelAtendido(ahora, dias) },
          startsAt: { lte: ahora },
        },
      ],
    },
    select: { id: true },
  });
  return turno !== null;
}

/** Los días de silencio de la regla (su triggerConfig). Sin la regla o con un
 *  config inválido, el default del trigger. */
export async function diasDeLaRegla(
  organizationId: string,
  automationId: string,
  db: Db = prisma,
): Promise<number> {
  const regla = await db.automation.findFirst({
    where: { id: automationId, organizationId },
    select: { triggerConfig: true },
  });
  const config = configDeConsultaSinAvanceSchema.safeParse(regla?.triggerConfig ?? {});
  return config.success
    ? config.data.daysSinceLastMessage
    : configDeConsultaSinAvanceSchema.parse({}).daysSinceLastMessage;
}

/** Para la acción y el worker: si una clínica no tiene que escribirle a este
 *  contacto por sus turnos. Una automotora: siempre false, sin leer turnos. */
export async function turnoFrenaElSeguimiento(
  organizationId: string,
  automationId: string,
  contactId: string,
  ahora: Date,
  esClinica: boolean,
  db: Db = prisma,
): Promise<boolean> {
  if (!esClinica) return false;
  const dias = await diasDeLaRegla(organizationId, automationId, db);
  return tieneTurnoQueFrena(organizationId, contactId, dias, ahora, db);
}
