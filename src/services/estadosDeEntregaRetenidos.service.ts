import { logger } from "../lib/logger";
import { applyDeliveryStatusByExternalId } from "../repositories/message.repository";

// ---------------------------------------------------------------------------
// Estados de entrega de WhatsApp que llegan ANTES que su wamid — D-15 de
// docs-privados/auditoria-2026-09-30-corta.md (local, no está en GitHub).
//
// El wamid de un saliente se guarda recién cuando Meta acepta el envío: en el
// agente, milisegundos después (markMessageDelivery); en las plantillas de QR
// y cupón, después de marcar el seguimiento, buscar el agente y abrir la
// conversación (registrarSalienteDeAutomatizacion). Un `sent` o `delivered`
// que el webhook recibe en ese intervalo actualizaba 0 filas y se perdía.
//
// Ahora el webhook RETIENE ese estado acá y lo aplica cuando alguien guarda el
// wamid (aplicarEstadosRetenidos). EN MEMORIA, decisión de Rocco: el backend es
// un solo proceso y la ventana es de segundos; lo retenido se pierde si el
// proceso reinicia en ese rato. Persistirlo exigía una tabla (migración).
//
// Dos límites, para que no crezca sin control con estados de wamids que nunca
// se van a guardar (mensajes que no salieron de este CRM, por ejemplo los que
// alguien manda desde la app de WhatsApp Business):
//   - VENCIMIENTO: un wamid que no aparece en RETENCION_MS se descarta.
//   - TOPE: más de MAX_WAMIDS_RETENIDOS wamids distintos descarta el más viejo.
// Cada descarte deja un warn, para poder ver si pasa seguido.
// ---------------------------------------------------------------------------

export type EstadoDeEntrega = {
  status: "SENT" | "DELIVERED" | "READ" | "FAILED";
  error?: string | null;
};

export const RETENCION_MS = 5 * 60 * 1000;
export const MAX_WAMIDS_RETENIDOS = 1000;
// Meta manda a lo sumo sent, delivered, read (o failed) por mensaje; más que
// esto para un mismo wamid es basura.
const MAX_ESTADOS_POR_WAMID = 5;

interface Retenido {
  organizationId: string;
  wamid: string;
  estados: EstadoDeEntrega[];
  expiraEn: number;
}

// Map conserva el orden de inserción: el primero es el más viejo (salvo uno
// que volvió al buffer después de un intento, que queda al final con su
// vencimiento original). Por eso purgar recorre todo —son a lo sumo
// MAX_WAMIDS_RETENIDOS— y el tope descarta el primero.
const retenidos = new Map<string, Retenido>();

function clave(organizationId: string, wamid: string): string {
  return `${organizationId}:${wamid}`;
}

function descartar(r: Retenido, motivo: "vencido" | "tope") {
  retenidos.delete(clave(r.organizationId, r.wamid));
  logger.warn(
    {
      organizationId: r.organizationId,
      wamid: r.wamid,
      estados: r.estados.map((e) => e.status),
      motivo,
    },
    motivo === "vencido"
      ? "Estado de entrega de WhatsApp descartado: su wamid no se guardó a tiempo"
      : "Estado de entrega de WhatsApp descartado: se llenó el buffer de estados retenidos",
  );
}

function purgarVencidos(ahora: number) {
  for (const r of [...retenidos.values()]) {
    if (r.expiraEn <= ahora) descartar(r, "vencido");
  }
}

function insertar(
  organizationId: string,
  wamid: string,
  estado: EstadoDeEntrega,
  expiraEn: number,
) {
  const existente = retenidos.get(clave(organizationId, wamid));
  if (existente) {
    if (existente.estados.length < MAX_ESTADOS_POR_WAMID) existente.estados.push(estado);
    return;
  }
  while (retenidos.size >= MAX_WAMIDS_RETENIDOS) {
    const masViejo = retenidos.values().next().value;
    if (!masViejo) break;
    descartar(masViejo, "tope");
  }
  retenidos.set(clave(organizationId, wamid), {
    organizationId,
    wamid,
    estados: [estado],
    expiraEn,
  });
}

// El webhook: el estado no encontró su Message. Síncrona.
export function retenerEstado(
  organizationId: string,
  wamid: string,
  estado: EstadoDeEntrega,
  ahora: number = Date.now(),
): void {
  purgarVencidos(ahora);
  insertar(organizationId, wamid, estado, ahora + RETENCION_MS);
}

type Aplicar = (
  organizationId: string,
  wamid: string,
  estado: EstadoDeEntrega,
) => Promise<{ count: number }>;

// Quien acaba de guardar el wamid (y el webhook, justo después de retener: ver
// whatsappWebhook.service.ts). Aplica lo retenido en el orden en que llegó;
// applyDeliveryStatusByExternalId no deja retroceder, así que el orden de Meta
// no importa. Lo que sigue sin encontrar su Message vuelve al buffer con su
// vencimiento original. NUNCA LANZA: quien llama ya mandó el mensaje, y un
// fallo acá no puede cambiar eso. Devuelve cuántos estados se aplicaron.
export async function aplicarEstadosRetenidos(
  organizationId: string,
  wamid: string,
  aplicar: Aplicar = applyDeliveryStatusByExternalId,
  ahora: number = Date.now(),
): Promise<number> {
  purgarVencidos(ahora);
  const r = retenidos.get(clave(organizationId, wamid));
  if (!r) return 0;
  retenidos.delete(clave(organizationId, wamid));

  let aplicados = 0;
  for (const estado of r.estados) {
    try {
      const { count } = await aplicar(organizationId, wamid, estado);
      if (count > 0) {
        aplicados += count;
      } else {
        insertar(organizationId, wamid, estado, r.expiraEn);
      }
    } catch (err) {
      logger.error(
        { err, organizationId, wamid, estado: estado.status },
        "No se pudo aplicar un estado de entrega retenido — vuelve al buffer",
      );
      insertar(organizationId, wamid, estado, r.expiraEn);
    }
  }
  return aplicados;
}

// Solo para tests.
export function cantidadDeWamidsRetenidos(): number {
  return retenidos.size;
}

export function resetEstadosRetenidosParaTests(): void {
  retenidos.clear();
}
