import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  definirProfesionales,
  getConfiguracionDeSede,
  guardarConfiguracionDeSede,
  listPrestaciones,
} from "./api";
import type { ConfiguracionDeSede } from "./types";

export const clinicaKeys = {
  all: ["clinica"] as const,
  prestaciones: () => [...clinicaKeys.all, "prestaciones"] as const,
  configuracionDeSede: (branchId: string) =>
    [...clinicaKeys.all, "configuracion-de-sede", branchId] as const,
};

export function useConfiguracionDeSede(branchId: string) {
  return useQuery({
    queryKey: clinicaKeys.configuracionDeSede(branchId),
    queryFn: ({ signal }) => getConfiguracionDeSede(branchId, signal),
  });
}

export function useGuardarConfiguracionDeSede(branchId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ConfiguracionDeSede) => guardarConfiguracionDeSede(branchId, body),
    onSuccess: (data) => {
      queryClient.setQueryData(clinicaKeys.configuracionDeSede(branchId), data);
    },
  });
}

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
