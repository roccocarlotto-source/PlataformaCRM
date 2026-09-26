import { WhatsappTemplateStatus } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// La plantilla de WhatsApp de cada organización (ítem 160 de
// docs/frontend-cambios-pendientes.md). Ver el modelo WhatsappTemplate en
// schema.prisma y el flujo de alta/baja con Meta en
// src/services/whatsappTemplate.service.ts.
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
  name: true,
  language: true,
  bodyText: true,
  status: true,
  rejectedReason: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function findActiveWhatsappTemplate(organizationId: string, db: Db = prisma) {
  return db.whatsappTemplate.findFirst({
    where: { organizationId, deletedAt: null },
    select: seleccionPublica,
  });
}

export type WhatsappTemplatePublica = NonNullable<
  Awaited<ReturnType<typeof findActiveWhatsappTemplate>>
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

// Con los campos de la integración: lo que el service necesita para hablar
// con Meta (el id y el nombre con que se registró).
export function findWhatsappTemplateById(organizationId: string, id: string, db: Db = prisma) {
  return db.whatsappTemplate.findFirst({
    where: { id, organizationId, deletedAt: null },
    select: { ...seleccionPublica, metaTemplateId: true },
  });
}

// ¿Hay una plantilla activa con este nombre, de CUALQUIER organización? Es la
// regla del UNIQUE whatsapp_templates_name_active_unique, preguntada antes de
// escribir para poder dar un mensaje que la explique (el P2002 no dice cuál de
// los dos UNIQUE saltó).
export async function isWhatsappTemplateNameTaken(name: string, db: Db = prisma) {
  const fila = await db.whatsappTemplate.findFirst({
    where: { name, deletedAt: null },
    select: { id: true },
  });
  return fila !== null;
}

export interface ReservarWhatsappTemplateData {
  organizationId: string;
  name: string;
  language: string;
  bodyText: string;
}

// La fila nace ANTES del alta en Meta, en PENDING y sin metaTemplateId: los
// dos UNIQUE parciales reservan el lugar de la organización y el nombre, así
// que dos altas concurrentes no llegan las dos a Meta.
export function reserveWhatsappTemplate(data: ReservarWhatsappTemplateData, db: Db = prisma) {
  return db.whatsappTemplate.create({
    data: { ...data, status: WhatsappTemplateStatus.PENDING },
    select: seleccionPublica,
  });
}

// Borra FÍSICAMENTE una reserva cuyo alta en Meta falló. No es un soft delete
// porque la plantilla no llegó a existir en ningún lado: no hay nada que
// conservar como historial. Solo toca una reserva (metaTemplateId null): una
// fila que Meta ya conoce se borra con softDeleteWhatsappTemplate.
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

export function setWhatsappTemplateMetaId(
  organizationId: string,
  id: string,
  datos: EstadoDePlantilla & { metaTemplateId: string },
  db: Db = prisma,
) {
  return db.whatsappTemplate.updateMany({
    where: { id, organizationId, deletedAt: null },
    data: datos,
  });
}

export function setWhatsappTemplateStatus(
  organizationId: string,
  id: string,
  estado: EstadoDePlantilla,
  db: Db = prisma,
) {
  return db.whatsappTemplate.updateMany({
    where: { id, organizationId, deletedAt: null },
    data: estado,
  });
}

// El webhook message_template_status_update: Meta solo dice el id de la
// plantilla, no la organización. El id lo dio Meta y es único en su WABA, así
// que identifica una sola fila activa; el WHERE sin organizationId es la
// excepción documentada en el encabezado. Devuelve cuántas filas cambió (0 si
// la plantilla no es de este CRM, o ya se borró).
export async function setWhatsappTemplateStatusByMetaId(
  metaTemplateId: string,
  estado: EstadoDePlantilla,
  db: Db = prisma,
) {
  const { count } = await db.whatsappTemplate.updateMany({
    where: { metaTemplateId, deletedAt: null },
    data: estado,
  });
  return count;
}

export function softDeleteWhatsappTemplate(organizationId: string, id: string, db: Db = prisma) {
  return db.whatsappTemplate.updateMany({
    where: { id, organizationId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}

// Lo que el worker de seguimientos necesita para mandar: nombre e idioma de la
// plantilla APROBADA y activa de la organización, o null si no tiene.
export function findApprovedWhatsappTemplate(organizationId: string, db: Db = prisma) {
  return db.whatsappTemplate.findFirst({
    where: { organizationId, deletedAt: null, status: WhatsappTemplateStatus.APPROVED },
    select: { name: true, language: true },
  });
}
