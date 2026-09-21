import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse, type HttpHandler } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeBranch } from "../../test/branchFixtures";
import { makeResource } from "../../test/resourceFixtures";
import { makeServiceType } from "../../test/serviceTypeFixtures";
import { chooseSelectOption, listSelectOptions } from "../../test/chooseSelectOption";
import { ServiceTypeFormPage } from "./ServiceTypeFormPage";

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

function renderForm(ruta: string, ...handlers: HttpHandler[]) {
  server.use(...handlers, ...catalogHandlers());
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route path="/service-types/new" element={<ServiceTypeFormPage />} />
          <Route path="/service-types/:id/edit" element={<ServiceTypeFormPage />} />
          <Route path="/service-types" element={<p>listado</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ServiceTypeFormPage — creación", () => {
  it("el recurso está deshabilitado hasta elegir sucursal, y después solo ofrece los de esa sucursal", async () => {
    const user = userEvent.setup();
    renderForm("/service-types/new");

    expect(await screen.findByLabelText("Recurso")).toBeDisabled();
    await chooseSelectOption(user, await screen.findByLabelText("Sucursal"), "Sucursal Chuy");
    const recurso = screen.getByLabelText("Recurso");
    expect(recurso).toBeEnabled();
    expect(await listSelectOptions(user, recurso)).toEqual(["Elegir recurso…", "Sala de yoga"]);
  });

  it("crea sin cupo (lo pone el backend) y vuelve al listado", async () => {
    let body: unknown;
    const user = userEvent.setup();
    renderForm(
      "/service-types/new",
      http.post(baseUrl, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeServiceType(), { status: 201 });
      }),
    );

    await user.type(screen.getByLabelText("Nombre"), "Consulta");
    await chooseSelectOption(user, await screen.findByLabelText("Sucursal"), "Casa Central");
    await chooseSelectOption(user, screen.getByLabelText("Recurso"), "Dra. López");
    await user.type(screen.getByLabelText("Duración (minutos)"), "45");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(body).toEqual({ branchId: "b1", resourceId: "r1", name: "Consulta", durationMin: 45 }),
    );
    await waitFor(() => expect(screen.getByText("listado")).toBeInTheDocument());
  });

  it("con cupo, el cupo viaja como número", async () => {
    let body: unknown;
    const user = userEvent.setup();
    renderForm(
      "/service-types/new",
      http.post(baseUrl, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeServiceType(), { status: 201 });
      }),
    );

    await user.type(screen.getByLabelText("Nombre"), "Yoga");
    await chooseSelectOption(user, await screen.findByLabelText("Sucursal"), "Sucursal Chuy");
    await chooseSelectOption(user, screen.getByLabelText("Recurso"), "Sala de yoga");
    await user.type(screen.getByLabelText("Duración (minutos)"), "60");
    await user.type(screen.getByLabelText("Cupo"), "12");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(body).toEqual({
        branchId: "b2",
        resourceId: "r2",
        name: "Yoga",
        durationMin: 60,
        capacity: 12,
      }),
    );
  });
});

describe("ServiceTypeFormPage — edición", () => {
  function editHandlers(captura: { body?: unknown }) {
    return [
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json(
          makeServiceType({ id: "s1", name: "Consulta general", durationMin: 30, capacity: 1 }),
        ),
      ),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        captura.body = await request.json();
        return HttpResponse.json(makeServiceType());
      }),
    ];
  }

  it("hidrata los campos y el PATCH manda sucursal y recurso JUNTOS", async () => {
    const captura: { body?: unknown } = {};
    const user = userEvent.setup();
    renderForm("/service-types/s1/edit", ...editHandlers(captura));

    expect(await screen.findByLabelText("Nombre")).toHaveValue("Consulta general");
    expect(screen.getByLabelText("Duración (minutos)")).toHaveValue(30);
    expect(await screen.findByLabelText("Recurso")).toHaveValue("Dra. López");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(captura.body).toEqual({
        branchId: "b1",
        resourceId: "r1",
        name: "Consulta general",
        durationMin: 30,
        capacity: 1,
      }),
    );
  });

  it("cambiar la sucursal vacía el recurso: el form obliga a elegir uno de la sucursal nueva", async () => {
    const captura: { body?: unknown } = {};
    const user = userEvent.setup();
    renderForm("/service-types/s1/edit", ...editHandlers(captura));

    expect(await screen.findByLabelText("Recurso")).toHaveValue("Dra. López");
    await chooseSelectOption(user, screen.getByLabelText("Sucursal"), "Sucursal Chuy");
    expect(screen.getByLabelText("Recurso")).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(captura.body).toBeUndefined();

    await chooseSelectOption(user, screen.getByLabelText("Recurso"), "Sala de yoga");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(captura.body).toMatchObject({ branchId: "b2", resourceId: "r2" }));
  });

  it("un error del backend se muestra sin navegar", async () => {
    const user = userEvent.setup();
    renderForm(
      "/service-types/s1/edit",
      http.get(`${baseUrl}/:id`, () => HttpResponse.json(makeServiceType({ id: "s1" }))),
      http.patch(`${baseUrl}/:id`, () =>
        HttpResponse.json(
          {
            error: {
              message:
                "No se puede mover a otro recurso un servicio que tiene reservas activas. Cancelalas primero.",
            },
          },
          { status: 400 },
        ),
      ),
    );

    await screen.findByLabelText("Nombre");
    await screen.findByLabelText("Recurso");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/reservas activas/);
    expect(screen.queryByText("listado")).not.toBeInTheDocument();
  });
});
