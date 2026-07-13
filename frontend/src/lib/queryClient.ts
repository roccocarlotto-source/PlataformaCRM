import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

// QueryClient único y global. M1 agregó la primera query real (GET /api/me,
// en auth/AuthContext.tsx); M2 agregó las de features/company/. La higiene
// de cache entre identidades (login/logout/cambio de sesión) se resuelve
// enteramente en la frontera de AuthContext (queryClient.clear()), no acá.
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
