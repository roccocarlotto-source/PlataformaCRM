import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { AuthProvider } from "../auth/AuthContext";
import { ToastProvider } from "../design-system/Toast";
import { queryClient } from "../lib/queryClient";
import { router } from "./router";

// QueryClientProvider envuelve a AuthProvider: AuthProvider usa
// useQueryClient/useQuery (la query de /api/me) y necesita ser descendiente
// del Provider. AuthProvider envuelve a RouterProvider: ProtectedRoute y
// LoginPage, renderizados por el router, necesitan useAuth().
// ToastProvider también envuelve a RouterProvider, y tiene que estar POR
// ENCIMA del router: un toast disparado justo antes de navegar (guardar un
// pipeline vuelve a la lista) debe sobrevivir al cambio de página — ver
// design-system/Toast.tsx.
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
