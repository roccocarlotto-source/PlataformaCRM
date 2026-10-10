import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { definirProfesionales, listPrestaciones } from "./api";

export const clinicaKeys = {
  all: ["clinica"] as const,
  prestaciones: () => [...clinicaKeys.all, "prestaciones"] as const,
};

export function usePrestaciones() {
  return useQuery({
    queryKey: clinicaKeys.prestaciones(),
    queryFn: ({ signal }) => listPrestaciones(signal),
  });
}

export function useDefinirProfesionales() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      serviceTypeId,
      resourceIds,
    }: {
      serviceTypeId: string;
      resourceIds: string[];
    }) => definirProfesionales(serviceTypeId, resourceIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clinicaKeys.prestaciones() });
    },
  });
}
