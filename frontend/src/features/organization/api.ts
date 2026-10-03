import { ApiError, request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  MetaPageConnection,
  OrganizationSettings,
  UpdateOrganizationSettingsInput,
} from "./types";

// Reutiliza request()/getAccessToken tal cual, como el resto de los features.
// Sin :id en ninguna de las dos: la organización se resuelve exclusivamente
// server-side desde el JWT (organization.routes.ts).

export function getOrganizationSettings(signal?: AbortSignal): Promise<OrganizationSettings> {
  return request<OrganizationSettings>("/organization", { getAccessToken, signal });
}

// El PATCH devuelve la configuración completa ya actualizada (misma forma
// que el GET, cotizaciones incluidas), no solo los campos tocados.
export function updateOrganizationSettings(
  input: UpdateOrganizationSettingsInput,
): Promise<OrganizationSettings> {
  return request<OrganizationSettings>("/organization", {
    method: "PATCH",
    body: input,
    getAccessToken,
  });
}

// ---------------------------------------------------------------------------
// Página de Facebook de la organización (ítem 173). Solo lectura desde el
// 02/10/2026: conectar y desconectar es del platform admin
// (features/platformAdmin/api.ts). La organización sale del JWT.
// ---------------------------------------------------------------------------

// null = la organización nunca se conectó. El backend lo dice con un 404, que
// acá es un estado normal de la pantalla y no un error: se traduce a null
// para que la sección muestre "Sin conectar". Cualquier otro error sigue siendo
// error.
export async function getMetaConnection(signal?: AbortSignal): Promise<MetaPageConnection | null> {
  try {
    return await request<MetaPageConnection>("/integrations/meta", { getAccessToken, signal });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
