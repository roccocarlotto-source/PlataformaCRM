import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

// Infraestructura global únicamente — sin query keys de módulos
// funcionales todavía (eso empieza en M1).
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // 4xx (incluye 401/403/404/409/410/429) son deterministas —
      // reintentar no cambia el resultado. 5xx y errores de red (sin
      // .status, caen al else) son los únicos casos genuinamente
      // transitorios.
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: {
      // Reintentar una mutación a ciegas es peligroso contra este backend
      // (ej. onboarding no es idempotente y tiene rate limit propio).
      retry: false,
    },
  },
});
