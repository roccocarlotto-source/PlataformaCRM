import type { DiscountVoucher, DiscountVoucherStatus } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Cupones de descuento de un solo uso (ítem 176 de
// docs/frontend-cambios-pendientes.md). Ver el modelo DiscountVoucher en
// schema.prisma y las reglas de negocio en discountVoucher.service.ts.
// ---------------------------------------------------------------------------

export interface CrearDiscountVoucherData {
  organizationId: string;
  automationId: string;
  opportunityId: string;
  contactId: string;
  label: string;
  expiresAt: Date;
}

export function crearDiscountVoucherRow(data: CrearDiscountVoucherData, db: Db = prisma) {
  return db.discountVoucher.create({ data });
}

export function findDiscountVoucherById(id: string, organizationId: string, db: Db = prisma) {
  return db.discountVoucher.findFirst({ where: { id, organizationId } });
}

// Lo único que el GET público necesita, SIN organizationId (el cliente no
// tiene sesión; mismo criterio que findQrCodePublicState). Nada del contacto
// ni de la oportunidad sale de acá.
export interface DiscountVoucherPublicRow {
  status: DiscountVoucherStatus;
  label: string;
  expiresAt: Date;
}

export function findDiscountVoucherPublicRow(
  id: string,
  db: Db = prisma,
): Promise<DiscountVoucherPublicRow | null> {
  return db.discountVoucher.findUnique({
    where: { id },
    select: { status: true, label: true, expiresAt: true },
  });
}

// LA TRANSICIÓN ACTIVE -> CONSUMED, en UNA sentencia. El `status: ACTIVE` del
// WHERE es lo que la hace atómica: dos canjes simultáneos del mismo id
// compiten por la misma fila, Postgres serializa los dos UPDATE, y el segundo
// ya no la encuentra en ACTIVE — afecta 0 filas. El `expiresAt > ahora` cierra
// además la ventana de un cupón que vence entre la lectura previa del service
// y esta escritura. Devuelve la fila actualizada, o null si no se tocó nada
// (el service relee para decir por qué).
export async function consumirDiscountVoucher(
  id: string,
  organizationId: string,
  consumedByUserId: string,
  ahora: Date,
  db: Db = prisma,
): Promise<DiscountVoucher | null> {
  const { count } = await db.discountVoucher.updateMany({
    where: { id, organizationId, status: "ACTIVE", expiresAt: { gt: ahora } },
    data: { status: "CONSUMED", consumedAt: ahora, consumedByUserId },
  });
  if (count === 0) {
    return null;
  }
  return db.discountVoucher.findFirst({ where: { id, organizationId } });
}

// Los cupones de un contacto que el agente de IA recibe como contexto en cada
// turno (bloqueDeCupones en agentOrchestration.service.ts): los más nuevos
// primero, con tope, y solo lo que el bloque muestra. Sin el id ni el link: el
// agente no tiene nada que hacer con ellos.
export function findVouchersDelContacto(
  organizationId: string,
  contactId: string,
  take: number,
  db: Db = prisma,
) {
  return db.discountVoucher.findMany({
    where: { organizationId, contactId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: { label: true, status: true, expiresAt: true },
  });
}
