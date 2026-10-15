import type { ServiceOrderStatus } from "@prisma/client";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { createActivity } from "../../repositories/activity.repository";
import { findLastInboundAt } from "../../repositories/message.repository";
import { AppError } from "../../utils/AppError";
import { finDeLaVentanaDeWhatsapp, ventanaDeWhatsappAbierta } from "../../utils/ventanaDeWhatsapp";
import { textoDelVehiculo } from "../recordatorio/config";
import { tieneElModulo } from "../recordatorio/repository";

// ---------------------------------------------------------------------------
// Avisar al cliente (docs/servicios.md §8.1, S12). Lo hace una persona, desde
// la ficha de la orden:
//
//   - El texto sugerido por estado: fijo en código, corto y con voseo
//     (decisión de Rocco, 2026-10-15: editarlo en Configuración, cuando se pida).
//   - Con la conversación de WhatsApp del cliente y la ventana de 24 h abierta,
//     se abre la conversación con el texto puesto; al mandarlo, la orden
//     registra el aviso sola (registrarAvisoDesdeLaConversacion).
//   - Siempre se puede "Marcar como avisado", eligiendo el medio.
//
// Un aviso es una NOTA cerrada en el contacto, ligada a la orden por
// activities.source_service_order_id (S6). El único parcial de esa columna es
// por (regla, orden), y una nota no tiene regla: no choca.
// ---------------------------------------------------------------------------

export const MEDIOS_DE_AVISO = ["TELEFONO", "WHATSAPP", "EN_PERSONA"] as const;
export type MedioDeAviso = (typeof MEDIOS_DE_AVISO)[number];

const ETIQUETA_DEL_MEDIO: Record<MedioDeAviso, string> = {
  TELEFONO: "Teléfono",
  WHATSAPP: "WhatsApp",
  EN_PERSONA: "En persona",
};

const ETIQUETA_DEL_ESTADO: Partial<Record<ServiceOrderStatus, string>> = {
  RECIBIDO: "Recibido",
  ESPERANDO_APROBACION: "Esperando aprobación",
  LISTO_PARA_RETIRAR: "Listo para retirar",
};

/** Los textos sugeridos, por estado. Solo en estos estados se ofrece avisar. */
export const TEXTO_SUGERIDO: Partial<Record<ServiceOrderStatus, string>> = {
  RECIBIDO:
    "Hola {nombre}, ya recibimos tu {vehiculo} en {sucursal}. Te avisamos cuando esté listo.",
  ESPERANDO_APROBACION:
    "Hola {nombre}, revisando tu {vehiculo} encontramos algo más para hacer. ¿Te llamamos para contarte el presupuesto?",
  LISTO_PARA_RETIRAR:
    "Hola {nombre}, tu {vehiculo} ya está listo. Podés pasar a retirarlo por {sucursal}.",
};

/** El texto de un estado con los datos de la orden. Null si no se avisa. */
export function textoParaAvisar(
  estado: ServiceOrderStatus,
  datos: { nombre: string; vehiculo: string; sucursal: string },
): string | null {
  const plantilla = TEXTO_SUGERIDO[estado];
  if (!plantilla) return null;
  return plantilla
    .replace("{nombre}", datos.nombre)
    .replace("{vehiculo}", datos.vehiculo)
    .replace("{sucursal}", datos.sucursal);
}

export interface AvisoDeLaOrden {
  id: string;
  cuando: string;
  persona: string;
  detalle: string;
}

export interface AvisosDeLaOrden {
  // Null si la orden no está en un estado que se avisa.
  sugerencia: string | null;
  // La conversación de WhatsApp más reciente del cliente, si tiene.
  conversacion: { id: string; ventanaAbierta: boolean } | null;
  telefono: string | null;
  avisos: AvisoDeLaOrden[];
}

async function ordenParaAvisar(organizationId: string, serviceOrderId: string) {
  const orden = await prisma.serviceOrder.findFirst({
    where: { id: serviceOrderId, organizationId },
    select: {
      id: true,
      status: true,
      contactId: true,
      contact: { select: { firstName: true, phone: true } },
      branch: { select: { name: true } },
      customerVehicle: { select: { make: true, model: true, licensePlate: true } },
    },
  });
  if (!orden) throw new AppError("Orden no encontrada", 404);
  return orden;
}

async function avisosRegistrados(organizationId: string, serviceOrderId: string) {
  const notas = await prisma.activity.findMany({
    where: { organizationId, sourceServiceOrderId: serviceOrderId, type: "NOTE", deletedAt: null },
    select: { id: true, subject: true, createdAt: true, author: { select: { fullName: true } } },
    orderBy: { createdAt: "desc" },
  });
  return notas.map((n) => ({
    id: n.id,
    cuando: n.createdAt.toISOString(),
    persona: n.author.fullName,
    detalle: n.subject,
  }));
}

export async function obtenerAvisos(
  organizationId: string,
  serviceOrderId: string,
  ahora: Date = new Date(),
): Promise<AvisosDeLaOrden> {
  const orden = await ordenParaAvisar(organizationId, serviceOrderId);
  const conversacion = await prisma.conversation.findFirst({
    where: { organizationId, contactId: orden.contactId, channel: "WHATSAPP" },
    select: { id: true, status: true },
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  });
  let ventanaAbierta = false;
  if (conversacion && conversacion.status !== "CLOSED") {
    const fin = finDeLaVentanaDeWhatsapp(await findLastInboundAt(conversacion.id, organizationId));
    ventanaAbierta = ventanaDeWhatsappAbierta(fin, ahora);
  }
  return {
    sugerencia: textoParaAvisar(orden.status, {
      nombre: orden.contact.firstName.trim() || "",
      vehiculo: textoDelVehiculo(orden.customerVehicle),
      sucursal: orden.branch.name,
    }),
    conversacion: conversacion ? { id: conversacion.id, ventanaAbierta } : null,
    telefono: orden.contact.phone,
    avisos: await avisosRegistrados(organizationId, serviceOrderId),
  };
}

/** "Marcar como avisado" (y el registro automático del WhatsApp). */
export async function registrarAviso(
  organizationId: string,
  userId: string,
  serviceOrderId: string,
  medio: MedioDeAviso,
  ahora: Date = new Date(),
): Promise<AvisoDeLaOrden[]> {
  const orden = await ordenParaAvisar(organizationId, serviceOrderId);
  const estado = ETIQUETA_DEL_ESTADO[orden.status];
  await createActivity({
    organizationId,
    type: "NOTE",
    authorId: userId,
    assigneeId: null,
    companyId: null,
    contactId: orden.contactId,
    opportunityId: null,
    subject: `Aviso al cliente (${ETIQUETA_DEL_MEDIO[medio]})${estado ? `: ${estado}` : ""}`,
    // Es un registro, no algo pendiente.
    completedAt: ahora,
    sourceServiceOrderId: serviceOrderId,
  });
  return avisosRegistrados(organizationId, serviceOrderId);
}

/** Lo llama el envío de respuestas de la conversación cuando la persona la
 *  abrió desde la orden (POST /conversations/:id/reply con serviceOrderId).
 *  NUNCA falla el envío: el mensaje ya salió. Solo registra si la
 *  organización tiene el módulo y la orden es del mismo cliente que la
 *  conversación. */
export async function registrarAvisoDesdeLaConversacion(
  organizationId: string,
  userId: string,
  serviceOrderId: string,
  conversationContactId: string,
): Promise<void> {
  try {
    if (!(await tieneElModulo(organizationId))) return;
    const orden = await prisma.serviceOrder.findFirst({
      where: { id: serviceOrderId, organizationId },
      select: { contactId: true },
    });
    if (!orden || orden.contactId !== conversationContactId) return;
    await registrarAviso(organizationId, userId, serviceOrderId, "WHATSAPP");
  } catch (err) {
    logger.error(
      { err, organizationId, serviceOrderId },
      "No se pudo registrar el aviso al cliente en la orden; el mensaje ya se mandó",
    );
  }
}
