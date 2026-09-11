import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type { OrganizationSettings, UpdateOrganizationCurrencyInput } from "./types";

// Reutiliza request()/getAccessToken tal cual, como el resto de los features.
// Sin :id en ninguna de las dos: la organización se resuelve exclusivamente
// server-side desde el JWT (organization.routes.ts).

export function getOrganizationSettings(signal?: AbortSignal): Promise<OrganizationSettings> {
  return request<OrganizationSettings>("/organization", { getAccessToken, signal });
}

// El PATCH devuelve la configuración completa ya actualizada (misma forma
// que el GET, cotizaciones incluidas), no solo los campos tocados.
export function updateOrganizationCurrency(
  input: UpdateOrganizationCurrencyInput,
): Promise<OrganizationSettings> {
  return request<OrganizationSettings>("/organization", {
    method: "PATCH",
    body: input,
    getAccessToken,
  });
}
