// Puerto de admin/src/lib/validation.ts del original (solo looksLikeUrl —
// getSafeRedirectTarget no tiene consumidor acá: el redirect post-login lo
// resuelve LoginPage con el `state.from` que le deja ProtectedRoute, nunca
// un query param). Validación liviana del lado del cliente, para feedback
// inmediato: la fuente de verdad sigue siendo el Zod del backend
// (destinationUrlSchema en qr.controller.ts), que exige http(s):// y 2048 máx.
export function looksLikeUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
