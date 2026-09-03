import { useQuery } from "@tanstack/react-query";
import { listQrCodes } from "./api";
import type { QrCodeListQuery } from "./types";

// Misma forma jerárquica que companyKeys/apiKeyKeys. SIN `detail`,
// deliberadamente: no existe GET /api/qr/:id (ver api.ts) — mismo criterio
// que apiKeyKeys y userKeys, una key para una query que no puede existir
// sería una invitación a escribirla.
export const qrKeys = {
  all: ["qr-codes"] as const,
  lists: () => [...qrKeys.all, "list"] as const,
  list: (query: QrCodeListQuery) => [...qrKeys.lists(), query] as const,
};

export function useQrCodes(query: QrCodeListQuery, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qrKeys.list(query),
    queryFn: ({ signal }) => listQrCodes(query, signal),
    enabled: options?.enabled,
  });
}
