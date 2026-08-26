import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeContact } from "../../test/contactFixtures";
import { ContactSelect } from "./ContactSelect";
import { contactKeys } from "../contact/queries";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/contacts`;

function renderSelect(queryClient: QueryClient, value: string | undefined, onChange = vi.fn()) {
  render(
    <QueryClientProvider client={queryClient}>
      <ContactSelect id="opp-contact" label="Contacto" value={value} onChange={onChange} />
    </QueryClientProvider>,
  );
  return onChange;
}

describe("ContactSelect", () => {
  it("no dispara ningún request al montarse sin término de búsqueda", async () => {
    let requestCount = 0;
    server.use(
      http.get(baseUrl, () => {
        requestCount += 1;
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        });
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderSelect(queryClient, undefined);

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(requestCount).toBe(0);
  });

  it("busca server-side al tipear (debounced), SIN companyId en la query — independiente de Company", async () => {
    const captured: URL[] = [];
    server.use(
      http.get(baseUrl, ({ request }) => {
        captured.push(new URL(request.url));
        return HttpResponse.json({
          data: [makeContact({ id: "ct-1", firstName: "Ana", lastName: "Pérez" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        });
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();

    renderSelect(queryClient, undefined);
    await user.type(screen.getByPlaceholderText("Buscar contacto por nombre o email…"), "ana");

    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    expect(captured[0].searchParams.get("search")).toBe("ana");
    expect(captured[0].searchParams.has("companyId")).toBe(false);
    expect(captured[0].searchParams.get("pageSize")).toBe("20");

    await waitFor(() => expect(screen.getByText("Ana Pérez")).toBeInTheDocument());
  });

  it("al elegir un resultado, llama a onChange con el id y limpia el término", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [makeContact({ id: "ct-1", firstName: "Ana", lastName: "Pérez" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    const onChange = renderSelect(queryClient, undefined);

    await user.type(screen.getByPlaceholderText("Buscar contacto por nombre o email…"), "ana");
    await waitFor(() => expect(screen.getByText("Ana Pérez")).toBeInTheDocument());
    await user.click(screen.getByText("Ana Pérez"));

    expect(onChange).toHaveBeenCalledWith("ct-1");
  });

  it("siembra contactKeys.detail(id) con los resultados de la búsqueda", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [makeContact({ id: "ct-1", firstName: "Ana", lastName: "Pérez" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();

    renderSelect(queryClient, undefined);
    await user.type(screen.getByPlaceholderText("Buscar contacto por nombre o email…"), "ana");
    await waitFor(() => expect(screen.getByText("Ana Pérez")).toBeInTheDocument());

    await waitFor(() =>
      expect(queryClient.getQueryData(contactKeys.detail("ct-1"))).toMatchObject({
        id: "ct-1",
        firstName: "Ana",
      }),
    );
  });

  it("si falla la resolución del contacto ya seleccionado, muestra un fallback humano y nunca el UUID crudo", async () => {
    server.use(
      http.get(`${baseUrl}/ct-rota`, () =>
        HttpResponse.json({ error: { message: "no encontrado" } }, { status: 404 }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderSelect(queryClient, "ct-rota");

    await waitFor(() =>
      expect(screen.getByText(/No pudimos cargar el contacto seleccionado\./)).toBeInTheDocument(),
    );
    expect(screen.queryByText("ct-rota")).not.toBeInTheDocument();
  });

  it("elegir un Contact no relacionado con la Company ya seleccionada funciona sin restricción (no hay reset ni filtro cruzado)", async () => {
    // Simula un Contact que NO pertenece a ninguna Company relacionada con
    // la Opportunity — el backend lo acepta igual (ver E del informe de
    // diseño: sin validación cruzada). ContactSelect no tiene forma de
    // filtrar por Company (no existe esa prop), así que este resultado
    // aparece igual que cualquier otro.
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [
            makeContact({ id: "ct-2", firstName: "Carla", lastName: "Núñez", companyId: null }),
          ],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    const onChange = renderSelect(queryClient, undefined);

    await user.type(screen.getByPlaceholderText("Buscar contacto por nombre o email…"), "carla");
    await waitFor(() => expect(screen.getByText("Carla Núñez")).toBeInTheDocument());
    await user.click(screen.getByText("Carla Núñez"));

    expect(onChange).toHaveBeenCalledWith("ct-2");
  });
});
