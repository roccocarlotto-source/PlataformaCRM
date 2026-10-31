import { createContext } from "react";

// ---------------------------------------------------------------------------
// UX-08 (docs-privados/auditoria-2026-10-21, local; decisión de Rocco del
// 2026-10-30): cada pestaña dice qué pantalla es y de qué organización
// ("Contactos · Automotora Centro"), en vez de "Plataforma CRM" en todas.
//
// Nunca el nombre de una persona: queda en el historial del navegador. Por eso
// una pantalla cuyo título lleva datos de alguien (la ficha de un vehículo de
// cliente, una orden) le pasa a PageHeader un `tituloDePestana` genérico.
// ---------------------------------------------------------------------------

export const TITULO_BASE = "Plataforma CRM";

/** El nombre de la organización de la sesión; null fuera de AppLayout. */
export const OrganizacionDeLaPestana = createContext<string | null>(null);

export function tituloDeLaPestana(pantalla: string, organizacion: string | null): string {
  const limpia = pantalla.trim();
  return [limpia, organizacion?.trim() || TITULO_BASE].filter(Boolean).join(" · ");
}
