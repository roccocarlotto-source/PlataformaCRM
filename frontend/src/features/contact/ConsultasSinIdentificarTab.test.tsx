import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeContact } from "../../test/contactFixtures";
import { makeUser } from "../../test/userFixtures";
import { cellByHeader } from "../../test/cellByHeader";
import { openActionsMenu } from "../../test/openActionsMenu";
import { chooseSelectOption } from "../../test/chooseSelectOption";
import { ConsultasSinIdentificarTab } from "./ConsultasSinIdentificarTab";
import type { AuthContextValue } from "../../auth/AuthContext";
import type { ConsultasListResponse, ContactConConsulta } from "./types";

// La pestaña "Consultas sin identificar" (ítem 184): pide vista=consultas,
// muestra la última conversación de cada una y ofrece las acciones de la
// fila según el rol.

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

afterEach(() => vi.restoreAllMocks());

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
      canUseInternalAgent: false,
    },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

const contactsUrl = `${env.apiUrl}/api/contacts`;
const usersUrl = `${env.apiUrl}/api/users`;

const HACE_TRES_HORAS = new Date(Date.now() - 3 * 3_600_000).toISOString();

function consulta(overrides: Partial<ContactConConsulta> = {}): ContactConConsulta {
  return {
    ...makeContact({
      id: "ct1",
      firstName: "WhatsApp",
      lastName: "+59899123456",
      phone: "+59899123456",
      email: null,
      ownerId: "u1",
      vehicleOfInterest: {
        id: "v1",
        internalCode: "A-1",
        make: "Toyota",
        model: "Hilux",
        trim: "SRV",
        year: 2022,
        status: "AVAILABLE",
        deletedAt: null,
      },
    }),
    ultimaConsulta: {
      conversationId: "cv1",
      channel: "WHATSAPP",
      ultimoMensaje: "¿Cuánto sale la Hilux?",
      ultimoMensajeAt: HACE_TRES_HORAS,
    },
    ...overrides,
  };
}

function usersHandler() {
  return http.get(usersUrl, () =>
    HttpResponse.json({
      data: [
        makeUser({ id: "u1", fullName: "Ana Pérez" }),
        makeUser({ id: "u2", fullName: "Beto Gómez" }),
      ],
      pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
    }),
  );
}

function listHandler(captured: URL[], data: ContactConConsulta[] = [consulta()]) {
  const response: ConsultasListResponse = {
    data,
    pagination: { page: 1, pageSize: 20, total: data.length, totalPages: 1 },
  };
  return http.get(contactsUrl, ({ request }) => {
    captured.push(new URL(request.url));
    return HttpResponse.json(response);
  });
}

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ConsultasSinIdentificarTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ConsultasSinIdentificarTab", () => {
  it("pide vista=consultas y muestra canal, último mensaje, hace cuánto, vehículo y vendedor", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const captured: URL[] = [];
    server.use(usersHandler(), listHandler(captured));

    renderTab();

    const row = (await screen.findByText("WhatsApp +59899123456")).closest("tr");
    expect(captured[0]?.searchParams.get("vista")).toBe("consultas");
    expect(cellByHeader(row, "Canal")).toHaveTextContent("WhatsApp");
    expect(cellByHeader(row, "Último mensaje")).toHaveTextContent("¿Cuánto sale la Hilux?");
    expect(cellByHeader(row, "Escribió")).toHaveTextContent("hace 3 h");
    expect(cellByHeader(row, "Vehículo de interés")).toHaveTextContent("Toyota Hilux 2022 SRV");
    await waitFor(() => expect(cellByHeader(row, "Vendedor")).toHaveTextContent("Ana Pérez"));
    // El nombre provisorio abre la ficha, donde se completa el real.
    expect(screen.getByRole("link", { name: "WhatsApp +59899123456" })).toHaveAttribute(
      "href",
      "/contacts/ct1/edit",
    );
  });

  it("los filtros de canal y búsqueda viajan en la query", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const captured: URL[] = [];
    server.use(usersHandler(), listHandler(captured));
    const user = userEvent.setup();

    renderTab();
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));

    await chooseSelectOption(user, screen.getByLabelText("Canal"), "Messenger");
    await waitFor(() => expect(captured.at(-1)?.searchParams.get("channel")).toBe("MESSENGER"));

    await user.type(screen.getByPlaceholderText("Buscar por nombre, email o teléfono"), "991");
    await waitFor(() => expect(captured.at(-1)?.searchParams.get("search")).toBe("991"));
    expect(captured.at(-1)?.searchParams.get("vista")).toBe("consultas");
  });

  it("ADMIN: cinco acciones; abrir la conversación y crear la tarea son links; descartar confirma y hace POST", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const captured: URL[] = [];
    let descartado: string | null = null;
    server.use(
      usersHandler(),
      listHandler(captured),
      http.post(`${contactsUrl}/:id/descartar`, ({ params }) => {
        descartado = String(params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();

    renderTab();
    const row = (await screen.findByText("WhatsApp +59899123456")).closest("tr");
    await openActionsMenu(user, row);

    expect(screen.getByRole("menuitem", { name: "Abrir la conversación" })).toHaveAttribute(
      "href",
      "/conversations/cv1",
    );
    expect(screen.getByRole("menuitem", { name: "Crear tarea de seguimiento" })).toHaveAttribute(
      "href",
      "/activities/new?contactId=ct1",
    );
    expect(screen.getByRole("menuitem", { name: "Asignar vendedor" })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Unir con un contacto existente" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "Descartar" }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/Descartar esta consulta/));
    await waitFor(() => expect(descartado).toBe("ct1"));
  });

  it("USER: solo abrir la conversación y crear la tarea, sin columna Vendedor ni pedido a /api/users", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    const captured: URL[] = [];
    let pidioUsuarios = false;
    server.use(
      listHandler(captured),
      http.get(usersUrl, () => {
        pidioUsuarios = true;
        return HttpResponse.json({ error: { message: "forbidden" } }, { status: 403 });
      }),
    );
    const user = userEvent.setup();

    renderTab();
    const row = (await screen.findByText("WhatsApp +59899123456")).closest("tr");
    expect(cellByHeader(row, "Vendedor")).toBeUndefined();
    expect(screen.queryByLabelText("Vendedor")).toBeNull();

    await openActionsMenu(user, row);
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Abrir la conversación",
      "Crear tarea de seguimiento",
    ]);
    expect(pidioUsuarios).toBe(false);
  });

  it("Asignar vendedor hace PATCH con el ownerId elegido", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const captured: URL[] = [];
    let patched: { id: string; body: unknown } | null = null;
    server.use(
      usersHandler(),
      listHandler(captured, [consulta({ ownerId: null })]),
      http.patch(`${contactsUrl}/:id`, async ({ params, request }) => {
        patched = { id: String(params.id), body: await request.json() };
        return HttpResponse.json(makeContact({ id: "ct1", ownerId: "u2" }));
      }),
    );
    const user = userEvent.setup();

    renderTab();
    const row = (await screen.findByText("WhatsApp +59899123456")).closest("tr");
    expect(cellByHeader(row, "Vendedor")).toHaveTextContent("—");
    await openActionsMenu(user, row);
    await user.click(screen.getByRole("menuitem", { name: "Asignar vendedor" }));

    const dialog = await screen.findByRole("dialog", { name: "Asignar vendedor" });
    await chooseSelectOption(user, within(dialog).getByLabelText("Vendedor"), "Beto Gómez");
    await user.click(within(dialog).getByRole("button", { name: "Asignar" }));

    await waitFor(() => expect(patched).toEqual({ id: "ct1", body: { ownerId: "u2" } }));
  });

  it("sin conversación: guiones y sin la acción de abrirla; empty state sin filas", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const captured: URL[] = [];
    server.use(
      usersHandler(),
      listHandler(captured, [
        consulta({ firstName: "Instagram", lastName: "…9001", ultimaConsulta: null }),
      ]),
    );
    const user = userEvent.setup();

    const { unmount } = renderTab();
    const row = (await screen.findByText("Instagram …9001")).closest("tr");
    expect(cellByHeader(row, "Canal")).toHaveTextContent("—");
    expect(cellByHeader(row, "Último mensaje")).toHaveTextContent("—");
    await openActionsMenu(user, row);
    expect(screen.queryByRole("menuitem", { name: "Abrir la conversación" })).toBeNull();
    unmount();

    server.use(listHandler([], []));
    renderTab();
    expect(await screen.findByText("No hay consultas sin identificar")).toBeInTheDocument();
  });
});
