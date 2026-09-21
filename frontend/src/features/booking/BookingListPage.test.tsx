import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeBranch } from "../../test/branchFixtures";
import { makeContact } from "../../test/contactFixtures";
import { makeBooking } from "../../test/bookingFixtures";
import { makeResource } from "../../test/resourceFixtures";
import { makeServiceType } from "../../test/serviceTypeFixtures";
import { cellByHeader } from "../../test/cellByHeader";
import { chooseSelectOption } from "../../test/chooseSelectOption";
import { BookingListPage } from "./BookingListPage";
import { fechaAInstante, hoyComoFecha } from "./format";
import type { Booking } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/bookings`;

function catalogHandlers() {
  return [
    http.get(`${env.apiUrl}/api/branches`, () =>
      HttpResponse.json({
        data: [
          makeBranch({ id: "b1", name: "Casa Central", timezone: "America/Montevideo" }),
          makeBranch({ id: "b2", name: "Sucursal Santiago", timezone: "America/Santiago" }),
        ],
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
    http.get(`${env.apiUrl}/api/service-types`, () =>
      HttpResponse.json({
        data: [
          makeServiceType({ id: "s1", name: "Consulta general", resourceId: "r1", branchId: "b1" }),
          makeServiceType({ id: "s2", name: "Yoga", resourceId: "r2", branchId: "b2" }),
        ],
        pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
      }),
    ),
    http.get(`${env.apiUrl}/api/contacts/:id`, ({ params }) =>
      HttpResponse.json(
        makeContact({ id: String(params.id), firstName: "Ana", lastName: String(params.id) }),
      ),
    ),
  ];
}

function listHandler(data: Booking[], onRequest?: (url: URL) => void) {
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
        <BookingListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("BookingListPage", () => {
  it("muestra el turno en la zona de la SUCURSAL, con contacto, servicio, recurso y estado resueltos", async () => {
    server.use(
      ...catalogHandlers(),
      listHandler([
        // 12:00Z = 09:00 en Montevideo (UTC-3).
        makeBooking({
          id: "bk1",
          contactId: "c1",
          startsAt: "2026-09-22T12:00:00.000Z",
          endsAt: "2026-09-22T12:30:00.000Z",
        }),
      ]),
    );

    renderPage();

    const fila = (await screen.findByText(/09:00–09:30/)).closest("tr");
    expect(cellByHeader(fila, "Turno")).toHaveTextContent("22/09/2026");
    await waitFor(() => expect(cellByHeader(fila, "Contacto")).toHaveTextContent("Ana c1"));
    expect(cellByHeader(fila, "Servicio")).toHaveTextContent("Consulta general");
    expect(cellByHeader(fila, "Recurso")).toHaveTextContent("Dra. López");
    expect(cellByHeader(fila, "Sucursal")).toHaveTextContent("Casa Central");
    expect(cellByHeader(fila, "Estado")).toHaveTextContent("Confirmada");
  });

  it("arranca filtrando desde hoy, ordenado por fecha del turno ascendente", async () => {
    const urls: URL[] = [];
    server.use(
      ...catalogHandlers(),
      listHandler([], (url) => urls.push(url)),
    );
    renderPage();

    expect(await screen.findByText("No hay reservas para mostrar.")).toBeInTheDocument();
    const url = urls.at(-1);
    expect(url?.searchParams.get("from")).toBe(fechaAInstante(hoyComoFecha(), false));
    expect(url?.searchParams.has("to")).toBe(false);
    expect(url?.searchParams.get("sortBy")).toBe("startsAt");
    expect(url?.searchParams.get("sortOrder")).toBe("asc");
    expect(screen.getByLabelText("Desde")).toHaveValue(hoyComoFecha());
  });

  it("los filtros de sucursal, recurso, tipo de servicio, estado y fechas viajan en la query", async () => {
    const urls: URL[] = [];
    server.use(
      ...catalogHandlers(),
      listHandler([], (url) => urls.push(url)),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("No hay reservas para mostrar.");

    await chooseSelectOption(user, await screen.findByLabelText("Sucursal"), "Sucursal Santiago");
    await chooseSelectOption(user, await screen.findByLabelText("Recurso"), "Sala de yoga");
    await chooseSelectOption(user, screen.getByLabelText("Tipo de servicio"), "Yoga");
    await chooseSelectOption(user, screen.getByLabelText("Estado"), "Cancelada");

    const desde = screen.getByLabelText("Desde");
    await user.clear(desde);
    await user.type(desde, "2026-10-01");
    await user.type(screen.getByLabelText("Hasta"), "2026-10-31");

    await waitFor(() => {
      const url = urls.at(-1);
      expect(url?.searchParams.get("branchId")).toBe("b2");
      expect(url?.searchParams.get("resourceId")).toBe("r2");
      expect(url?.searchParams.get("serviceTypeId")).toBe("s2");
      expect(url?.searchParams.get("status")).toBe("CANCELLED");
      expect(url?.searchParams.get("from")).toBe(new Date(2026, 9, 1).toISOString());
      // `to` es exclusivo en el backend: el día elegido entra entero.
      expect(url?.searchParams.get("to")).toBe(new Date(2026, 10, 1).toISOString());
    });
  });

  it("vaciar Desde muestra el historial completo (sin `from`)", async () => {
    const urls: URL[] = [];
    server.use(
      ...catalogHandlers(),
      listHandler([], (url) => urls.push(url)),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("No hay reservas para mostrar.");

    await user.clear(screen.getByLabelText("Desde"));
    await waitFor(() => expect(urls.at(-1)?.searchParams.has("from")).toBe(false));
  });

  it("Cancelar solo aparece en las CONFIRMED, pregunta antes y manda el PATCH /cancel", async () => {
    let cancelado: string | undefined;
    server.use(
      ...catalogHandlers(),
      listHandler([
        makeBooking({ id: "bk1", status: "CONFIRMED", startsAt: "2026-09-22T12:00:00.000Z" }),
        makeBooking({
          id: "bk2",
          status: "COMPLETED",
          startsAt: "2026-09-23T12:00:00.000Z",
          endsAt: "2026-09-23T12:30:00.000Z",
        }),
      ]),
      http.patch(`${baseUrl}/:id/cancel`, ({ params }) => {
        cancelado = String(params.id);
        return HttpResponse.json(makeBooking({ id: String(params.id), status: "CANCELLED" }));
      }),
    );
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    const user = userEvent.setup();
    renderPage();

    const confirmada = (await screen.findByText(/22\/09\/2026/)).closest("tr") as HTMLElement;
    const completada = screen.getByText(/23\/09\/2026/).closest("tr") as HTMLElement;
    expect(within(completada).queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();

    await user.click(within(confirmada).getByRole("button", { name: "Cancelar" }));
    expect(confirmSpy).toHaveBeenCalledWith(
      "¿Cancelar esta reserva? El turno queda libre y no se puede deshacer.",
    );
    expect(cancelado).toBeUndefined();

    confirmSpy.mockReturnValueOnce(true);
    await user.click(within(confirmada).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(cancelado).toBe("bk1"));
    confirmSpy.mockRestore();
  });

  it("un error al cancelar se muestra con el mensaje del backend", async () => {
    server.use(
      ...catalogHandlers(),
      listHandler([makeBooking({ id: "bk1" })]),
      http.patch(`${baseUrl}/:id/cancel`, () =>
        HttpResponse.json(
          { error: { message: "Esta reserva ya estaba cancelada" } },
          { status: 409 },
        ),
      ),
    );
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos cancelar la reserva: Esta reserva ya estaba cancelada",
    );
    confirmSpy.mockRestore();
  });
});
