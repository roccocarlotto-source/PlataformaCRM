import type { DiscountVoucher, MessageDeliveryStatus } from "@prisma/client";
import { DateTime } from "luxon";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  findAgentByWhatsappPhoneNumberId,
  findBranchWhatsappPhoneNumberId,
} from "../repositories/agent.repository";
import { findBranchById } from "../repositories/branch.repository";
import { findContactById } from "../repositories/contact.repository";
import { findOpenConversation } from "../repositories/conversation.repository";
import { findDiscountVoucherById } from "../repositories/discountVoucher.repository";
import { findLastInboundAt } from "../repositories/message.repository";
import { findOpportunityById } from "../repositories/opportunity.repository";
import type { RoleName } from "../types/auth";
import { AppError } from "../utils/AppError";
import { buildVoucherPublicUrl } from "../utils/voucherPublicUrl";
import { finDeLaVentanaDeWhatsapp, ventanaDeWhatsappAbierta } from "../utils/ventanaDeWhatsapp";
import { MAX_EXPIRES_IN_DAYS } from "./automationActions/sendDiscountVoucherFollowup";
import {
  depsDeRespuestaHumanaReales,
  enviarMensajeDelEquipo,
  type DepsDeRespuestaHumana,
} from "./conversationReply.service";
import { MAX_LABEL_LENGTH, estaVencido } from "./discountVoucher.service";

// ---------------------------------------------------------------------------
// "Crear cupón" a mano, desde la ficha del contacto o de la oportunidad. Hasta
// acá un cupón solo salía de la regla "Oportunidad ganada -> Enviar cupón de
// descuento" (discountVoucherFollowUpWorker.ts). Tres operaciones:
//
//   - crearCuponManual: el alta. Descuento (texto), vence a los N días y
//     sucursal, con las MISMAS validaciones que la regla (configDeCuponSchema:
//     1..200 caracteres, 1..365 días, sucursal de la organización).
//   - listarCuponesDelContacto: todos los cupones del contacto, de regla y
//     manuales, con su estado (vigente, canjeado o vencido).
//   - estado / enviar por WhatsApp: TEXTO LIBRE con el link, desde el número
//     de la sucursal elegida, solo con la ventana de 24 h abierta. No hay
//     plantilla para envíos manuales: fuera de la ventana, no se manda. Queda
//     en el hilo de la conversación como mensaje de quien lo mandó
//     (enviarMensajeDelEquipo), sin tomar la conversación.
//
// PERMISOS: ADMIN siempre. Un USER, solo sobre lo que tiene asignado: la
// oportunidad (ownerId) si el cupón es de una venta, el contacto (ownerId) si
// no. El mismo criterio que "Responder" (vendedor asignado o ADMIN). Listar
// es abierto a cualquiera de la organización, como leer el contacto.
// ---------------------------------------------------------------------------

export interface Actor {
  userId: string;
  role: RoleName;
}

export const MENSAJE_SIN_PERMISO_CUPON =
  "Solo un administrador o el vendedor asignado pueden crear o mandar cupones de este cliente";
export const MOTIVO_SIN_TELEFONO = "El contacto no tiene un teléfono cargado";
export const MOTIVO_SIN_NUMERO =
  "La sucursal del cupón no tiene un número de WhatsApp conectado (ningún agente de la sucursal tiene número)";
export const MOTIVO_SIN_VENTANA =
  "El cliente no le escribió a este número en las últimas 24 h: WhatsApp solo permite plantillas aprobadas, y no hay una para envíos manuales";
export const MOTIVO_SIN_SUCURSAL = "Este cupón lo emitió una regla: se manda solo con su plantilla";
export const MOTIVO_CANJEADO = "El cupón ya fue canjeado";
export const MOTIVO_VENCIDO = "El cupón venció";

export const crearCuponManualSchema = z
  .object({
    contactId: z.string().uuid("contactId inválido").optional(),
    opportunityId: z.string().uuid("opportunityId inválido").optional(),
    label: z
      .string({ required_error: "El descuento es requerido" })
      .trim()
      .min(1, "El descuento es requerido")
      .max(MAX_LABEL_LENGTH, `El descuento no puede superar los ${MAX_LABEL_LENGTH} caracteres`),
    expiresInDays: z
      .number({
        required_error: "Los días de vigencia son requeridos",
        invalid_type_error: "Los días de vigencia tienen que ser un número entero",
      })
      .int("Los días de vigencia tienen que ser un número entero")
      .min(1, "El cupón tiene que durar al menos 1 día")
      .max(MAX_EXPIRES_IN_DAYS, `El cupón no puede durar más de ${MAX_EXPIRES_IN_DAYS} días`),
    branchId: z.string({ required_error: "La sucursal es requerida" }).uuid("branchId inválido"),
  })
  .refine((v) => v.contactId !== undefined || v.opportunityId !== undefined, {
    message: "Hay que indicar el contacto o la oportunidad",
  });

export type CrearCuponManualInput = z.infer<typeof crearCuponManualSchema>;

export type EstadoDelCupon = "ACTIVE" | "CONSUMED" | "EXPIRED";

// Lo que ve la pantalla de un cupón: el estado ya derivado (vencido no se
// guarda) y el link público, que es lo que codifica su QR.
export interface CuponParaLaPantalla {
  id: string;
  label: string;
  status: EstadoDelCupon;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
  contactId: string;
  opportunityId: string | null;
  branchId: string | null;
  origin: "AUTOMATION" | "MANUAL";
  publicUrl: string;
}

const MS_POR_DIA = 24 * 60 * 60 * 1000;

// Pura: la proyección de una fila.
export function cuponParaLaPantalla(
  cupon: DiscountVoucher,
  ahora: Date = new Date(),
): CuponParaLaPantalla {
  return {
    id: cupon.id,
    label: cupon.label,
    status: estaVencido(cupon, ahora) ? "EXPIRED" : cupon.status,
    expiresAt: cupon.expiresAt.toISOString(),
    consumedAt: cupon.consumedAt?.toISOString() ?? null,
    createdAt: cupon.createdAt.toISOString(),
    contactId: cupon.contactId,
    opportunityId: cupon.opportunityId,
    branchId: cupon.branchId,
    origin: cupon.automationId ? "AUTOMATION" : "MANUAL",
    publicUrl: buildVoucherPublicUrl(cupon.id),
  };
}

// Pura: ¿puede esta persona crear o mandar un cupón de este cliente?
export function puedeGestionarCupon(
  actor: Actor,
  duenio: { oportunidad: { ownerId: string } | null; contacto: { ownerId: string | null } },
): boolean {
  if (actor.role === "ADMIN") {
    return true;
  }
  return duenio.oportunidad
    ? duenio.oportunidad.ownerId === actor.userId
    : duenio.contacto.ownerId === actor.userId;
}

async function leerContacto(organizationId: string, contactId: string) {
  const contacto = await findContactById(contactId, organizationId);
  if (!contacto) {
    throw new AppError("Contacto no encontrado", 404);
  }
  return contacto;
}

export async function crearCuponManual(
  actor: Actor,
  organizationId: string,
  input: CrearCuponManualInput,
  ahora: Date = new Date(),
): Promise<CuponParaLaPantalla> {
  let contactId = input.contactId;
  let oportunidad: { id: string; ownerId: string } | null = null;

  if (input.opportunityId) {
    const fila = await findOpportunityById(input.opportunityId, organizationId);
    if (!fila) {
      throw new AppError("Oportunidad no encontrada", 404);
    }
    if (!fila.contactId) {
      throw new AppError(
        "La oportunidad no tiene un contacto: el cupón es de una persona, cargale uno primero",
        400,
      );
    }
    if (contactId && contactId !== fila.contactId) {
      throw new AppError("El contacto no es el de la oportunidad", 400);
    }
    contactId = fila.contactId;
    oportunidad = { id: fila.id, ownerId: fila.ownerId };
  }

  const contacto = await leerContacto(organizationId, contactId!);
  if (!puedeGestionarCupon(actor, { oportunidad, contacto })) {
    throw new AppError(MENSAJE_SIN_PERMISO_CUPON, 403);
  }

  const sucursal = await findBranchById(input.branchId, organizationId);
  if (!sucursal) {
    throw new AppError("La sucursal no existe o está borrada", 400);
  }

  const cupon = await prisma.discountVoucher.create({
    data: {
      organizationId,
      contactId: contacto.id,
      opportunityId: oportunidad?.id ?? null,
      automationId: null,
      createdByUserId: actor.userId,
      branchId: sucursal.id,
      label: input.label,
      expiresAt: new Date(ahora.getTime() + input.expiresInDays * MS_POR_DIA),
    },
  });
  return cuponParaLaPantalla(cupon, ahora);
}

export async function listarCuponesDelContacto(
  organizationId: string,
  contactId: string,
  ahora: Date = new Date(),
): Promise<CuponParaLaPantalla[]> {
  await leerContacto(organizationId, contactId);
  const cupones = await prisma.discountVoucher.findMany({
    where: { organizationId, contactId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  });
  return cupones.map((c) => cuponParaLaPantalla(c, ahora));
}

async function leerCupon(organizationId: string, id: string) {
  const cupon = await findDiscountVoucherById(id, organizationId);
  if (!cupon) {
    throw new AppError("Cupón no encontrado", 404);
  }
  return cupon;
}

export type EstadoDelEnvio =
  | { disponible: true; conversationId: string; motivo: null }
  | { disponible: false; conversationId: null; motivo: string };

function noDisponible(motivo: string): EstadoDelEnvio {
  return { disponible: false, conversationId: null, motivo };
}

// ¿Se puede mandar este cupón por WhatsApp ahora? Y si se puede, a qué
// conversación va: la abierta del contacto con el agente dueño del número de
// la sucursal del cupón. La ventana de 24 h se cuenta en ESA conversación,
// porque es por número del negocio y cliente.
async function estadoDelEnvio(cupon: DiscountVoucher, ahora: Date): Promise<EstadoDelEnvio> {
  if (cupon.status === "CONSUMED") return noDisponible(MOTIVO_CANJEADO);
  if (estaVencido(cupon, ahora)) return noDisponible(MOTIVO_VENCIDO);
  if (!cupon.branchId) return noDisponible(MOTIVO_SIN_SUCURSAL);

  const contacto = await findContactById(cupon.contactId, cupon.organizationId);
  if (!contacto?.phone?.trim()) return noDisponible(MOTIVO_SIN_TELEFONO);

  const numero = await findBranchWhatsappPhoneNumberId(cupon.organizationId, cupon.branchId);
  const agente = numero ? await findAgentByWhatsappPhoneNumberId(numero) : null;
  if (!agente || agente.organizationId !== cupon.organizationId) {
    return noDisponible(MOTIVO_SIN_NUMERO);
  }

  const conversacion = await findOpenConversation(
    cupon.organizationId,
    agente.id,
    cupon.contactId,
    "WHATSAPP",
  );
  const fin = conversacion
    ? finDeLaVentanaDeWhatsapp(await findLastInboundAt(conversacion.id, cupon.organizationId))
    : null;
  if (!conversacion || !ventanaDeWhatsappAbierta(fin, ahora)) {
    return noDisponible(MOTIVO_SIN_VENTANA);
  }
  return { disponible: true, conversationId: conversacion.id, motivo: null };
}

export async function estadoDelEnvioDelCupon(
  organizationId: string,
  id: string,
  ahora: Date = new Date(),
): Promise<EstadoDelEnvio> {
  return estadoDelEnvio(await leerCupon(organizationId, id), ahora);
}

// Pura: el texto que le llega al cliente. La fecha, en la zona de la sucursal.
export function textoDelCupon(datos: {
  nombre: string;
  label: string;
  expiresAt: Date;
  zona: string;
  link: string;
}): string {
  const fecha = DateTime.fromJSDate(datos.expiresAt).setZone(datos.zona).toFormat("dd/LL/yyyy");
  const saludo = datos.nombre.trim() ? `¡Hola ${datos.nombre.trim()}!` : "¡Hola!";
  return `${saludo} Te dejamos tu cupón: ${datos.label}. Vale hasta el ${fecha}. Mostrá este link en la sucursal: ${datos.link}`;
}

export interface ResultadoDelEnvio {
  conversationId: string;
  deliveryStatus: MessageDeliveryStatus | null;
  deliveryError: string | null;
}

export async function enviarCuponPorWhatsapp(
  actor: Actor,
  organizationId: string,
  id: string,
  deps: DepsDeRespuestaHumana = depsDeRespuestaHumanaReales,
  ahora: Date = new Date(),
): Promise<ResultadoDelEnvio> {
  const cupon = await leerCupon(organizationId, id);
  const contacto = await leerContacto(organizationId, cupon.contactId);
  const oportunidad = cupon.opportunityId
    ? await findOpportunityById(cupon.opportunityId, organizationId)
    : null;
  if (!puedeGestionarCupon(actor, { oportunidad, contacto })) {
    throw new AppError(MENSAJE_SIN_PERMISO_CUPON, 403);
  }

  const estado = await estadoDelEnvio(cupon, ahora);
  if (!estado.disponible) {
    throw new AppError(estado.motivo, 409);
  }
  const sucursal = await findBranchById(cupon.branchId!, organizationId);
  const texto = textoDelCupon({
    nombre: contacto.firstName,
    label: cupon.label,
    expiresAt: cupon.expiresAt,
    zona: sucursal?.timezone ?? "UTC",
    link: buildVoucherPublicUrl(cupon.id),
  });
  const mensaje = await enviarMensajeDelEquipo(
    actor.userId,
    organizationId,
    estado.conversationId,
    texto,
    deps,
  );
  return {
    conversationId: estado.conversationId,
    deliveryStatus: mensaje.deliveryStatus,
    deliveryError: mensaje.deliveryError,
  };
}
