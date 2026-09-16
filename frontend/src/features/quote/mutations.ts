import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createQuote, transitionQuote, updateQuoteContent } from "./api";
import { quoteKeys } from "./queries";
import type { CreateQuoteInput, QuoteTransition, UpdateQuoteContentInput } from "./types";

// Toda escritura invalida el historial ENTERO de la oportunidad, no solo la
// cotización tocada: crear una nueva cambia el estado de la anterior
// (SUPERSEDED) y cuál es la activa, y eso lo decide el backend. Nada de esto
// escribe sobre la oportunidad (aceptar no la marca ganada), así que
// opportunityKeys no se toca.

export function useCreateQuote(opportunityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreateQuoteInput, "opportunityId">) =>
      createQuote({ ...input, opportunityId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: quoteKeys.byOpportunity(opportunityId) });
    },
  });
}

export function useUpdateQuoteContent(opportunityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateQuoteContentInput }) =>
      updateQuoteContent(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: quoteKeys.byOpportunity(opportunityId) });
    },
  });
}

export function useTransitionQuote(opportunityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: QuoteTransition }) =>
      transitionQuote(id, status),
    // onSettled y no onSuccess: un 409 (la cotización venció o la superaron
    // mientras la pantalla estaba abierta) también deja la vista vieja, y
    // refrescar muestra el estado real junto al mensaje de error.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: quoteKeys.byOpportunity(opportunityId) });
    },
  });
}
