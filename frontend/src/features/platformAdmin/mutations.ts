import { useMutation, useQueryClient } from "@tanstack/react-query";
import { agentKeys } from "../agent/queries";
import { internalAgentKeys } from "../internalAgent/queries";
import {
  assignAgentModel,
  assignFacebookPage,
  assignInternalAgentModel,
  assignWhatsappNumber,
  completeOrganizationMetaConnection,
  createOrganization,
  disconnectOrganizationMetaConnection,
  startOrganizationMetaConnection,
} from "./api";
import { platformAdminKeys } from "./queries";
import type {
  AssignAgentModelInput,
  AssignFacebookPageInput,
  AssignInternalAgentModelInput,
  AssignWhatsappNumberInput,
  CreateOrganizationInput,
  MetaConnectionPendiente,
} from "./types";

// Invalida el listado del selector de organizaciones: la nueva tiene que
// aparecer ahí.
export function useCreateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOrganizationInput) => createOrganization(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: platformAdminKeys.organizations() });
    },
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

// La conexión con Facebook de una organización elegida (02/10/2026). Iniciar
// no cambia nada todavía (solo firma el state y devuelve la URL de Meta): no
// hay nada que invalidar. El cambio real ocurre al volver, al completar.
export function useStartOrganizationMetaConnection() {
  return useMutation({
    mutationFn: (organizationId: string) => startOrganizationMetaConnection(organizationId),
  });
}

export function useCompleteOrganizationMetaConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { organizationId: string; pendiente: MetaConnectionPendiente }) =>
      completeOrganizationMetaConnection(input.organizationId, input.pendiente),
    onSuccess: (_data, { organizationId }) => {
      void queryClient.invalidateQueries({
        queryKey: platformAdminKeys.metaConnection(organizationId),
      });
    },
  });
}

export function useDisconnectOrganizationMetaConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (organizationId: string) => disconnectOrganizationMetaConnection(organizationId),
    onSuccess: (_data, organizationId) => {
      void queryClient.invalidateQueries({
        queryKey: platformAdminKeys.metaConnection(organizationId),
      });
    },
  });
}
