import { prisma, type Db } from "../lib/prisma";

export function findOrganizationBySlug(slug: string, db: Db = prisma) {
  return db.organization.findUnique({ where: { slug } });
}

export function createOrganization(data: { name: string; slug: string }, db: Db = prisma) {
  return db.organization.create({ data });
}

// El listado de la plataforma (selector de organización de las pantallas de
// platform admin). Solo las vigentes, y solo lo que el selector muestra: el
// row tiene campos de billing que no salen por la API.
export function listActiveOrganizations(db: Db = prisma) {
  return db.organization.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
  });
}

// Punto de serialización único por organización: lockea su fila con
// SELECT ... FOR UPDATE para volver atómica cualquier operación cuya
// decisión dependa de un conteo agregado sobre sus Users (ver
// countActiveAdmins en user.repository.ts / user.service.ts). Sin default
// para `db` a propósito — correr esto fuera de una transacción no
// tiene efecto real (el lock se libera al instante), mismo criterio que
// shiftUpFrom/shiftDownAfter en stage.repository.ts.
// Verifica que el SELECT ... FOR UPDATE bloqueó una fila (B-17 de
// docs-privados/auditoria-2026-08-29.md (local, no está en GitHub)). Un SELECT que no encuentra nada no es un
// error para Postgres: devuelve cero filas, no bloquea nada, y la función
// retornaba igual — el caller seguía como si hubiera serializado. Ese camino
// es inalcanzable en operación normal (todos los callers validan existencia
// antes, y ninguna de estas entidades tiene hard delete por la API, así que
// la fila existe físicamente aunque esté soft-deleted — el SQL no filtra
// deleted_at a propósito): si se llega acá con cero filas es un bug del
// caller, y por eso es un Error común y no un AppError. Mismo criterio que
// reindexStages/shiftUpFrom/shiftDownAfter (B-12) y hardDeleteInvitation
// (B-13): el resultado de la escritura —acá, del lock— no se ignora.
//
// DEVUELVE EL PAÍS POR DEFECTO de los teléfonos (F5-b de
// docs-privados/prueba-en-vivo-2026-09-29.md (local, no está en GitHub)): el alta por WhatsApp y la promoción de
// la ingesta toman este lock justo antes de normalizar un teléfono, y leerlo
// en la misma fila bloqueada les ahorra una ida a la base. Los demás callers
// lo ignoran.
export async function lockOrganizationForUpdate(
  organizationId: string,
  db: Db,
): Promise<{ defaultPhoneCountryCode: string | null }> {
  const filas = await db.$queryRaw<{ default_phone_country_code: string | null }[]>`
    SELECT default_phone_country_code FROM organizations
    WHERE id = ${organizationId}::uuid FOR UPDATE`;
  if (filas.length === 0) {
    throw new Error(
      `lockOrganizationForUpdate: no existe la organización ${organizationId} — no se tomó ningún lock`,
    );
  }
  return { defaultPhoneCountryCode: filas[0].default_phone_country_code };
}

// F5-b: el país por defecto de los teléfonos, para el camino que normaliza
// ANTES de tomar el lock (POST/PATCH /api/contacts, que responde 400 sin
// tocar nada si el teléfono no se puede normalizar). Solo la columna.
export async function findDefaultPhoneCountryCode(
  organizationId: string,
  db: Db = prisma,
): Promise<string | null> {
  const fila = await db.organization.findUnique({
    where: { id: organizationId },
    select: { defaultPhoneCountryCode: true },
  });
  return fila?.defaultPhoneCountryCode ?? null;
}

// ---------------------------------------------------------------------------
// Configuración de moneda del módulo de stock de vehículos (Fase 2c). Las
// lecturas devuelven el row completo de Organization para el service; es el
// SERVICE el que recorta a la forma pública (ver organization.service.ts —
// el row tiene campos de billing/QR que nunca salen por la API).
// ---------------------------------------------------------------------------

export function findOrganizationById(id: string, db: Db = prisma) {
  return db.organization.findUnique({ where: { id } });
}

export function updateOrganizationSettings(
  id: string,
  data: {
    preferredCurrency?: string | null;
    alternateCurrency?: string | null;
    defaultPhoneCountryCode?: string | null;
    timezone?: string;
  },
  db: Db = prisma,
) {
  return db.organization.update({ where: { id }, data });
}

// Las monedas configuradas de TODAS las organizaciones — lo que el worker de
// cotizaciones tiene que buscar. Sin deduplicar a propósito: eso es del
// caller (fetchAndStoreExchangeRates), que además excluye USD.
export function findOrganizationsWithConfiguredCurrency(db: Db = prisma) {
  return db.organization.findMany({
    where: {
      OR: [{ preferredCurrency: { not: null } }, { alternateCurrency: { not: null } }],
    },
    select: { preferredCurrency: true, alternateCurrency: true },
  });
}

// La cotización MÁS RECIENTE (mayor rateDate) por cada moneda destino, base
// USD. `distinct` + `orderBy` es el idiom de Prisma para "última fila por
// grupo": el orderBy tiene que empezar por el campo del distinct, y dentro de
// cada grupo la primera fila que ve es la de rateDate más alto. Devuelve []
// sin consultar si no hay monedas que buscar.
export function findLatestExchangeRates(targetCurrencies: string[], db: Db = prisma) {
  if (targetCurrencies.length === 0) {
    return Promise.resolve([]);
  }
  return db.exchangeRate.findMany({
    where: { baseCurrency: "USD", targetCurrency: { in: targetCurrencies } },
    distinct: ["targetCurrency"],
    orderBy: [{ targetCurrency: "asc" }, { rateDate: "desc" }],
  });
}
