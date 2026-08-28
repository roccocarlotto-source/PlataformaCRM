import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { ingestionEventKeys } from "../ingestionEvent/queries";
import { useImportFile } from "./mutations";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// Q-A: una importación exitosa crea IngestionEvent, así que tiene que invalidar
// el listado de eventos — no el suyo propio. Es una dependencia CRUZADA entre
// dos slices, exactamente la clase de cosa que se rompe en silencio si nadie la
// prueba: la pantalla de eventos seguiría mostrando datos viejos y nadie sabría
// por qué.

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useImportFile", () => {
  it("invalida el listado de eventos de ingesta al importar con éxito", async () => {
    server.use(
      http.post(`${env.apiUrl}/api/imports`, () =>
        HttpResponse.json(
          {
            batchId: "b1",
            encabezados: ["Nombre"],
            filasLeidas: 1,
            insertados: 1,
            duplicados: 0,
          },
          { status: 202 },
        ),
      ),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useImportFile("src1"), {
      wrapper: wrapper(queryClient),
    });

    await result.current.mutateAsync(new File(["Nombre\nAna"], "leads.csv", { type: "text/csv" }));

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ingestionEventKeys.lists() }),
    );
  });

  it("un fallo NO invalida nada", async () => {
    server.use(
      http.post(`${env.apiUrl}/api/imports`, () =>
        HttpResponse.json({ error: { message: "La fuente está pausada" } }, { status: 400 }),
      ),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useImportFile("src1"), {
      wrapper: wrapper(queryClient),
    });

    await expect(
      result.current.mutateAsync(new File(["x"], "leads.csv", { type: "text/csv" })),
    ).rejects.toThrow();

    expect(invalidate).not.toHaveBeenCalled();
  });
});
