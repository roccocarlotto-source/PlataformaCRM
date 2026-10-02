import { WhatsappTemplateHeaderFormat, WhatsappTemplateStatus } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Las plantillas de WhatsApp de cada regla de automatización (ítem 160 de
// docs/frontend-cambios-pendientes.md; hasta el ítem 181 era una por
// organización). Ver el modelo WhatsappTemplate en schema.prisma y el flujo
// con Meta en src/services/whatsappTemplate.service.ts.
//
// HASTA DOS VIVAS POR REGLA (migración 20261015120000): la APROBADA, con la
// que se manda, y la CANDIDATA —en revisión o rechazada—, la versión nueva que
// nace cuando el negocio cambia el formato o el texto. La regla sigue
// mandando con la aprobada hasta que Meta aprueba la candidata; en ese
// momento aplicarEstadoDePlantilla da de baja la anterior y promueve la nueva
// en una sola transacción, que es lo que dejan pasar los dos UNIQUE parciales.
//
// Mismo molde que el resto de los repositorios: organizationId obligatorio y
// deletedAt: null en toda lectura, updateMany con organizationId en el WHERE
// (M4). Las DOS excepciones, cada una con su motivo, son las que no tienen
// organización de contexto: el chequeo de nombre (el nombre es único en toda
// la tabla, porque el WABA es compartido) y la actualización por el webhook
// de Meta (que solo trae el id de la plantilla).
// ---------------------------------------------------------------------------

// Lo que sale por la API. Sin organizationId ni deletedAt (implícitos), y sin
// metaTemplateId: es un detalle de la integración que la pantalla no usa.
const seleccionPublica = {
  id: true,
  automationId: true,
  name: true,
  language: true,
  bodyText: true,
  headerFormat: true,
  status: true,
  rejectedReason: true,
  createdAt: true,
  updatedAt: true,
} as const;

const seleccionConMeta = { ...seleccionPublica, metaTemplateId: true } as const;

// La aprobada y la candidata de una regla (cualquiera puede faltar). Más
// reciente primero por si el UNIQUE no estuviera aplicado: nunca devuelve dos
// del mismo lado.
export async function findPlantillasDeLaRegla(
  organizationId: string,
  automationId: string,
  db: Db = prisma,
) {
  const vivas = await db.whatsappTemplate.findMany({
    where: { organizationId, automationId, deletedAt: null },
    select: seleccionConMeta,
    orderBy: { createdAt: "desc" },
  });
  return {
    aprobada: vivas.find((p) => p.status === WhatsappTemplateStatus.APPROVED) ?? null,
    candidata: vivas.find((p) => p.status !== WhatsappTemplateStatus.APPROVED) ?? null,
  };
}

export type PlantillaConMeta = NonNullable<
  Awaited<ReturnType<typeof findPlantillasDeLaRegla>>["aprobada"]
>;

export function findPublicWhatsappTemplateById(
  organizationId: string,
  id: string,
  db: Db = prisma,
) {
  return db.whatsappTemplate.findFirst({
    where: { id, organizationId, deletedAt: null },
    select: seleccionPublica,
  });
}

export type WhatsappTemplatePublica = NonNullable<
  Awaited<ReturnType<typeof findPublicWhatsappTemplateById>>
>;

export function findWhatsappTemplateById(organizationId: string, id: string, db: Db = prisma) {
  return db.whatsappTemplate.findFirst({
    where: { id, organizationId, deletedAt: null },
    select: seleccionConMeta,
  });
}

// Global a propósito (ver el encabezado): el nombre es único en el WABA.
export async function isWhatsappTemplateNameTaken(name: string, db: Db = prisma) {
  const fila = await db.whatsappTemplate.findFirst({
    where: { name, deletedAt: null },
    select: { id: true },
  });
  return fila !== null;
}

export interface ReservarWhatsappTemplateData {
  organizationId: string;
  automationId: string;
  name: string;
  language: string;
  bodyText: string;
  headerFormat: WhatsappTemplateHeaderFormat;
}

// Nace PENDING y sin metaTemplateId: es la candidata. El UNIQUE parcial de
// candidatas frena una segunda en paralelo.
export function reserveWhatsappTemplate(data: ReservarWhatsappTemplateData, db: Db = prisma) {
  return db.whatsappTemplate.create({
    data: { ...data, status: WhatsappTemplateStatus.PENDING },
    select: seleccionPublica,
  });
}

// Borrado FÍSICO de una reserva que Meta rechazó en el alta: no llegó a
// existir. Solo si sigue sin metaTemplateId, para no borrar nunca una que Meta
// sí conoce.
export function discardWhatsappTemplateReservation(
  organizationId: string,
  id: string,
  db: Db = prisma,
) {
  return db.whatsappTemplate.deleteMany({
    where: { id, organizationId, metaTemplateId: null },
  });
}

export interface EstadoDePlantilla {
  status: WhatsappTemplateStatus;
  rejectedReason: string | null;
}

// El alta en Meta respondió: se guarda su id y el estado inicial (casi siempre
// PENDING). Pasa por aplicarEstadoDePlantilla por si Meta la aprueba en el
// acto, que también promueve.
export async function setWhatsappTemplateMetaId(
  organizationId: string,
  id: string,
  datos: EstadoDePlantilla & { metaTemplateId: string },
) {
  const { metaTemplateId, ...estado } = datos;
  const { count } = await prisma.whatsappTemplate.updateMany({
    where: { id, organizationId, deletedAt: null },
    data: { metaTemplateId },
  });
  if (count === 0) return { count, reemplazada: null };
  return aplicarEstadoDePlantilla({ id, organizationId }, estado);
}

export function setWhatsappTemplateStatus(
  organizationId: string,
  id: string,
  estado: EstadoDePlantilla,
) {
  return aplicarEstadoDePlantilla({ id, organizationId }, estado);
}

// El webhook de Meta: sin organización de contexto (ver el encabezado). Puede
// tocar varias filas solo si el mismo id de Meta quedó en más de una viva, que
// no pasa; se aplica a cada una por el mismo camino.
export async function setWhatsappTemplateStatusByMetaId(
  metaTemplateId: string,
  estado: EstadoDePlantilla,
) {
  const filas = await prisma.whatsappTemplate.findMany({
    where: { metaTemplateId, deletedAt: null },
    select: { id: true, organizationId: true },
  });
  const reemplazadas: PlantillaReemplazada[] = [];
  for (const fila of filas) {
    const { reemplazada } = await aplicarEstadoDePlantilla(fila, estado);
    if (reemplazada) reemplazadas.push(reemplazada);
  }
  return { count: filas.length, reemplazadas };
}

export interface PlantillaReemplazada {
  id: string;
  name: string;
  metaTemplateId: string | null;
}

// El cambio de estado de UNA plantilla, con lo que implica para su par:
// - una candidata que pasa a APPROVED: la aprobada anterior de la regla se da
//   de baja y esta toma su lugar, en la misma transacción. Se devuelve la
//   reemplazada para que el service la borre también en Meta;
// - una aprobada que deja de estarlo (Meta la pausó o la deshabilitó) con una
//   candidata ya en curso: ya no sirve para mandar y dos no aprobadas no
//   entran en el UNIQUE, así que se da de baja con su estado final. Sin
//   candidata, se queda con el estado nuevo: es lo que la pantalla muestra.
// - cualquier otro caso: solo el estado.
// count 0 si la plantilla no existe, está borrada o es de otra organización.
export async function aplicarEstadoDePlantilla(
  donde: { id: string; organizationId: string },
  estado: EstadoDePlantilla,
): Promise<{ count: number; reemplazada: PlantillaReemplazada | null }> {
  return prisma.$transaction(async (tx) => {
    const fila = await tx.whatsappTemplate.findFirst({
      where: { id: donde.id, organizationId: donde.organizationId, deletedAt: null },
      select: { id: true, organizationId: true, automationId: true, status: true },
    });
    if (!fila) return { count: 0, reemplazada: null };
    const deLaRegla = {
      organizationId: fila.organizationId,
      automationId: fila.automationId,
      deletedAt: null,
      id: { not: fila.id },
    };
    const aprobada = WhatsappTemplateStatus.APPROVED;

    let reemplazada: PlantillaReemplazada | null = null;
    if (estado.status === aprobada && fila.status !== aprobada) {
      reemplazada = await tx.whatsappTemplate.findFirst({
        where: { ...deLaRegla, status: aprobada },
        select: { id: true, name: true, metaTemplateId: true },
      });
      if (reemplazada) {
        await tx.whatsappTemplate.update({
          where: { id: reemplazada.id },
          data: { deletedAt: new Date() },
        });
      }
    } else if (estado.status !== aprobada && fila.status === aprobada) {
      const candidata = await tx.whatsappTemplate.findFirst({
        where: { ...deLaRegla, status: { not: aprobada } },
        select: { id: true },
      });
      if (candidata) {
        await tx.whatsappTemplate.update({
          where: { id: fila.id },
          data: { ...estado, deletedAt: new Date() },
        });
        return { count: 1, reemplazada: null };
      }
    }
    await tx.whatsappTemplate.update({ where: { id: fila.id }, data: estado });
    return { count: 1, reemplazada };
  });
}

export function softDeleteWhatsappTemplate(organizationId: string, id: string, db: Db = prisma) {
  return db.whatsappTemplate.updateMany({
    where: { id, organizationId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}

// La que usa el worker: la APROBADA y viva de la regla, con su encabezado. Si
// hay una versión nueva en revisión, no cuenta todavía.
export function findApprovedWhatsappTemplate(
  organizationId: string,
  automationId: string,
  db: Db = prisma,
) {
  return db.whatsappTemplate.findFirst({
    where: {
      organizationId,
      automationId,
      deletedAt: null,
      status: WhatsappTemplateStatus.APPROVED,
    },
    select: { name: true, language: true, bodyText: true, headerFormat: true },
  });
}
