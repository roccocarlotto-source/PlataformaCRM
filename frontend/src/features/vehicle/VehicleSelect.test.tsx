import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeVehicleDetail, makeVehicleListItem } from "../../test/vehicleFixtures";
import { VehicleSelect } from "./VehicleSelect";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/vehicles`;
const PLACEHOLDER = "Buscar unidad disponible por marca, modelo, patente, VIN o código…";

function renderSelect(value: string | undefined, onChange = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <VehicleSelect id="opp-vehicle" label="Unidad de stock" value={value} onChange={onChange} />
    </QueryClientProvider>,
  );
  return onChange;
}

function searchHandler(capture?: URL[]) {
  return http.get(baseUrl, ({ request }) => {
    capture?.push(new URL(request.url));
    return HttpResponse.json({
      data: [
        makeVehicleListItem({ id: "v1", trim: "XEi", priceListUsd: "25000.00" }),
        makeVehicleListItem({ id: "v2", make: "Ford", model: "Ranger", priceOnRequest: true }),
      ],
      pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
    });
  });
}

// Mismo molde que ContactSelect.test.tsx: búsqueda mockeada con MSW y la
// resolución por id de la unidad ya seleccionada aparte.
describe("VehicleSelect", () => {
  it("no dispara ningún request al montarse sin término ni valor", async () => {
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

    renderSelect(undefined);

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(requestCount).toBe(0);
    expect(screen.queryByText("Quitar vínculo")).not.toBeInTheDocument();
  });

  it("busca server-side al tipear (debounced) SOLO unidades disponibles: q, status=AVAILABLE y pageSize=20; cada resultado muestra unidad y precio", async () => {
    const captured: URL[] = [];
    server.use(searchHandler(captured));
    const user = userEvent.setup();

    renderSelect(undefined);
    await user.type(screen.getByLabelText("Unidad de stock"), "corolla");

    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    expect(captured[0].searchParams.get("q")).toBe("corolla");
    expect(captured[0].searchParams.getAll("status")).toEqual(["AVAILABLE"]);
    expect(captured[0].searchParams.get("pageSize")).toBe("20");

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Toyota Corolla 2020 XEi · 25000.00 USD" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Ford Ranger 2020 · Consultar precio" }),
    ).toBeInTheDocument();
  });

  it("al elegir un resultado llama a onChange con el id y limpia el término", async () => {
    server.use(
      searchHandler(),
      http.get(`${baseUrl}/:id`, ({ params }) =>
        HttpResponse.json(makeVehicleDetail({ id: params.id as string })),
      ),
    );
    const user = userEvent.setup();
    const onChange = renderSelect(undefined);

    await user.type(screen.getByPlaceholderText(PLACEHOLDER), "corolla");
    const resultado = await screen.findByRole("button", {
      name: "Toyota Corolla 2020 XEi · 25000.00 USD",
    });
    await user.click(resultado);

    expect(onChange).toHaveBeenCalledWith("v1");
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveValue("");
  });

  it("sin resultados: mensaje que aclara que solo se buscan unidades disponibles", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        }),
      ),
    );
    const user = userEvent.setup();

    renderSelect(undefined);
    await user.type(screen.getByPlaceholderText(PLACEHOLDER), "zzz");

    await waitFor(() =>
      expect(screen.getByText("Sin unidades disponibles para esa búsqueda.")).toBeInTheDocument(),
    );
  });

  it("la unidad ya seleccionada se resuelve por id SIN filtro de estado (una RESERVED se muestra, con su badge y su precio) y 'Quitar vínculo' llama a onChange(null)", async () => {
    const captured: URL[] = [];
    server.use(
      http.get(`${baseUrl}/:id`, ({ request, params }) => {
        captured.push(new URL(request.url));
        return HttpResponse.json(
          makeVehicleDetail({
            id: params.id as string,
            make: "Ford",
            model: "Ranger",
            status: "RESERVED",
            priceListUsd: "40000.00",
          }),
        );
      }),
    );
    const user = userEvent.setup();
    const onChange = renderSelect("v-reservada");

    await waitFor(() => expect(screen.getByText(/Ford Ranger 2020 · 40000.00 USD/)).toBeVisible());
    expect(captured[0].pathname.endsWith("/api/vehicles/v-reservada")).toBe(true);
    expect(captured[0].searchParams.has("status")).toBe(false);
    const badge = screen.getByText("Reservado");
    expect(badge).toHaveClass("ds-badge", "ds-badge--info");
    expect(screen.queryByText("v-reservada")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Quitar vínculo" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("si falla la resolución de la unidad seleccionada, muestra un fallback humano y nunca el UUID crudo", async () => {
    server.use(
      http.get(`${baseUrl}/v-rota`, () =>
        HttpResponse.json({ error: { message: "no encontrada" } }, { status: 404 }),
      ),
    );

    renderSelect("v-rota");

    await waitFor(() =>
      expect(screen.getByText(/No pudimos cargar la unidad seleccionada\./)).toBeInTheDocument(),
    );
    expect(screen.queryByText("v-rota")).not.toBeInTheDocument();
    // Aunque no se pudo mostrar, se puede desvincular.
    expect(screen.getByRole("button", { name: "Quitar vínculo" })).toBeInTheDocument();
  });
});
