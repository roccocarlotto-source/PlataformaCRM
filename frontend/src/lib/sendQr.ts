// ---------------------------------------------------------------------------
// "Enviar QR" — puerto de admin/src/lib/sendQr.ts del original (Cycle 16/23,
// DEC-049..052): solo deep-links con el mensaje preparado. La plataforma no
// manda nada por sí misma — el mensaje sale desde el dispositivo/cuenta del
// dueño del negocio. Funciones puras de armado de strings, sin efectos, sin
// backend: el dato del destinatario no lo toca nada de este archivo más allá
// de armar un link (DEC-051: vive únicamente en el estado del componente que
// llama).
//
// El copy de abajo es un default mínimo de implementación, no una decisión de
// diseño aprobada — Cycle 16 fijó mecanismo/canales/privacidad/alcance, no la
// redacción exacta.
// ---------------------------------------------------------------------------

// wa.me exige solo dígitos (número internacional completo: código de país +
// número, sin "+", sin espacios, sin prefijo troncal "00"/"0"). Esto saca
// exactamente lo necesario para que el deep-link funcione.
//
// DEC-063 (Cycle 23): dos casos específicos de Uruguay sobre el strip
// genérico — un celular local de 8 dígitos, y uno de 9 dígitos con el
// prefijo troncal "0" — a los dos se les antepone "598". Cualquier otra
// forma/largo (incluidos los que ya empiezan con "598") queda como está: no
// existe en el proyecto política de numeración de ningún otro país.
export function normalizeWhatsAppNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("598")) {
    return digits;
  }
  if (digits.length === 9 && digits.startsWith("0")) {
    return "598" + digits.slice(1);
  }
  if (digits.length === 8) {
    return "598" + digits;
  }
  return digits;
}

// El mensaje por QR (decisión del operador, 2026-08-14) reemplaza al copy
// fijo cuando existe, pero el link público de resolución se agrega SIEMPRE
// después y nunca es reemplazable — destinationUrl no está disponible en
// esta capa, así que no hay forma de filtrarlo ni por error.
function buildShareText(publicUrl: string, customMessage?: string | null): string {
  const trimmed = customMessage?.trim();
  if (trimmed) {
    return `${trimmed}\n\n${publicUrl}`;
  }
  return `Dejanos tu reseña en Google: ${publicUrl}`;
}

export function buildWhatsAppLink(
  rawPhone: string,
  publicUrl: string,
  customMessage?: string | null,
): string {
  const digits = normalizeWhatsAppNumber(rawPhone);
  const text = encodeURIComponent(buildShareText(publicUrl, customMessage));
  return `https://wa.me/${digits}?text=${text}`;
}

const EMAIL_SUBJECT = "Te invitamos a dejarnos una reseña";

function buildEmailBodyText(publicUrl: string, customMessage?: string | null): string {
  const trimmed = customMessage?.trim();
  if (trimmed) {
    return `Hola,\n\n${trimmed}\n\n${publicUrl}\n\n¡Gracias!`;
  }
  return `Hola,\n\nTe compartimos el link para dejarnos tu reseña en Google:\n${publicUrl}\n\n¡Gracias!`;
}

export function buildMailtoLink(
  email: string,
  publicUrl: string,
  customMessage?: string | null,
): string {
  const subject = encodeURIComponent(EMAIL_SUBJECT);
  const body = encodeURIComponent(buildEmailBodyText(publicUrl, customMessage));
  return `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;
}

// Hallazgo 2 / DEL-020 (Cycle 23): mailto: falla en silencio cuando el
// dispositivo no tiene cliente de correo por defecto — limitación del esquema
// en sí, no un bug nuestro. Este es el respaldo, solo del lado del cliente:
// exactamente el mismo asunto+cuerpo que buildMailtoLink, como texto plano,
// para pegarlo en el cliente de correo que sea. Sin backend, sin
// almacenamiento, sin proveedor nuevo.
export function buildEmailMessageForCopy(publicUrl: string, customMessage?: string | null): string {
  return `${EMAIL_SUBJECT}\n\n${buildEmailBodyText(publicUrl, customMessage)}`;
}

// Abre el mensaje preparado en el propio dispositivo — mismo mecanismo de
// click sobre un <a> que downloadSvg (qrImage.ts), así las dos acciones de
// "abrir un destino externo" se comportan y se prueban igual.
export function openPreparedMessage(link: string): void {
  const anchor = document.createElement("a");
  anchor.href = link;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.click();
}
