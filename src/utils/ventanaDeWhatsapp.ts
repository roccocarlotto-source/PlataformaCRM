// ---------------------------------------------------------------------------
// La ventana de atención de WhatsApp (I-03 de
// docs-privados/auditoria-2026-09-24-punta-a-punta.md, local).
//
// Meta solo acepta TEXTO LIBRE de la empresa dentro de las 24 h posteriores al
// último mensaje del cliente; pasado eso, únicamente plantillas aprobadas (y
// un texto libre vuelve con un 4xx). Se cuenta desde el último mensaje del
// CLIENTE, no desde el último del negocio: que el vendedor escriba no la
// renueva.
//
// Messenger e Instagram tienen la MISMA ventana estándar de 24 h (el
// messaging_type RESPONSE del Send API, ver metaSend.service.ts), así que
// responder desde el CRM usa estas funciones también para esos canales.
//
// Puras y sin base, para probarlas con fechas fijas.
// ---------------------------------------------------------------------------

export const VENTANA_DE_WHATSAPP_MS = 24 * 60 * 60 * 1000;

// Hasta cuándo se puede mandar texto libre, o null si el cliente nunca
// escribió en el hilo (una conversación que abrió una plantilla de una
// automatización): sin mensaje del cliente no hay ventana abierta.
export function finDeLaVentanaDeWhatsapp(ultimoEntrante: Date | null): Date | null {
  return ultimoEntrante ? new Date(ultimoEntrante.getTime() + VENTANA_DE_WHATSAPP_MS) : null;
}

export function ventanaDeWhatsappAbierta(fin: Date | null, ahora: Date = new Date()): boolean {
  return fin !== null && ahora.getTime() < fin.getTime();
}
