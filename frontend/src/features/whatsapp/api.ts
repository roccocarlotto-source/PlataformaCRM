import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type { CreateWhatsappTemplateInput, WhatsappTemplate } from "./types";

// Reutiliza request()/getAccessToken tal cual, como el resto de los features.
// Sin organizationId en ninguna: la organización se resuelve server-side desde
// el JWT (whatsappTemplate.routes.ts).

// La plantilla activa de la organización, o null si no tiene (200 en los dos
// casos: "no tiene" es un estado normal de la pantalla, no un 404).
export function getCurrentWhatsappTemplate(signal?: AbortSignal): Promise<WhatsappTemplate | null> {
  return request<WhatsappTemplate | null>("/whatsapp-templates", { getAccessToken, signal });
}

// Crea la plantilla y el backend la manda a Meta para su revisión. Vuelve en
// PENDING. Los errores (texto inválido, nombre en uso, Meta que la rechaza en
// el momento) llegan con el mensaje listo para mostrar.
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
