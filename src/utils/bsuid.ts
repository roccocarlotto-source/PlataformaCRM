// ---------------------------------------------------------------------------
// BSUID: el identificador de un usuario de WhatsApp por portafolio de negocio
// (business-scoped user ID), que Meta manda en los webhooks desde abril de 2026
// como `user_id` / `from_user_id`. Con los nombres de usuario de WhatsApp, el
// teléfono (`from`, `wa_id`) puede no venir y el BSUID es lo único que
// identifica al remitente (docs/mensajes-con-opciones.md §10.1).
//
// Forma: código de país ISO de dos letras, un punto y hasta 128 alfanuméricos
// ("UY.1234…"). El BSUID "padre" lleva "ENT." en el medio ("US.ENT.1181…").
// Un wa_id son solo dígitos: nunca se confunde con un BSUID.
// ---------------------------------------------------------------------------

const FORMA_DEL_BSUID = /^[A-Z]{2}\.(?:ENT\.)?[A-Za-z0-9]{1,128}$/;

export function esBsuid(valor: string): boolean {
  return FORMA_DEL_BSUID.test(valor);
}

// Los logs nunca llevan el teléfono ni el BSUID completos: identifican a una
// persona. Alcanza con lo justo para distinguir un caso de otro.
export function enmascararBsuid(bsuid: string): string {
  const ultimoPunto = bsuid.lastIndexOf(".");
  return `${bsuid.slice(0, ultimoPunto + 1)}…${bsuid.slice(-4)}`;
}

export function enmascararTelefono(telefono: string): string {
  const digitos = telefono.replace(/\D/g, "");
  return digitos.length > 3 ? `…${digitos.slice(-3)}` : "…";
}

export function enmascararIdDeWhatsapp(valor: string | undefined): string | null {
  if (!valor) return null;
  return esBsuid(valor) ? enmascararBsuid(valor) : enmascararTelefono(valor);
}
