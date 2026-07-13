import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { queryClient } from "../lib/queryClient";
import { router } from "./router";

// QueryClientProvider envuelve al RouterProvider: cualquier pantalla que
// el router renderice más adelante va a necesitar useQuery/useMutation.
// Sin AuthProvider todavía — eso se agrega en M1, entre estos dos.
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
