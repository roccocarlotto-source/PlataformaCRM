import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type { EnviosQueNoSalieronQuery, EnviosQueNoSalieronResponse } from "./types";

export function listEnviosQueNoSalieron(
  query: EnviosQueNoSalieronQuery,
  signal?: AbortSignal,
): Promise<EnviosQueNoSalieronResponse> {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.branchId) params.set("branchId", query.branchId);
  const queryString = params.toString();
  return request<EnviosQueNoSalieronResponse>(
    `/envios-que-no-salieron${queryString ? `?${queryString}` : ""}`,
    { getAccessToken, signal },
  );
}
