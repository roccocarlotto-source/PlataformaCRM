import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../design-system/Toast";
import type { AuthContextValue } from "../../auth/AuthContext";
import { InternalAgentSettingsPage } from "./InternalAgentSettingsPage";
import type { InternalAgent, PutInternalAgentInput } from "./types";

// Se mockea el módulo api.ts entero (no fetch crudo): lo que se prueba es la
// pantalla, y el 404 → null de getInternalAgent ya es parte del contrato de
// ese módulo.
const apiMock = vi.hoisted(() => ({
  getInternalAgent: vi.fn(),
  putInternalAgent: vi.fn(),
  listInternalAgentMessages: vi.fn(),
  sendInternalAgentMessage: vi.fn(),
}));
vi.mock("./api", () => apiMock);

// B-05: el modelo lo cambia solo un platform admin, por su endpoint.
const platformApiMock = vi.hoisted(() => ({
  assignInternalAgentModel: vi.fn(),
  assignAgentModel: vi.fn(),
  assignWhatsappNumber: vi.fn(),
  assignFacebookPage: vi.fn(),
  createOrganization: vi.fn(),
}));
vi.mock("../platformAdmin/api", () => platformApiMock);

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

function mockAuth(isPlatformAdmin: boolean): AuthContextValue {
  return {
    status: "authenticated",
    me: {
      id: "u1",
      email: "a@x.com",
      fullName: "A",
      organizationId: "org-1",
      role: "ADMIN",
      isPlatformAdmin,
      canUseInternalAgent: true,
    },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

beforeEach(() => {
  useAuthMock.mockReturnValue(mockAuth(false));
});

function makeInternalAgent(overrides: Partial<InternalAgent> = {}): InternalAgent {
  return {
    id: "ia1",
    organizationId: "org-1",
    name: "Asistente",
    instructions: "Sos el asistente del equipo.",
    modelProvider: "openrouter",
    modelName: "openai/gpt-4o-mini",
    enabledTools: [],
    createdAt: "2026-09-28T12:00:00.000Z",
    updatedAt: "2026-09-28T12:00:00.000Z",
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter>
          <InternalAgentSettingsPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("InternalAgentSettingsPage", () => {
  it("sin agente (GET → null): formulario vacío que al guardar crea con PUT y refleja lo guardado", async () => {
    const user = userEvent.setup();
    apiMock.getInternalAgent.mockResolvedValue(null);
    // El backend pone el modelo por defecto cuando no se manda modelName.
    apiMock.putInternalAgent.mockImplementation(async (input: PutInternalAgentInput) =>
      makeInternalAgent({ ...input, modelName: input.modelName ?? "modelo/por-defecto" }),
    );
    renderPage();

    const nombre = await screen.findByLabelText(/Nombre/);
    expect(nombre).toHaveValue("");
    expect(screen.getByText(/Todavía no está configurado/)).toBeInTheDocument();

    await user.type(nombre, "Asistente del equipo");
    await user.type(screen.getByLabelText(/Instrucciones/), "Ayudá al equipo.");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(apiMock.putInternalAgent).toHaveBeenCalledTimes(1));
    expect(apiMock.putInternalAgent.mock.calls[0][0]).toEqual({
      name: "Asistente del equipo",
      instructions: "Ayudá al equipo.",
      enabledTools: [],
    });
    // Refleja lo que devolvió el backend, incluido el modelo que asignó.
    expect(await screen.findByLabelText("Modelo")).toHaveValue("modelo/por-defecto");
    expect(screen.queryByText(/Todavía no está configurado/)).not.toBeInTheDocument();
  });

  it("con agente: precarga los campos y el checklist de tools viaja en enabledTools", async () => {
    const user = userEvent.setup();
    apiMock.getInternalAgent.mockResolvedValue(makeInternalAgent({ enabledTools: ["get_agenda"] }));
    apiMock.putInternalAgent.mockImplementation(async (input: PutInternalAgentInput) =>
      makeInternalAgent(input),
    );
    renderPage();

    expect(await screen.findByLabelText(/Nombre/)).toHaveValue("Asistente");
    expect(screen.getByLabelText(/Instrucciones/)).toHaveValue("Sos el asistente del equipo.");
    expect(screen.getByLabelText("Modelo")).toHaveValue("openai/gpt-4o-mini");

    await user.click(screen.getByLabelText("Acciones habilitadas", { selector: "button" }));
    // La descripción es la que lee el modelo, textual del catálogo.
    expect(
      screen.getByText(/Crea una tarea ligada a un contacto u oportunidad/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Crear tarea" }));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(apiMock.putInternalAgent).toHaveBeenCalledTimes(1));
    expect(apiMock.putInternalAgent.mock.calls[0][0]).toEqual({
      name: "Asistente",
      instructions: "Sos el asistente del equipo.",
      enabledTools: ["create_internal_task", "get_agenda"],
    });
  });

  it("B-05: para un ADMIN común el Modelo es de solo lectura y no viaja en el PUT", async () => {
    apiMock.getInternalAgent.mockResolvedValue(makeInternalAgent());
    renderPage();

    const modelo = await screen.findByLabelText("Modelo");
    expect(modelo).toBeDisabled();
    expect(screen.getByText(/Lo elige el equipo de la plataforma/)).toBeInTheDocument();
  });

  it("B-05: un platform admin cambia el Modelo y se guarda por el endpoint de admin", async () => {
    useAuthMock.mockReturnValue(mockAuth(true));
    const user = userEvent.setup();
    apiMock.getInternalAgent.mockResolvedValue(makeInternalAgent());
    apiMock.putInternalAgent.mockImplementation(async (input: PutInternalAgentInput) =>
      makeInternalAgent(input),
    );
    platformApiMock.assignInternalAgentModel.mockResolvedValue(
      makeInternalAgent({ modelName: "anthropic/claude-sonnet-4" }),
    );
    renderPage();

    const modelo = await screen.findByLabelText("Modelo");
    await user.clear(modelo);
    await user.type(modelo, "anthropic/claude-sonnet-4");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(platformApiMock.assignInternalAgentModel).toHaveBeenCalledTimes(1));
    expect("modelName" in apiMock.putInternalAgent.mock.calls[0][0]).toBe(false);
    expect(platformApiMock.assignInternalAgentModel.mock.calls[0][0]).toEqual({
      organizationId: "org-1",
      modelProvider: "openrouter",
      modelName: "anthropic/claude-sonnet-4",
    });
  });

  it("muestra el error del backend al guardar", async () => {
    const user = userEvent.setup();
    apiMock.getInternalAgent.mockResolvedValue(makeInternalAgent());
    apiMock.putInternalAgent.mockRejectedValue(new Error("modelProvider inválido"));
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("modelProvider inválido")).toBeInTheDocument();
  });
});
