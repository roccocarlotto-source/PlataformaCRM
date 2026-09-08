import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type { CreateOrganizationInput, CreateOrganizationResponse } from "./types";

// Reutiliza request()/getAccessToken tal cual, como el resto de los módulos.
// La gate (platform admin) la decide el backend por el JWT; acá no viaja
// ningún dato de identidad.
export function createOrganization(
  input: CreateOrganizationInput,
): Promise<CreateOrganizationResponse> {
  return request<CreateOrganizationResponse>("/admin/organizations", {
    method: "POST",
    body: input,
    getAccessToken,
  });
}
