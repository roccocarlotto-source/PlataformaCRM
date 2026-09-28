import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type { CreateWhatsappTemplateInput, WhatsappTemplate } from "./types";

// Reutiliza request()/getAccessToken tal cual, como el resto de los features.
// Sin organizationId en ninguna: la organización se resuelve server-side desde
// el JWT (whatsappTemplate.routes.ts).

// La plantilla activa de UNA regla, o null si no tiene (200 en los dos casos:
// "no tiene" es un estado normal de la pantalla, no un 404). El automationId
// es obligatorio en el backend desde el ítem 181.
export function getWhatsappTemplate(
  automationId: string,
  signal?: AbortSignal,
): Promise<WhatsappTemplate | null> {
  const query = new URLSearchParams({ automationId }).toString();
  return request<WhatsappTemplate | null>(`/whatsapp-templates?${query}`, {
    getAccessToken,
    signal,
  });
}

// Crea la plantilla de una regla y el backend la manda a Meta para su
// revisión. Vuelve en PENDING. Los errores (texto inválido, nombre en uso,
// regla que no manda WhatsApp, Meta que la rechaza en el momento) llegan con
// el mensaje listo para mostrar.
export function createWhatsappTemplate(
  input: CreateWhatsappTemplateInput,
): Promise<WhatsappTemplate> {
  return request<WhatsappTemplate>("/whatsapp-templates", {
    method: "POST",
    body: input,
    getAccessToken,
  });
}

// Borra en Meta y localmente. 204 sin body.
export function deleteWhatsappTemplate(id: string): Promise<void> {
  return request<void>(`/whatsapp-templates/${id}`, { method: "DELETE", getAccessToken });
}

// Repregunta el estado a Meta y devuelve la plantilla actualizada.
export function refreshWhatsappTemplate(id: string): Promise<WhatsappTemplate> {
  return request<WhatsappTemplate>(`/whatsapp-templates/${id}/refresh`, {
    method: "POST",
    getAccessToken,
  });
}
