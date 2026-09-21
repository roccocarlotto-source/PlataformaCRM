import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import type { AuthContextValue } from "../../auth/AuthContext";
import { makeBranch } from "../../test/branchFixtures";
import { makeContact } from "../../test/contactFixtures";
import { makeBooking } from "../../test/bookingFixtures";
import { makeResource } from "../../test/resourceFixtures";
import { makeServiceType } from "../../test/serviceTypeFixtures";
import { chooseSelectOption } from "../../test/chooseSelectOption";
import { BookingCalendarPage } from "./BookingCalendarPage";
import type { Booking } from "./types";

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

// Un lunes lejano en el futuro: la grilla no deja clickear lo que ya empezó,
// así que la fecha del test no puede depender del reloj real. Montevideo es
// UTC-3 fijo: 09:00 local = 12:00Z.
const LUNES = "2030-09-23";

const bookingsUrl = `${env.apiUrl}/api/bookings`;

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
          makeResource({ id: "r3", name: "Dr. Suárez", branchId: "b1" }),
          makeResource({ id: "r2", name: "Sala de yoga", branchId: "b2", type: "ROOM" }),
        ],
        pagination: { page: 1, pageSize: 100, total: 3, totalPages: 1 },
      }),
    ),
    // Lunes de 9 a 13 para todos los recursos.
    http.get(`${env.apiUrl}/api/resources/:id/working-hours`, () =>
      HttpResponse.json({
        workingHours: [{ weekday: "MONDAY", startTime: "09:00", endTime: "13:00" }],
      }),
    ),
    http.get(`${env.apiUrl}/api/service-types`, () =>
      HttpResponse.json({
        data: [
          makeServiceType({
            id: "s1",
            name: "Consulta general",
            resourceId: "r1",
            branchId: "b1",
            durationMin: 30,
          }),
          makeServiceType({ id: "s3", name: "Control", resourceId: "r3", branchId: "b1" }),
        ],
        pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
      }),
    ),
    http.get(`${env.apiUrl}/api/contacts`, () =>
      HttpResponse.json({
        data: [makeContact({ id: "c9", firstName: "Ana", lastName: "Pérez" })],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      }),
    ),
    http.get(`${env.apiUrl}/api/contacts/:id`, ({ params }) =>
      HttpResponse.json(
        makeContact({ id: String(params.id), firstName: "Ana", lastName: String(params.id) }),
      ),
    ),
  ];
}

// Reservas por recurso, como las pide cada columna (resourceId en la query).
function bookingsHandler(porRecurso: Record<string, Booking[]>, onRequest?: (url: URL) => void) {
  return http.get(bookingsUrl, ({ request }) => {
    const url = new URL(request.url);
    onRequest?.(url);
    const data = porRecurso[url.searchParams.get("resourceId") ?? ""] ?? [];
    return HttpResponse.json({
      data,
      pagination: { page: 1, pageSize: 100, total: data.length, totalPages: 1 },
    });
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <BookingCalendarPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function irAlLunes() {
  fireEvent.change(await screen.findByLabelText("Fecha"), { target: { value: LUNES } });
}

async function elegirContacto(user: UserEvent, panel: HTMLElement) {
  await user.type(within(panel).getByLabelText("Contacto"), "Ana");
  await user.click(await within(panel).findByRole("button", { name: "Ana Pérez" }));
  await within(panel).findByText(/Seleccionado: Ana/);
}

describe("BookingCalendarPage", () => {
  it("arranca en la primera sucursal, con una columna por recurso y las reservas del día pedidas por recurso", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    const urls: URL[] = [];
    server.use(
      ...catalogHandlers(),
      bookingsHandler(
        {
          r1: [
            makeBooking({
              id: "bk1",
              resourceId: "r1",
              contactId: "c1",
              startsAt: "2030-09-23T13:00:00.000Z",
              endsAt: "2030-09-23T13:30:00.000Z",
            }),
          ],
        },
        (url) => urls.push(url),
      ),
    );
    renderPage();
    await irAlLunes();

    expect(await screen.findByText("Dra. López")).toBeInTheDocument();
    expect(screen.getByText("Dr. Suárez")).toBeInTheDocument();
    expect(screen.queryByText("Sala de yoga")).not.toBeInTheDocument();

    // 13:00Z = 10:00 en Montevideo.
    expect(await screen.findByRole("button", { name: /10:00–10:30.*Ana c1/ })).toBeInTheDocument();

    await waitFor(() => {
      const delLunes = urls.filter(
        (url) => url.searchParams.get("from") === "2030-09-23T03:00:00.000Z",
      );
      expect(delLunes.map((url) => url.searchParams.get("resourceId")).sort()).toEqual([
        "r1",
        "r3",
      ]);
      expect(delLunes[0]?.searchParams.get("to")).toBe("2030-09-24T03:00:00.000Z");
      expect(delLunes[0]?.searchParams.get("status")).toBe("CONFIRMED");
    });
  });

  it("el filtro de recurso deja una sola columna", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    server.use(...catalogHandlers(), bookingsHandler({}));
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Dr. Suárez");
    await chooseSelectOption(user, await screen.findByLabelText("Recurso"), "Dra. López");

    await waitFor(() => expect(screen.queryByText("Dr. Suárez")).not.toBeInTheDocument());
  });

  it("USER: click en un horario libre → panel con el recurso y la hora fijos → crea la reserva y refresca la grilla", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    let bodies: unknown[] = [];
    let listados = 0;
    server.use(
      ...catalogHandlers(),
      bookingsHandler({}, () => {
        listados += 1;
      }),
      http.post(bookingsUrl, async ({ request }) => {
        bodies = [...bodies, await request.json()];
        return HttpResponse.json(makeBooking({ id: "nueva" }), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await irAlLunes();

    await user.click(
      await screen.findByRole("button", { name: "Reservar Dra. López a las 09:00" }),
    );
    const panel = await screen.findByRole("dialog", { name: "Nueva reserva" });
    expect(within(panel).getByText("Dra. López")).toBeInTheDocument();

    // Solo los servicios de ESE recurso.
    await user.click(within(panel).getByLabelText("Tipo de servicio"));
    expect(within(panel).queryByRole("option", { name: "Control" })).not.toBeInTheDocument();
    await user.click(within(panel).getByRole("option", { name: "Consulta general" }));
    expect(within(panel).getByText("09:00–09:30")).toBeInTheDocument();

    await elegirContacto(user, panel);
    // Un turno válido no ofrece forzar (y un USER nunca lo ve).
    expect(within(panel).queryByLabelText("Forzar fuera de horario")).not.toBeInTheDocument();

    const antes = listados;
    await user.click(within(panel).getByRole("button", { name: "Reservar" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Nueva reserva" })).not.toBeInTheDocument(),
    );
    expect(bodies).toEqual([
      {
        resourceId: "r1",
        serviceTypeId: "s1",
        contactId: "c9",
        startsAt: "2030-09-23T12:00:00.000Z",
      },
    ]);
    await waitFor(() => expect(listados).toBeGreaterThan(antes));
  });

  it("USER: fuera del horario laboral la grilla no es clickeable", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    server.use(...catalogHandlers(), bookingsHandler({}));
    renderPage();
    await irAlLunes();

    await screen.findByRole("button", { name: "Reservar Dra. López a las 09:00" });
    expect(
      screen.queryByRole("button", { name: /Dra\. López a las 20:00/ }),
    ).not.toBeInTheDocument();
  });

  it("USER: si el backend rechaza el turno, el panel muestra su mensaje y no se cierra", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    server.use(
      ...catalogHandlers(),
      bookingsHandler({}),
      http.post(bookingsUrl, () =>
        HttpResponse.json({ error: { message: "Ese horario ya está reservado" } }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await irAlLunes();

    await user.click(
      await screen.findByRole("button", { name: "Reservar Dra. López a las 09:00" }),
    );
    const panel = await screen.findByRole("dialog", { name: "Nueva reserva" });
    await chooseSelectOption(
      user,
      within(panel).getByLabelText("Tipo de servicio"),
      "Consulta general",
    );
    await elegirContacto(user, panel);
    await user.click(within(panel).getByRole("button", { name: "Reservar" }));

    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "No pudimos crear la reserva: Ese horario ya está reservado",
    );
    expect(screen.getByRole("dialog", { name: "Nueva reserva" })).toBeInTheDocument();
  });

  it("ADMIN: el horario cerrado es clickeable y exige tildar 'Forzar fuera de horario', que viaja como force: true", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    let body: unknown;
    server.use(
      ...catalogHandlers(),
      bookingsHandler({}),
      http.post(bookingsUrl, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeBooking({ id: "forzada" }), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await irAlLunes();

    await user.click(
      await screen.findByRole("button", { name: "Forzar reserva de Dra. López a las 20:00" }),
    );
    const panel = await screen.findByRole("dialog", { name: "Nueva reserva" });
    await chooseSelectOption(
      user,
      within(panel).getByLabelText("Tipo de servicio"),
      "Consulta general",
    );
    await elegirContacto(user, panel);

    const reservar = within(panel).getByRole("button", { name: "Reservar" });
    expect(reservar).toBeDisabled();
    await user.click(within(panel).getByLabelText("Forzar fuera de horario"));
    expect(reservar).toBeEnabled();
    await user.click(reservar);

    await waitFor(() =>
      expect(body).toEqual({
        resourceId: "r1",
        serviceTypeId: "s1",
        contactId: "c9",
        // 20:00 local = 23:00Z.
        startsAt: "2030-09-23T23:00:00.000Z",
        force: true,
      }),
    );
  });

  it("click en una reserva → detalle → Cancelar reserva con confirm", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    const cancelled: string[] = [];
    server.use(
      ...catalogHandlers(),
      bookingsHandler({
        r1: [
          makeBooking({
            id: "bk1",
            resourceId: "r1",
            contactId: "c1",
            startsAt: "2030-09-23T13:00:00.000Z",
            endsAt: "2030-09-23T13:30:00.000Z",
          }),
        ],
      }),
      http.patch(`${bookingsUrl}/:id/cancel`, ({ params }) => {
        cancelled.push(String(params.id));
        return HttpResponse.json(makeBooking({ id: String(params.id), status: "CANCELLED" }));
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await irAlLunes();

    await user.click(await screen.findByRole("button", { name: /10:00–10:30.*Ana c1/ }));
    const dialog = await screen.findByRole("dialog", { name: "Reserva" });
    expect(within(dialog).getByText("Ana c1")).toBeInTheDocument();
    expect(within(dialog).getByText("Consulta general")).toBeInTheDocument();

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    await user.click(within(dialog).getByRole("button", { name: "Cancelar reserva" }));
    expect(confirmSpy).toHaveBeenCalledWith(
      "¿Cancelar esta reserva? El turno queda libre y no se puede deshacer.",
    );
    expect(cancelled).toEqual([]);

    confirmSpy.mockReturnValueOnce(true);
    await user.click(within(dialog).getByRole("button", { name: "Cancelar reserva" }));
    await waitFor(() => expect(cancelled).toEqual(["bk1"]));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Reserva" })).not.toBeInTheDocument(),
    );
    confirmSpy.mockRestore();
  });
});
