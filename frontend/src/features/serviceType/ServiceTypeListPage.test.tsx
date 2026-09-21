import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeBranch } from "../../test/branchFixtures";
import { makeResource } from "../../test/resourceFixtures";
import { makeServiceType } from "../../test/serviceTypeFixtures";
import { cellByHeader } from "../../test/cellByHeader";
import { chooseSelectOption, listSelectOptions } from "../../test/chooseSelectOption";
import { openActionsMenu } from "../../test/openActionsMenu";
import { ServiceTypeListPage } from "./ServiceTypeListPage";
import type { ServiceType } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/service-types`;

function catalogHandlers() {
  return [
    http.get(`${env.apiUrl}/api/branches`, () =>
      HttpResponse.json({
        data: [makeBranch(), makeBranch({ id: "b2", name: "Sucursal Chuy" })],
        pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
      }),
    ),
    http.get(`${env.apiUrl}/api/resources`, () =>
      HttpResponse.json({
        data: [
          makeResource({ id: "r1", name: "Dra. López", branchId: "b1" }),
          makeResource({ id: "r2", name: "Sala de yoga", branchId: "b2", type: "ROOM" }),
        ],
        pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
      }),
    ),
  ];
}

function listHandler(data: ServiceType[], onRequest?: (url: URL) => void) {
  return http.get(baseUrl, ({ request }) => {
    onRequest?.(new URL(request.url));
    return HttpResponse.json({
      data,
      pagination: { page: 1, pageSize: 20, total: data.length, totalPages: 1 },
    });
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ServiceTypeListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ServiceTypeListPage", () => {
  it("resuelve recurso y sucursal por nombre, y muestra la duración legible y el cupo", async () => {
    server.use(
      ...catalogHandlers(),
      listHandler([
        makeServiceType({
          name: "Yoga",
          resourceId: "r2",
          branchId: "b2",
          durationMin: 90,
          capacity: 12,
        }),
      ]),
    );

    renderPage();

    const fila = (await screen.findByText("Yoga")).closest("tr");
    await waitFor(() => expect(cellByHeader(fila, "Recurso")).toHaveTextContent("Sala de yoga"));
    expect(cellByHeader(fila, "Sucursal")).toHaveTextContent("Sucursal Chuy");
    expect(cellByHeader(fila, "Duración")).toHaveTextContent("1 h 30 min");
    expect(cellByHeader(fila, "Cupo")).toHaveTextContent("12");
  });

  it("sin tipos de servicio muestra el estado vacío", async () => {
    server.use(...catalogHandlers(), listHandler([]));
    renderPage();
    expect(await screen.findByText("No hay tipos de servicio para mostrar.")).toBeInTheDocument();
  });

  it("el filtro de Recurso solo ofrece los de la sucursal elegida, y cambiar de sucursal lo limpia", async () => {
    const urls: URL[] = [];
    server.use(
      ...catalogHandlers(),
      listHandler([makeServiceType()], (url) => urls.push(url)),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Consulta general");

    await chooseSelectOption(user, screen.getByLabelText("Sucursal"), "Casa Central");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("branchId")).toBe("b1"));
    expect(await listSelectOptions(user, await screen.findByLabelText("Recurso"))).toEqual([
      "Todos",
      "Dra. López",
    ]);
    await user.click(screen.getByRole("option", { name: "Dra. López" }));
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("resourceId")).toBe("r1"));

    await chooseSelectOption(user, screen.getByLabelText("Sucursal"), "Sucursal Chuy");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("branchId")).toBe("b2"));
    expect(urls.at(-1)?.searchParams.has("resourceId")).toBe(false);
  });

  it("Editar lleva al formulario y Eliminar pregunta antes de borrar", async () => {
    let deleted = false;
    server.use(
      ...catalogHandlers(),
      listHandler([makeServiceType({ id: "s7" })]),
      http.delete(`${baseUrl}/:id`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderPage();

    await openActionsMenu(user);
    expect(screen.getByRole("menuitem", { name: "Editar" })).toHaveAttribute(
      "href",
      "/service-types/s7/edit",
    );
    await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));
    expect(confirmSpy).toHaveBeenCalledWith("¿Eliminar este tipo de servicio?");
    await waitFor(() => expect(deleted).toBe(true));
    confirmSpy.mockRestore();
  });
});
