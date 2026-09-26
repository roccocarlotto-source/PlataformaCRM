import { useQuery } from "@tanstack/react-query";
import { getSuggestedQrDisplayNumber, listQrCodes } from "./api";
import type { QrCodeListQuery } from "./types";

// Misma forma jerárquica que companyKeys/apiKeyKeys. SIN `detail`,
// deliberadamente: no existe GET /api/qr/:id (ver api.ts) — mismo criterio
// que apiKeyKeys y userKeys, una key para una query que no puede existir
// sería una invitación a escribirla.
export const qrKeys = {
  all: ["qr-codes"] as const,
  lists: () => [...qrKeys.all, "list"] as const,
  list: (query: QrCodeListQuery) => [...qrKeys.lists(), query] as const,
  // §54: el N° sugerido para un QR nuevo de esa sucursal. Por branchId, porque
  // la serie es por sucursal.
  nextDisplayNumber: (branchId: string) =>
    [...qrKeys.all, "next-display-number", branchId] as const,
};

// pageSize al máximo del contrato (listQrQuerySchema de qr.controller.ts),
// mismo criterio y mismo riesgo residual que BRANCHES_PARA_SELECT: más de 100
// QRs activos en una organización no entrarían en la lista.
export const QRS_PARA_SELECT: QrCodeListQuery = {
  pageSize: 100,
  sortBy: "displayNumber",
  sortOrder: "asc",
};

export function useQrCodes(query: QrCodeListQuery, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qrKeys.list(query),
    queryFn: ({ signal }) => listQrCodes(query, signal),
    enabled: options?.enabled,
  });
}

// §54 — el N° que el formulario de alta propone. Sin sucursal elegida no hay
// serie que consultar, así que la query ni se dispara. Mismo patrón exacto que
// useBranch/useCompany para una query condicional: `?? ""` en la key y en la
// llamada, `enabled` decidiendo.
export function useSuggestedQrDisplayNumber(branchId: string | undefined) {
  return useQuery({
    queryKey: qrKeys.nextDisplayNumber(branchId ?? ""),
    queryFn: ({ signal }) => getSuggestedQrDisplayNumber(branchId ?? "", signal),
    enabled: branchId !== undefined,
  });
}
