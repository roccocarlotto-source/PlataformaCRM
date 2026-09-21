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
import { cellByHeader } from "../../test/cellByHeader";
import { chooseSelectOption } from "../../test/chooseSelectOption";
import { openActionsMenu } from "../../test/openActionsMenu";
import { ResourceListPage } from "./ResourceListPage";
import type { Resource } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/resources`;
const branchesUrl = `${env.apiUrl}/api/branches`;

function mockBranches() {
  return http.get(branchesUrl, () =>
    HttpResponse.json({
      data: [makeBranch(), makeBranch({ id: "b2", name: "Sucursal Chuy" })],
      pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
    }),
  );
}

function listHandler(data: Resource[], onRequest?: (url: URL) => void) {
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
        <ResourceListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ResourceListPage", () => {
  it("muestra nombre, tipo traducido y la sucursal por nombre", async () => {
    server.use(
      mockBranches(),
      listHandler([makeResource({ id: "r9", name: "Sala grande", type: "ROOM", branchId: "b2" })]),
    );

    renderPage();

    const fila = (await screen.findByText("Sala grande")).closest("tr");
    expect(cellByHeader(fila, "Tipo")).toHaveTextContent("Sala");
    expect(cellByHeader(fila, "Sucursal")).toHaveTextContent("Sucursal Chuy");
  });

  it("sin recursos muestra el estado vacío", async () => {
    server.use(mockBranches(), listHandler([]));
    renderPage();
    expect(await screen.findByText("No hay recursos para mostrar.")).toBeInTheDocument();
  });

  it("filtrar por sucursal y por tipo viaja en la query y vuelve a la página 1", async () => {
    const urls: URL[] = [];
    server.use(
      mockBranches(),
      listHandler([makeResource()], (url) => urls.push(url)),
    );

    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Dra. López");

    await chooseSelectOption(user, screen.getByLabelText("Sucursal"), "Sucursal Chuy");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("branchId")).toBe("b2"));

    await chooseSelectOption(user, screen.getByLabelText("Tipo"), "Clase");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("type")).toBe("CLASS"));
    expect(urls.at(-1)?.searchParams.get("page")).toBe("1");
  });

  it("Editar lleva al formulario del recurso", async () => {
    server.use(mockBranches(), listHandler([makeResource({ id: "r7" })]));
    const user = userEvent.setup();
    renderPage();

    await openActionsMenu(user);
    expect(screen.getByRole("menuitem", { name: "Editar" })).toHaveAttribute(
      "href",
      "/resources/r7/edit",
    );
  });

  it("Eliminar pregunta antes; el RESTRICT del backend se muestra tal cual", async () => {
    let deleted = false;
    server.use(
      mockBranches(),
      listHandler([makeResource({ id: "r7" })]),
      http.delete(`${baseUrl}/:id`, () => {
        deleted = true;
        return HttpResponse.json(
          { error: { message: "No se puede eliminar un recurso con servicios activos" } },
          { status: 400 },
        );
      }),
    );
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    const user = userEvent.setup();
    renderPage();

    await openActionsMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));
    expect(confirmSpy).toHaveBeenCalledWith("¿Eliminar este recurso?");
    expect(deleted).toBe(false);

    confirmSpy.mockReturnValueOnce(true);
    await openActionsMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos eliminar el recurso: No se puede eliminar un recurso con servicios activos",
    );
    expect(deleted).toBe(true);
    confirmSpy.mockRestore();
  });
});
