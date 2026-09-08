import { useMutation } from "@tanstack/react-query";
import { createOrganization } from "./api";
import type { CreateOrganizationInput } from "./types";

// Sin invalidación: la organización nueva no aparece en ninguna query de
// este frontend (el platform admin no ve listado de organizaciones — solo
// alta, a propósito, en esta fase).
export function useCreateOrganization() {
  return useMutation({
    mutationFn: (input: CreateOrganizationInput) => createOrganization(input),
  });
}
