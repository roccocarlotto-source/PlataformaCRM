import { useMutation } from "@tanstack/react-query";
import { assignWhatsappNumber, createOrganization } from "./api";
import type { AssignWhatsappNumberInput, CreateOrganizationInput } from "./types";

// Sin invalidación: la organización nueva no aparece en ninguna query de
// este frontend (el platform admin no ve listado de organizaciones — solo
// alta, a propósito, en esta fase).
export function useCreateOrganization() {
  return useMutation({
    mutationFn: (input: CreateOrganizationInput) => createOrganization(input),
  });
}

// Sin invalidación, por el mismo motivo: el agente es de OTRA organización y
// no está en ninguna query de la sesión del platform admin.
export function useAssignWhatsappNumber() {
  return useMutation({
    mutationFn: (input: AssignWhatsappNumberInput) => assignWhatsappNumber(input),
  });
}
