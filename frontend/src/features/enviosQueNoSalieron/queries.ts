import { useQuery } from "@tanstack/react-query";
import { listEnviosQueNoSalieron } from "./api";
import type { EnviosQueNoSalieronQuery } from "./types";

export const enviosQueNoSalieronKeys = {
  all: ["envios-que-no-salieron"] as const,
  list: (query: EnviosQueNoSalieronQuery) => [...enviosQueNoSalieronKeys.all, query] as const,
};

export function useEnviosQueNoSalieron(query: EnviosQueNoSalieronQuery) {
  return useQuery({
    queryKey: enviosQueNoSalieronKeys.list(query),
    queryFn: ({ signal }) => listEnviosQueNoSalieron(query, signal),
  });
}
