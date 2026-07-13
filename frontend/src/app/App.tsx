import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { AuthProvider } from "../auth/AuthContext";
import { queryClient } from "../lib/queryClient";
import { router } from "./router";

// QueryClientProvider envuelve a AuthProvider: AuthProvider usa
// useQueryClient/useQuery (la query de /api/me) y necesita ser descendiente
// del Provider. AuthProvider envuelve a RouterProvider: ProtectedRoute y
// LoginPage, renderizados por el router, necesitan useAuth().
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
