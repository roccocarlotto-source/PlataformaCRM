import { useQuery } from "@tanstack/react-query";
import { getVoucherWhatsappStatus, listContactVouchers } from "./api";

export const voucherKeys = {
  all: ["vouchers"] as const,
  byContact: (contactId: string) => [...voucherKeys.all, "contact", contactId] as const,
  whatsapp: (id: string) => [...voucherKeys.all, "whatsapp", id] as const,
};

export function useContactVouchers(contactId: string) {
  return useQuery({
    queryKey: voucherKeys.byContact(contactId),
    queryFn: ({ signal }) => listContactVouchers(contactId, signal),
  });
}

// La ventana de 24 h cambia con el tiempo: se pide al abrir el resultado, sin
// reintentos automáticos de más.
export function useVoucherWhatsappStatus(id: string) {
  return useQuery({
    queryKey: voucherKeys.whatsapp(id),
    queryFn: ({ signal }) => getVoucherWhatsappStatus(id, signal),
  });
}
