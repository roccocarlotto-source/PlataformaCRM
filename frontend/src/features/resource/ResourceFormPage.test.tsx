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
import { chooseSelectOption } from "../../test/chooseSelectOption";
import { ResourceFormPage } from "./ResourceFormPage";
import type { WorkingHoursPayload, WorkingHoursSlot } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/resources`;
const branchesUrl = `${env.apiUrl}/api/branches`;

function branchesHandler() {
  return http.get(branchesUrl, () =>
    HttpResponse.json({
      data: [makeBranch(), makeBranch({ id: "b2", name: "Sucursal Chuy" })],
      pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
    }),
  );
}

function renderForm(ruta: string, ...handlers: HttpHandler[]) {
  server.use(...handlers, branchesHandler());
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route path="/resources/new" element={<ResourceFormPage />} />
          <Route path="/resources/:id/edit" element={<ResourceFormPage />} />
          <Route path="/resources" element={<p>listado</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// El recurso r1 con el horario que se le pase, más PATCH/PUT que capturan lo
// que viaja. putStatus permite simular que el PUT falla.
function editHandlers(
  horario: WorkingHoursSlot[],
  captura: { patch?: unknown; put?: unknown },
  putStatus = 200,
) {
  return [
    http.get(`${baseUrl}/:id`, () =>
      HttpResponse.json(makeResource({ id: "r1", name: "Dra. López", type: "PERSON" })),
    ),
    http.get(`${baseUrl}/:id/working-hours`, () => HttpResponse.json({ workingHours: horario })),
    http.patch(`${baseUrl}/:id`, async ({ request }) => {
      captura.patch = await request.json();
      return HttpResponse.json(makeResource({ id: "r1" }));
    }),
    http.put(`${baseUrl}/:id/working-hours`, async ({ request }) => {
      captura.put = await request.json();
      if (putStatus !== 200) {
        return HttpResponse.json(
          { error: { message: "Hay franjas superpuestas el día MONDAY" } },
          { status: putStatus },
        );
      }
      return HttpResponse.json(captura.put as WorkingHoursPayload);
    }),
  ];
}

describe("ResourceFormPage — creación", () => {
  it("crea con sucursal, nombre y tipo, y NO muestra el horario (el recurso todavía no tiene id)", async () => {
    let body: unknown;
    const user = userEvent.setup();
    renderForm(
      "/resources/new",
      http.post(baseUrl, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeResource(), { status: 201 });
      }),
    );

    expect(screen.queryByText("Horario laboral")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Nombre"), "Sala 2");
    await chooseSelectOption(user, screen.getByLabelText("Tipo"), "Sala");
    await chooseSelectOption(user, await screen.findByLabelText("Sucursal"), "Sucursal Chuy");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(body).toEqual({ branchId: "b2", name: "Sala 2", type: "ROOM" }));
    await waitFor(() => expect(screen.getByText("listado")).toBeInTheDocument());
  });

  it("sin sucursal no manda nada: el combobox obligatorio frena el envío", async () => {
    let called = false;
    const user = userEvent.setup();
    renderForm(
      "/resources/new",
      http.post(baseUrl, () => {
        called = true;
        return HttpResponse.json(makeResource(), { status: 201 });
      }),
    );

    await user.type(screen.getByLabelText("Nombre"), "Sala 2");
    await chooseSelectOption(user, screen.getByLabelText("Tipo"), "Sala");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    // El `required` del combobox lo frena el propio <form>; el mensaje de
    // handleSubmit cubre el hueco de cuando la lista todavía está cargando.
    expect(await screen.findByLabelText("Sucursal")).toBeInvalid();
    expect(called).toBe(false);
    expect(screen.queryByText("listado")).not.toBeInTheDocument();
  });
});

describe("ResourceFormPage — edición y horario laboral", () => {
  it("hidrata los datos, muestra la sucursal deshabilitada y carga las franjas por día", async () => {
    renderForm(
      "/resources/r1/edit",
      ...editHandlers(
        [
          { weekday: "MONDAY", startTime: "14:00", endTime: "18:00" },
          { weekday: "MONDAY", startTime: "09:00", endTime: "13:00" },
          { weekday: "SATURDAY", startTime: "10:00", endTime: "24:00" },
        ],
        {},
      ),
    );

    expect(await screen.findByLabelText("Nombre")).toHaveValue("Dra. López");
    expect(screen.getByLabelText("Tipo")).toHaveValue("Persona");
    expect(await screen.findByLabelText("Sucursal")).toBeDisabled();
    expect(screen.getByText("Horario laboral")).toBeInTheDocument();

    // Ordenadas por inicio aunque el backend las mande desordenadas.
    expect(screen.getByLabelText("Lunes, franja 1: desde")).toHaveValue("09:00");
    expect(screen.getByLabelText("Lunes, franja 2: desde")).toHaveValue("14:00");
    // "24:00" se conserva: por eso las horas son texto y no <input type="time">.
    expect(screen.getByLabelText("Sábado, franja 1: hasta")).toHaveValue("24:00");
    // Un día sin franjas dice que no atiende.
    expect(screen.getAllByText("No atiende.")).toHaveLength(5);
  });

  it("guardar manda el PATCH sin branchId y el PUT con la semana ENTERA, incluida la franja agregada", async () => {
    const captura: { patch?: unknown; put?: unknown } = {};
    const user = userEvent.setup();
    renderForm(
      "/resources/r1/edit",
      ...editHandlers([{ weekday: "MONDAY", startTime: "09:00", endTime: "13:00" }], captura),
    );

    await screen.findByLabelText("Lunes, franja 1: desde");
    // La franja sugerida después de una mañana arranca donde terminó la anterior.
    await user.click(screen.getByRole("button", { name: "Agregar una franja al Lunes" }));
    expect(screen.getByLabelText("Lunes, franja 2: desde")).toHaveValue("13:00");
    const hasta = screen.getByLabelText("Lunes, franja 2: hasta");
    await user.clear(hasta);
    await user.type(hasta, "17:00");
    // Y un día vacío arranca con 09:00–18:00.
    await user.click(screen.getByRole("button", { name: "Agregar una franja al Miércoles" }));

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(captura.put).toBeDefined());
    expect(captura.patch).toEqual({ name: "Dra. López", type: "PERSON" });
    expect(captura.put).toEqual({
      workingHours: [
        { weekday: "MONDAY", startTime: "09:00", endTime: "13:00" },
        { weekday: "MONDAY", startTime: "13:00", endTime: "17:00" },
        { weekday: "WEDNESDAY", startTime: "09:00", endTime: "18:00" },
      ],
    });
    await waitFor(() => expect(screen.getByText("listado")).toBeInTheDocument());
  });

  it("quitar todas las franjas es válido: el PUT viaja con un arreglo vacío (el recurso no atiende)", async () => {
    const captura: { patch?: unknown; put?: unknown } = {};
    const user = userEvent.setup();
    renderForm(
      "/resources/r1/edit",
      ...editHandlers([{ weekday: "FRIDAY", startTime: "09:00", endTime: "13:00" }], captura),
    );

    await user.click(await screen.findByRole("button", { name: "Quitar la franja 1 del Viernes" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(captura.put).toEqual({ workingHours: [] }));
  });

  it("dos franjas superpuestas del mismo día frenan el guardado ANTES de mandar nada", async () => {
    const captura: { patch?: unknown; put?: unknown } = {};
    const user = userEvent.setup();
    renderForm(
      "/resources/r1/edit",
      ...editHandlers(
        [
          { weekday: "TUESDAY", startTime: "09:00", endTime: "13:00" },
          { weekday: "TUESDAY", startTime: "15:00", endTime: "18:00" },
        ],
        captura,
      ),
    );

    const desde = await screen.findByLabelText("Martes, franja 2: desde");
    await user.clear(desde);
    await user.type(desde, "12:00");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Martes: las franjas 09:00–13:00 y 12:00–18:00 se superponen.",
    );
    expect(captura.patch).toBeUndefined();
    expect(captura.put).toBeUndefined();
  });

  it("una hora mal escrita o una franja al revés también se frenan en el cliente", async () => {
    const captura: { patch?: unknown; put?: unknown } = {};
    const user = userEvent.setup();
    renderForm(
      "/resources/r1/edit",
      ...editHandlers([{ weekday: "THURSDAY", startTime: "09:00", endTime: "13:00" }], captura),
    );

    const hasta = await screen.findByLabelText("Jueves, franja 1: hasta");
    await user.clear(hasta);
    await user.type(hasta, "8:00");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Jueves: las horas tienen que tener formato HH:MM",
    );

    await user.clear(hasta);
    await user.type(hasta, "08:00");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Jueves: la franja 09:00–08:00 tiene que empezar antes de terminar.",
      ),
    );
    expect(captura.put).toBeUndefined();
  });

  it("si el PUT del horario falla, lo dice sin navegar y sin perder lo tipeado", async () => {
    const captura: { patch?: unknown; put?: unknown } = {};
    const user = userEvent.setup();
    renderForm(
      "/resources/r1/edit",
      ...editHandlers([{ weekday: "MONDAY", startTime: "09:00", endTime: "13:00" }], captura, 400),
    );

    await screen.findByLabelText("Lunes, franja 1: desde");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Los datos del recurso se guardaron, pero el horario no: Hay franjas superpuestas el día MONDAY",
    );
    expect(screen.queryByText("listado")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Lunes, franja 1: desde")).toHaveValue("09:00");
  });
});
