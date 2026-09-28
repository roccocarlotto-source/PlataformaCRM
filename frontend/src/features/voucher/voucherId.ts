// ---------------------------------------------------------------------------
// El id del cupón a partir de lo que se escaneó o se pegó. El QR de la página
// del cupón codifica su link público (`https://nexoraqrs.com/v/:id`, ver
// src/utils/voucherPublicUrl.ts del backend) — o el id pelado, si el backend
// no tiene QR_PUBLIC_BASE_URL. En los dos casos el UUID va AL FINAL: se toma
// de ahí, tolerando una barra final, un query o un hash que agregue quien lo
// comparte. null si no hay UUID al final — no es un cupón (un QR de reseñas,
// un link cualquiera).
// ---------------------------------------------------------------------------

const UUID_AL_FINAL =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?(?:[?#].*)?$/i;

export function extractVoucherId(texto: string): string | null {
  const match = UUID_AL_FINAL.exec(texto.trim());
  return match ? match[1].toLowerCase() : null;
}
