import { ConnectionStatus } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// El WABA propio de una organización (migración 20261115120000,
// docs/whatsapp-alta-clinica.md). Una fila por organización; organizationId en
// cada WHERE, como el resto de los repositorios.
// ---------------------------------------------------------------------------

/** El WABA propio ACTIVE de la organización, o null (usa el global). */
export async function findWabaPropio(
  organizationId: string,
  db: Db = prisma,
): Promise<string | null> {
  const fila = await db.whatsappBusinessConnection.findFirst({
    where: { organizationId, status: ConnectionStatus.ACTIVE },
    select: { wabaId: true },
  });
  return fila?.wabaId ?? null;
}

export function findConexionDeWhatsapp(organizationId: string, db: Db = prisma) {
  return db.whatsappBusinessConnection.findFirst({
    where: { organizationId },
    select: { wabaId: true, status: true, createdAt: true, updatedAt: true },
  });
}

/** La organización que tiene ese WABA, de cualquier estado (el UNIQUE es
 *  global: un WABA es de una sola organización). */
export function findOrganizacionDelWaba(wabaId: string, db: Db = prisma) {
  return db.whatsappBusinessConnection.findFirst({
    where: { wabaId },
    select: { organizationId: true },
  });
}

/** Alta o reconexión: deja la fila ACTIVE con ese WABA. */
export function guardarConexionDeWhatsapp(organizationId: string, wabaId: string, db: Db = prisma) {
  return db.whatsappBusinessConnection.upsert({
    where: { organizationId },
    create: { organizationId, wabaId },
    update: { wabaId, status: ConnectionStatus.ACTIVE },
    select: { wabaId: true, status: true, createdAt: true, updatedAt: true },
  });
}

/** Baja: la fila queda REVOKED (la organización vuelve al WABA global). */
export function revocarConexionDeWhatsapp(organizationId: string, db: Db = prisma) {
  return db.whatsappBusinessConnection.updateMany({
    where: { organizationId },
    data: { status: ConnectionStatus.REVOKED },
  });
}
