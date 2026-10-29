import { logger } from "../lib/logger";
import { prisma, type Db } from "../lib/prisma";
import { createActivity } from "../repositories/activity.repository";
import { findOldestActiveAdmin } from "../repositories/user.repository";

// ---------------------------------------------------------------------------
// LA TAREA DE UN ENVÍO QUE SE PERDIÓ.
//
// Cuando una cola agota sus reintentos (un seguimiento, un QR, un cupón, un
// recordatorio, un lead que no entra, una automatización), antes solo quedaba
// una línea en el log: el cliente se quedaba sin su mensaje y nadie del
// negocio se enteraba. Ahora la cola crea una tarea para una persona, mismo
// espíritu que la derivación de un turno fallido del agente.
//
// A QUIÉN. El primero que esté activo de: el asignado que propone la cola (la
// sede de una clínica, el encargado del vehículo), el dueño de la
// oportunidad, el dueño del contacto y, si no hay ninguno, el ADMIN activo más
// antiguo. Sin nadie a quién asignarla, se loguea y no se crea.
//
// ATADA A UN CLIENTE. La base exige que toda actividad tenga empresa,
// contacto u oportunidad (activities_related_entity_check). Un envío fallido
// sin contacto ni oportunidad vigentes no deja tarea: queda el log.
//
// SIN DUPLICADOS. Si ya hay una tarea abierta con el mismo asunto para el
// mismo contacto (o, sin contacto, la misma oportunidad), no se crea otra: si se
// vence el token de WhatsApp y fallan veinte envíos de un mismo tipo al mismo
// cliente, queda una sola tarea. El asunto lleva el nombre del cliente y el
// tipo de envío, así que dos clientes distintos sí reciben una cada uno.
//
// BEST-EFFORT. La tarea se crea DESPUÉS de marcar el envío como fallido, y si
// crearla falla (la base, justamente) queda el log como antes: el estado de la
// cola nunca depende de esto. Ver avisarColaFallida.
// ---------------------------------------------------------------------------

export interface AvisoDeColaFallida {
  organizationId: string;
  // Quién la recibe primero, si la cola sabe a quién le toca.
  asignado?: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
  // Solo para las tareas de clínica (R20: Recepción ve las de su sede).
  branchId?: string | null;
  // Recibe el nombre del contacto ("el cliente" si no tiene nombre).
  asunto: (cliente: string) => string;
  cuerpo: string;
}

export type ResultadoDelAviso =
  "CREADA" | "YA_ABIERTA" | "SIN_ASIGNADO" | "SIN_CONTACTO" | "SIN_RELACION";

export async function crearTareaPorColaFallida(
  aviso: AvisoDeColaFallida,
  db: Db = prisma,
): Promise<ResultadoDelAviso> {
  const { organizationId } = aviso;
  const contactId = aviso.contactId ?? null;

  let cliente = "el cliente";
  let duenoDelContacto: string | null = null;
  if (contactId) {
    const contacto = await db.contact.findFirst({
      where: { id: contactId, organizationId, deletedAt: null },
      select: { firstName: true, lastName: true, ownerId: true },
    });
    // Contacto borrado: no hay a quién llamar.
    if (!contacto) return "SIN_CONTACTO";
    cliente = `${contacto.firstName} ${contacto.lastName}`.trim() || cliente;
    duenoDelContacto = contacto.ownerId;
  }

  let opportunityId: string | null = null;
  let duenoDeLaOportunidad: string | null = null;
  if (aviso.opportunityId) {
    const oportunidad = await db.opportunity.findFirst({
      where: { id: aviso.opportunityId, organizationId, deletedAt: null },
      select: { id: true, ownerId: true },
    });
    opportunityId = oportunidad?.id ?? null;
    duenoDeLaOportunidad = oportunidad?.ownerId ?? null;
  }
  if (!contactId && !opportunityId) {
    logger.warn(
      { organizationId },
      "Envío fallido sin contacto ni oportunidad vigentes: no hay a qué atar la tarea",
    );
    return "SIN_RELACION";
  }

  const subject = aviso.asunto(cliente).slice(0, 255);
  const abierta = await db.activity.findFirst({
    where: {
      organizationId,
      ...(contactId ? { contactId } : { opportunityId }),
      type: "TASK",
      subject,
      completedAt: null,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (abierta) return "YA_ABIERTA";

  const asignado =
    (await primeroActivo(
      organizationId,
      [aviso.asignado ?? null, duenoDeLaOportunidad, duenoDelContacto],
      db,
    )) ?? (await findOldestActiveAdmin(organizationId, db))?.id;
  if (!asignado) {
    logger.warn(
      { organizationId, contactId },
      "Envío fallido sin nadie a quién asignarle la tarea (sin dueño ni ADMIN activo)",
    );
    return "SIN_ASIGNADO";
  }

  await createActivity(
    {
      organizationId,
      type: "TASK",
      authorId: asignado,
      assigneeId: asignado,
      companyId: null,
      contactId,
      opportunityId,
      ...(aviso.branchId ? { branchId: aviso.branchId } : {}),
      subject,
      body: aviso.cuerpo,
      dueDate: new Date(),
    },
    db,
  );
  return "CREADA";
}

async function primeroActivo(
  organizationId: string,
  candidatos: (string | null)[],
  db: Db,
): Promise<string | undefined> {
  const ids = candidatos.filter((id): id is string => id !== null);
  if (ids.length === 0) return undefined;
  const activos = await db.user.findMany({
    where: { id: { in: ids }, organizationId, isActive: true, deletedAt: null },
    select: { id: true },
  });
  const vigentes = new Set(activos.map((u) => u.id));
  return ids.find((id) => vigentes.has(id));
}

// Lo que llaman las colas: arma el aviso (puede leer la base) y crea la tarea,
// sin lanzar nunca. `cola` es solo para el log.
export async function avisarColaFallida(
  cola: string,
  armar: () => Promise<AvisoDeColaFallida | AvisoDeColaFallida[] | null>,
): Promise<void> {
  try {
    const avisos = await armar();
    for (const aviso of avisos === null ? [] : [avisos].flat()) {
      await crearTareaPorColaFallida(aviso);
    }
  } catch (err) {
    logger.error(
      { err, cola },
      "No se pudo crear la tarea de un envío fallido: requiere revisión manual",
    );
  }
}

export const CUERPO_DE_WHATSAPP_FALLIDO =
  "El WhatsApp automático no se pudo enviar después de varios intentos. Contactalo por otro medio.";
