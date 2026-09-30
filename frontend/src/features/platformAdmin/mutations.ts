import { useMutation, useQueryClient } from "@tanstack/react-query";
import { agentKeys } from "../agent/queries";
import { internalAgentKeys } from "../internalAgent/queries";
import {
  assignAgentModel,
  assignFacebookPage,
  assignInternalAgentModel,
  assignWhatsappNumber,
  createOrganization,
} from "./api";
import type {
  AssignAgentModelInput,
  AssignFacebookPageInput,
  AssignInternalAgentModelInput,
  AssignWhatsappNumberInput,
  CreateOrganizationInput,
} from "./types";

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

// Sin invalidación, por el mismo motivo que el número de WhatsApp.
export function useAssignFacebookPage() {
  return useMutation({
    mutationFn: (input: AssignFacebookPageInput) => assignFacebookPage(input),
  });
}

// B-05. Invalidan agentes y agente interno: el platform admin puede estar
// cambiando el de SU organización desde el formulario, y ahí sí hay queries
// que refrescar. Si es de otra organización, invalidar no cuesta nada.
export function useAssignAgentModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AssignAgentModelInput) => assignAgentModel(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}

export function useAssignInternalAgentModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AssignInternalAgentModelInput) => assignInternalAgentModel(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: internalAgentKeys.all });
    },
  });
}
