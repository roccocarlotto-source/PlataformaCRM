import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { cellByHeader } from "../../test/cellByHeader";
import { makeBranch } from "../../test/branchFixtures";
import { makeUser } from "../../test/userFixtures";
import { makeVehicleListItem } from "../../test/vehicleFixtures";
import { openActionsMenu } from "../../test/openActionsMenu";
import { VehicleListPage } from "./VehicleListPage";
import type { AuthContextValue } from "../../auth/AuthContext";
import type { VehicleListItem } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

function mockAuth(role: "ADMIN" | "USER"): AuthContextValue {
  return {
    status: "authenticated",
    me: {
      id: "u1",
      email: "a@x.com",
      fullName: "A",
      organizationId: "org-1",
      role,
      isPlatformAdmin: false,
    },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

const baseUrl = `${env.apiUrl}/api/vehicles`;
const usersUrl = `${env.apiUrl}/api/users`;
const branchesUrl = `${env.apiUrl}/api/branches`;

// BranchSelect se monta siempre (filtro Sucursal), así que todo test necesita
// este handler — con onUnhandledRequest:"error" su ausencia deja al selector
// en error con un <p role="alert"> propio que ensucia cualquier getByRole.
function branchesHandler() {
  return http.get(branchesUrl, () =>
    HttpResponse.json({
      data: [makeBranch({ id: "b1", name: "Casa Central" })],
      pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    }),
  );
}

// Solo con rol ADMIN: useOwnerNames(isAdmin) dispara GET /api/users. Los tests
// con rol USER deliberadamente NO lo incluyen — que la request no exista es
// parte de lo que prueban (mismo criterio que CompanyListPage.test.tsx).
function usersHandler() {
  return http.get(usersUrl, () =>
    HttpResponse.json({
      data: [makeUser({ id: "u1", fullName: "Ana Pérez" })],
      pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    }),
  );
}

// Un solo handler de GET /vehicles atiende el listado (pageSize=20) y los dos
// KPI (pageSize=1, con y sin status). Distingue por la query, como haría el
// backend real.
function vehiclesHandler(
  vehicles: VehicleListItem[],
  options: { totalPages?: number; inStock?: number; available?: number; capture?: URL[] } = {},
) {
  return http.get(baseUrl, ({ request }) => {
    const url = new URL(request.url);
    options.capture?.push(url);
    if (url.searchParams.get("pageSize") === "1") {
      const total = url.searchParams.has("status")
        ? (options.available ?? vehicles.filter((v) => v.status === "AVAILABLE").length)
        : (options.inStock ?? vehicles.length);
      return HttpResponse.json({
        data: vehicles.slice(0, 1),
        pagination: { page: 1, pageSize: 1, total, totalPages: total },
      });
    }
    return HttpResponse.json({
      data: vehicles,
      pagination: {
        page: 1,
        pageSize: 20,
        total: vehicles.length,
        totalPages: options.totalPages ?? (vehicles.length === 0 ? 0 : 1),
      },
    });
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <VehicleListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("VehicleListPage", () => {
  it("USER no ve Nueva unidad / Editar / Eliminar ni la columna Vendedor, y no pide /api/users", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    let usersRequestCount = 0;
    server.use(
      branchesHandler(),
      vehiclesHandler([makeVehicleListItem({ assignedSalespersonId: "u1" })]),
      http.get(usersUrl, () => {
        usersRequestCount += 1;
        return HttpResponse.json({
          data: [makeUser()],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      }),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Toyota Corolla 2020")).toBeInTheDocument());
    expect(screen.queryByText("Nueva unidad")).not.toBeInTheDocument();
    expect(screen.queryByText("Editar")).not.toBeInTheDocument();
    expect(screen.queryByText("Eliminar")).not.toBeInTheDocument();
    expect(screen.queryByText("Vendedor")).not.toBeInTheDocument();
    expect(screen.queryByText("u1")).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(usersRequestCount).toBe(0);
  });

  it("ADMIN ve Nueva unidad / Editar / Eliminar y el vendedor resuelto a nombre", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      branchesHandler(),
      usersHandler(),
      vehiclesHandler([makeVehicleListItem({ assignedSalespersonId: "u1", trim: "XEi" })]),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Toyota Corolla 2020 XEi")).toBeInTheDocument());
    expect(screen.getByText("Nueva unidad")).toHaveAttribute("href", "/vehicles/new");
    // Editar/Eliminar viven en el menú de 3 puntos de la fila (§8); Editar
    // sigue siendo un link con href real.
    await openActionsMenu(userEvent.setup());
    expect(screen.getByText("Editar")).toHaveAttribute("href", "/vehicles/v1/edit");
    expect(screen.getByText("Eliminar")).toBeInTheDocument();
    // El código interno va chico debajo del título de la unidad.
    expect(screen.getByText("STK-000001")).toBeInTheDocument();
    await waitFor(() => {
      const fila = screen.getByText("Toyota Corolla 2020 XEi").closest("tr");
      expect(cellByHeader(fila, "Vendedor")).toHaveTextContent("Ana Pérez");
    });
  });

  it("una unidad sin vendedor muestra el guion, no un id ni un nombre ajeno", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      branchesHandler(),
      usersHandler(),
      vehiclesHandler([makeVehicleListItem({ assignedSalespersonId: null })]),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Vendedor")).toBeInTheDocument());
    const fila = screen.getByText("Toyota Corolla 2020").closest("tr");
    expect(cellByHeader(fila, "Vendedor")).toHaveTextContent("—");
    expect(fila).not.toHaveTextContent("Ana Pérez");
  });

  it("KPIs: 'Unidades en stock' y 'Disponibles' salen de pagination.total con pageSize=1", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      branchesHandler(),
      usersHandler(),
      vehiclesHandler([makeVehicleListItem()], { inStock: 42, available: 17 }),
    );

    renderPage();

    const resumen = within(await screen.findByRole("region", { name: "Resumen de stock" }));
    await waitFor(() => expect(resumen.getByText("42")).toBeInTheDocument());
    expect(resumen.getByText("17")).toBeInTheDocument();
    expect(resumen.getByText("Unidades en stock")).toBeInTheDocument();
    expect(resumen.getByText("Disponibles")).toBeInTheDocument();
    // Nada de "Valor de stock" ni "Días promedio": el backend no tiene SUM/AVG.
    expect(resumen.queryByText(/valor de stock/i)).not.toBeInTheDocument();
    expect(resumen.queryByText(/días promedio/i)).not.toBeInTheDocument();
  });

  it("Precio: formateado en USD, 'Consultar precio' si priceOnRequest, '—' sin precio", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    server.use(
      branchesHandler(),
      vehiclesHandler([
        makeVehicleListItem({ id: "v1", make: "Toyota", priceListUsd: "25000.00" }),
        makeVehicleListItem({
          id: "v2",
          make: "Ford",
          priceListUsd: "30000",
          priceOnRequest: true,
        }),
        makeVehicleListItem({ id: "v3", make: "Fiat", priceListUsd: null }),
      ]),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Toyota Corolla 2020")).toBeInTheDocument());
    expect(
      cellByHeader(screen.getByText("Toyota Corolla 2020").closest("tr"), "Precio"),
    ).toHaveTextContent("25000.00 USD");
    expect(
      cellByHeader(screen.getByText("Ford Corolla 2020").closest("tr"), "Precio"),
    ).toHaveTextContent("Consultar precio");
    expect(
      cellByHeader(screen.getByText("Fiat Corolla 2020").closest("tr"), "Precio"),
    ).toHaveTextContent("—");
  });

  it("Foto: miniatura con la portada firmada que trae el listado; placeholder 'Sin foto' (sin <img>) cuando coverPhotoUrl es null", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    server.use(
      branchesHandler(),
      vehiclesHandler([
        makeVehicleListItem({
          id: "v1",
          make: "Toyota",
          coverPhotoUrl: "https://storage.test.local/signed/p1.jpg?token=abc",
        }),
        makeVehicleListItem({ id: "v2", make: "Ford", coverPhotoUrl: null }),
      ]),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Toyota Corolla 2020")).toBeInTheDocument());
    const fotoDe = (unidad: string) => cellByHeader(screen.getByText(unidad).closest("tr"), "Foto");

    const conPortada = fotoDe("Toyota Corolla 2020");
    expect(conPortada?.querySelector("img")).toHaveAttribute(
      "src",
      "https://storage.test.local/signed/p1.jpg?token=abc",
    );
    expect(conPortada?.querySelector("img")).toHaveClass("ds-thumb");

    const sinFotos = fotoDe("Ford Corolla 2020");
    expect(sinFotos?.querySelector("img")).toBeNull();
    expect(sinFotos?.querySelector('[role="img"]')).toHaveAccessibleName("Sin foto");
  });

  it("Estado: badge con el rótulo en español y el color que decide el feature", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    server.use(
      branchesHandler(),
      vehiclesHandler([
        makeVehicleListItem({ id: "v1", make: "Toyota", status: "AVAILABLE" }),
        makeVehicleListItem({ id: "v2", make: "Ford", status: "RESERVED" }),
        makeVehicleListItem({ id: "v3", make: "Fiat", status: "SOLD" }),
      ]),
    );

    renderPage();

    // Por fila y por cabecera: el filtro Estado también puede decir
    // "Disponible" (en el botón cerrado o en sus opciones), así que un
    // getByText suelto no alcanza.
    await waitFor(() => expect(screen.getByText("Toyota Corolla 2020")).toBeInTheDocument());
    const badgeDe = (unidad: string) =>
      cellByHeader(screen.getByText(unidad).closest("tr"), "Estado")?.querySelector(".ds-badge");
    expect(badgeDe("Toyota Corolla 2020")).toHaveTextContent("Disponible");
    expect(badgeDe("Toyota Corolla 2020")).toHaveClass("ds-badge--success");
    expect(badgeDe("Ford Corolla 2020")).toHaveTextContent("Reservado");
    expect(badgeDe("Ford Corolla 2020")).toHaveClass("ds-badge--info");
    expect(badgeDe("Fiat Corolla 2020")).toHaveTextContent("Vendido");
    expect(badgeDe("Fiat Corolla 2020")).toHaveClass("ds-badge--neutral");
  });

  it("error de listado se muestra como estado de error real", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    server.use(
      branchesHandler(),
      http.get(baseUrl, () => HttpResponse.json({ error: { message: "boom" } }, { status: 500 })),
    );

    renderPage();

    // El listado y los dos KPI fallan los tres con el mismo mensaje.
    await waitFor(() =>
      expect(screen.getByText(/No pudimos cargar el stock: boom/)).toBeInTheDocument(),
    );
  });

  it("empty state cuando data está vacía", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    server.use(branchesHandler(), vehiclesHandler([]));

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("No hay unidades para mostrar.")).toBeInTheDocument(),
    );
  });

  it("filtros producen la query esperada y resetean la página", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    const captured: URL[] = [];
    server.use(
      branchesHandler(),
      vehiclesHandler([makeVehicleListItem()], { totalPages: 5, capture: captured }),
    );
    const user = userEvent.setup();

    renderPage();
    await waitFor(() => expect(screen.getByText("Toyota Corolla 2020")).toBeInTheDocument());

    // Solo las requests del listado (pageSize=20), no las de los KPI.
    const lastListQuery = () =>
      captured.filter((url) => url.searchParams.get("pageSize") === "20").at(-1)?.searchParams;

    await user.click(screen.getByText("Siguiente"));
    await waitFor(() => expect(lastListQuery()?.get("page")).toBe("2"));

    // status es multi-selección (MultiSelect: se abre el botón y se tildan
    // checkboxes): dos valores -> dos parámetros repetidos, y la página vuelve
    // a 1. Se tildan al revés del orden del enum a propósito: la query sale
    // en el orden de las opciones, no en el de los clicks.
    await user.click(screen.getByLabelText("Estado", { selector: "button" }));
    await user.click(screen.getByRole("checkbox", { name: "Reservado" }));
    await user.click(screen.getByRole("checkbox", { name: "Disponible" }));
    await waitFor(() =>
      expect(lastListQuery()?.getAll("status")).toEqual(["AVAILABLE", "RESERVED"]),
    );
    expect(lastListQuery()?.get("page")).toBe("1");
    expect(screen.getByLabelText("Estado", { selector: "button" })).toHaveTextContent(
      "2 seleccionados",
    );
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.getByLabelText("Sucursal")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Sucursal"), "b1");
    await waitFor(() => expect(lastListQuery()?.get("branchId")).toBe("b1"));

    await user.selectOptions(screen.getByLabelText("Condición"), "NEW");
    await waitFor(() => expect(lastListQuery()?.get("condition")).toBe("NEW"));

    await user.type(screen.getByLabelText("Marca"), "Toyota");
    await waitFor(() => expect(lastListQuery()?.get("make")).toBe("Toyota"));

    await user.type(screen.getByLabelText("Modelo"), "Corolla");
    await waitFor(() => expect(lastListQuery()?.get("model")).toBe("Corolla"));

    await user.type(screen.getByLabelText("Precio mín. (USD)"), "1000");
    await waitFor(() => expect(lastListQuery()?.get("minPriceUsd")).toBe("1000"));

    await user.type(screen.getByLabelText("Precio máx. (USD)"), "50000");
    await waitFor(() => expect(lastListQuery()?.get("maxPriceUsd")).toBe("50000"));

    expect(lastListQuery()?.has("consignmentOnly")).toBe(false);
    await user.click(screen.getByLabelText("Solo consignación"));
    await waitFor(() => expect(lastListQuery()?.get("consignmentOnly")).toBe("true"));

    await user.selectOptions(screen.getByLabelText("Ordenar por"), "priceListUsd");
    await waitFor(() => expect(lastListQuery()?.get("sortBy")).toBe("priceListUsd"));
  });

  it("cancelar window.confirm no envía DELETE", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    let deleteCalled = false;
    server.use(
      branchesHandler(),
      usersHandler(),
      vehiclesHandler([makeVehicleListItem()]),
      http.delete(`${baseUrl}/:id`, () => {
        deleteCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(false);

    const user = userEvent.setup();
    renderPage();

    await openActionsMenu(user);
    await user.click(screen.getByText("Eliminar"));

    expect(window.confirm).toHaveBeenCalled();
    expect(deleteCalled).toBe(false);
  });

  it("confirmar window.confirm envía DELETE al id correcto; un fallo se muestra", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    let deletedId: string | undefined;
    server.use(
      branchesHandler(),
      usersHandler(),
      vehiclesHandler([makeVehicleListItem({ id: "v-target" })]),
      http.delete(`${baseUrl}/:id`, ({ params }) => {
        deletedId = params.id as string;
        return HttpResponse.json({ error: { message: "no se pudo dar de baja" } }, { status: 500 });
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();
    renderPage();

    await openActionsMenu(user);
    await user.click(screen.getByText("Eliminar"));

    await waitFor(() => expect(deletedId).toBe("v-target"));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("no se pudo dar de baja"),
    );
  });
});
