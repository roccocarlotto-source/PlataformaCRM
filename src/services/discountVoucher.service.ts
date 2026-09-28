import type { Contact, DiscountVoucher, Opportunity } from "@prisma/client";
import { findContactById } from "../repositories/contact.repository";
import {
  consumirDiscountVoucher,
  crearDiscountVoucherRow,
  findDiscountVoucherById,
  findDiscountVoucherPublicRow,
  type CrearDiscountVoucherData,
  type DiscountVoucherPublicRow,
} from "../repositories/discountVoucher.repository";
import { findOpportunityById } from "../repositories/opportunity.repository";
import { AppError } from "../utils/AppError";
import { isUuid } from "./qrPublic.service";

// ---------------------------------------------------------------------------
// Cupón de descuento de un solo uso (ítem 176 de
// docs/frontend-cambios-pendientes.md). Tres operaciones:
//
//   - crearDiscountVoucher: la emisión. Sin HTTP propio en esta v1: la llama
//     la acción de automatización del ítem 177, igual que sendQrFollowup
//     llama a agendarQrFollowUp. La idempotencia por (regla, oportunidad) NO
//     vive acá: la va a resolver la tabla de agendado de ese ítem.
//   - canjearDiscountVoucher: la única escritura sobre un cupón emitido. La
//     dispara un empleado logueado escaneando el QR desde el CRM (ítem 178).
//   - getDiscountVoucherPublicState: lo que ve el cliente al abrir su link.
//     Solo lectura: abrirlo no lo consume, las veces que sea.
//
// NO ES EL QR DE UN SOLO USO QUE SE ELIMINÓ EL 04/09 (docs/qr-integration.md,
// "Qué se elimina"): entidad separada, ver el modelo en schema.prisma.
//
// "VENCIDO" SE DERIVA, NO SE GUARDA: un ACTIVE con expiresAt pasado. Sin cron
// ni columna: una comparación de fechas al leer. El canje lo rechaza y lo deja
// como estaba — un vencido nunca pasa a CONSUMED.
// ---------------------------------------------------------------------------

export const CUPON_NO_ENCONTRADO = "El cupón no existe o no pertenece a tu organización";
export const CUPON_YA_CANJEADO = "Este cupón ya fue canjeado";
export const CUPON_VENCIDO = "Este cupón venció";

// El mismo tope que la columna (VARCHAR(200)): pasarlo daría un 500 de Prisma.
export const MAX_LABEL_LENGTH = 200;

// Inyectables para el test unitario, mismo patrón que
// DependenciasDelSeguimientoQr en automationActions/sendQrFollowup.ts. Firmas
// con Promise plano: los repositorios devuelven el PrismaPromise del cliente,
// que un doble de test no puede imitar.
export interface DependenciasDeCupones {
  leerOportunidad: (id: string, organizationId: string) => Promise<Opportunity | null>;
  leerContacto: (id: string, organizationId: string) => Promise<Contact | null>;
  insertar: (data: CrearDiscountVoucherData) => Promise<DiscountVoucher>;
  leerCupon: (id: string, organizationId: string) => Promise<DiscountVoucher | null>;
  // La fila ya consumida, o null si el UPDATE no afectó ninguna.
  consumir: (
    id: string,
    organizationId: string,
    userId: string,
    ahora: Date,
  ) => Promise<DiscountVoucher | null>;
  leerCuponPublico: (id: string) => Promise<DiscountVoucherPublicRow | null>;
  ahora: () => Date;
}

const dependenciasReales: DependenciasDeCupones = {
  leerOportunidad: (id, organizationId) => findOpportunityById(id, organizationId),
  leerContacto: (id, organizationId) => findContactById(id, organizationId),
  insertar: (data) => crearDiscountVoucherRow(data),
  leerCupon: (id, organizationId) => findDiscountVoucherById(id, organizationId),
  consumir: (id, organizationId, userId, ahora) =>
    consumirDiscountVoucher(id, organizationId, userId, ahora),
  leerCuponPublico: (id) => findDiscountVoucherPublicRow(id),
  ahora: () => new Date(),
};

// Exportada para probarla sin base: el único lugar que decide "vencido".
export function estaVencido(cupon: { status: string; expiresAt: Date }, ahora: Date): boolean {
  return cupon.status === "ACTIVE" && cupon.expiresAt.getTime() <= ahora.getTime();
}

export interface CrearDiscountVoucherInput {
  automationId: string;
  opportunityId: string;
  contactId: string;
  label: string;
  expiresAt: Date;
}

export async function crearDiscountVoucher(
  organizationId: string,
  input: CrearDiscountVoucherInput,
  deps: DependenciasDeCupones = dependenciasReales,
): Promise<DiscountVoucher> {
  const label = input.label.trim();
  if (label.length === 0 || label.length > MAX_LABEL_LENGTH) {
    throw new AppError(
      `El texto del cupón es requerido y no puede superar los ${MAX_LABEL_LENGTH} caracteres`,
      400,
    );
  }

  // Mismo criterio y mismos mensajes que validateContactId de
  // opportunity.service.ts: "de otra organización", "no existe" y "borrada"
  // son la misma respuesta. Las FKs compuestas lo frenarían igual, pero como
  // un 500; esto lo convierte en un error legible para quien configuró la
  // regla.
  const oportunidad = await deps.leerOportunidad(input.opportunityId, organizationId);
  if (!oportunidad) {
    throw new AppError(
      "El opportunityId indicado no existe, no pertenece a tu organización, o está eliminado",
      400,
    );
  }
  const contacto = await deps.leerContacto(input.contactId, organizationId);
  if (!contacto) {
    throw new AppError(
      "El contactId indicado no existe, no pertenece a tu organización, o está eliminado",
      400,
    );
  }

  return deps.insertar({
    organizationId,
    automationId: input.automationId,
    opportunityId: input.opportunityId,
    contactId: input.contactId,
    label,
    expiresAt: input.expiresAt,
  });
}

// El 409 que corresponde a un cupón que no se puede canjear, o null si se
// puede. Compartido entre el chequeo previo y la relectura después de perder
// la carrera, para que las dos digan exactamente lo mismo.
function conflictoDeCanje(cupon: DiscountVoucher, ahora: Date): AppError | null {
  if (cupon.status === "CONSUMED") {
    return new AppError(CUPON_YA_CANJEADO, 409, true, {
      consumedAt: cupon.consumedAt?.toISOString() ?? null,
    });
  }
  if (estaVencido(cupon, ahora)) {
    return new AppError(CUPON_VENCIDO, 409, true, {
      expiresAt: cupon.expiresAt.toISOString(),
    });
  }
  return null;
}

export async function canjearDiscountVoucher(
  organizationId: string,
  id: string,
  redeemedByUserId: string,
  deps: DependenciasDeCupones = dependenciasReales,
): Promise<DiscountVoucher> {
  const ahora = deps.ahora();

  const cupon = await deps.leerCupon(id, organizationId);
  if (!cupon) {
    throw new AppError(CUPON_NO_ENCONTRADO, 404);
  }
  const conflicto = conflictoDeCanje(cupon, ahora);
  if (conflicto) {
    throw conflicto;
  }

  // La escritura atómica (ver consumirDiscountVoucher). El chequeo de arriba
  // es solo para dar el mensaje correcto sin escribir; lo que decide es el
  // WHERE status = 'ACTIVE' de este UPDATE.
  const consumido = await deps.consumir(id, organizationId, redeemedByUserId, ahora);
  if (consumido) {
    return consumido;
  }

  // 0 filas: alguien lo canjeó (o venció) entre la lectura y el UPDATE. Se
  // relee para devolver el 409 que corresponde — nunca un 500.
  const actual = await deps.leerCupon(id, organizationId);
  if (!actual) {
    throw new AppError(CUPON_NO_ENCONTRADO, 404);
  }
  throw conflictoDeCanje(actual, ahora) ?? new AppError(CUPON_YA_CANJEADO, 409);
}

// "EXPIRED" es un valor de la RESPUESTA, derivado — no existe en la base. Así
// el frontend del ítem 178 no rehace la cuenta de fechas.
export type DiscountVoucherPublicStatus = "ACTIVE" | "CONSUMED" | "EXPIRED";

export interface DiscountVoucherPublicState {
  status: DiscountVoucherPublicStatus;
  label: string;
}

// SIN organizationId: el cliente abre su link sin sesión (mismo criterio que
// getQrPublicState). NUNCA escribe, bajo ningún input — abrir el link, o que
// lo abra el bot de preview de WhatsApp, no puede consumir el cupón. Un id
// malformado es "no encontrado" antes de tocar la base, igual que allá.
export async function getDiscountVoucherPublicState(
  id: string,
  deps: DependenciasDeCupones = dependenciasReales,
): Promise<DiscountVoucherPublicState | null> {
  if (!isUuid(id)) {
    return null;
  }
  const fila = await deps.leerCuponPublico(id);
  if (!fila) {
    return null;
  }
  const status: DiscountVoucherPublicStatus = estaVencido(fila, deps.ahora())
    ? "EXPIRED"
    : fila.status;
  return { status, label: fila.label };
}
