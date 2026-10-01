import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { ThemeProvider } from "../../theme/ThemeContext";
import type { AuthContextValue } from "../../auth/AuthContext";
import { InternalAgentChatPage } from "./InternalAgentChatPage";
import type { InternalAgentMessage, InternalAgentMessageListResponse } from "./types";

const apiMock = vi.hoisted(() => ({
  getInternalAgent: vi.fn(),
  putInternalAgent: vi.fn(),
  listInternalAgentMessages: vi.fn(),
  sendInternalAgentMessage: vi.fn(),
}));
vi.mock("./api", () => apiMock);

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
      canUseInternalAgent: true,
    },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

let siguienteId = 0;
function makeMessage(overrides: Partial<InternalAgentMessage> = {}): InternalAgentMessage {
  siguienteId += 1;
  return {
    id: `m${siguienteId}`,
    organizationId: "org-1",
    internalAgentId: "ia1",
    userId: "u1",
    senderType: "AGENT",
    content: "",
    toolCalls: null,
    createdAt: "2026-09-28T12:00:00.000Z",
    ...overrides,
  };
}

// Lo que devuelve el GET: lo más nuevo primero.
function page(
  data: InternalAgentMessage[],
  pagination: Partial<InternalAgentMessageListResponse["pagination"]> = {},
): InternalAgentMessageListResponse {
  return {
    agentName: "Asistente",
    data,
    pagination: { page: 1, pageSize: 50, total: data.length, totalPages: 1, ...pagination },
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={["/internal-agent"]}>
          <Routes>
            <Route path="/internal-agent" element={<InternalAgentChatPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

function burbujas() {
  return within(screen.getByRole("list", { name: "Conversación" }))
    .queryAllByRole("listitem")
    .map((item) => item.textContent);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("InternalAgentChatPage", () => {
  it("muestra el hilo en orden cronológico, con el nombre del agente en el encabezado", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    apiMock.listInternalAgentMessages.mockResolvedValue(
      page([
        makeMessage({ senderType: "AGENT", content: "Mañana tenés 2 turnos." }),
        makeMessage({ senderType: "USER", content: "¿Qué tengo mañana?" }),
      ]),
    );
    renderPage();

    expect(await screen.findByRole("heading", { name: "Asistente" })).toBeInTheDocument();
    expect(burbujas()).toEqual(["Vos¿Qué tengo mañana?", "AsistenteMañana tenés 2 turnos."]);
    expect(apiMock.listInternalAgentMessages).toHaveBeenCalledWith(
      { page: 1, pageSize: 50 },
      expect.anything(),
    );
  });

  it("manda un mensaje: burbuja propia al instante, 'escribiendo' y botón deshabilitado hasta la respuesta", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth("USER"));
    apiMock.listInternalAgentMessages.mockResolvedValue(page([]));
    let responder: (mensaje: InternalAgentMessage) => void = () => {};
    apiMock.sendInternalAgentMessage.mockImplementation(
      () =>
        new Promise<InternalAgentMessage>((resolve) => {
          responder = resolve;
        }),
    );
    renderPage();

    expect(await screen.findByText(/Escribile a Asistente para empezar/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Mensaje"), "Creá una tarea para Ana López");
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    expect(apiMock.sendInternalAgentMessage).toHaveBeenCalledWith("Creá una tarea para Ana López");
    expect(screen.getByText("Creá una tarea para Ana López")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Escribiendo…");
    expect(screen.getByRole("button", { name: "Enviando…" })).toBeDisabled();

    // Mientras está en curso, Enter tampoco manda otro.
    await user.type(screen.getByLabelText("Mensaje"), "otra cosa{Enter}");
    expect(apiMock.sendInternalAgentMessage).toHaveBeenCalledTimes(1);

    // El refetch posterior trae el hilo guardado (lo más nuevo primero).
    const respuesta = makeMessage({
      senderType: "AGENT",
      content: "Listo, la tarea quedó creada.",
    });
    apiMock.listInternalAgentMessages.mockResolvedValue(
      page([
        respuesta,
        makeMessage({ senderType: "USER", content: "Creá una tarea para Ana López" }),
      ]),
    );
    responder(respuesta);

    expect(await screen.findByText("Listo, la tarea quedó creada.")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(burbujas()).toEqual([
        "VosCreá una tarea para Ana López",
        "AsistenteListo, la tarea quedó creada.",
      ]),
    );
  });

  it("si el envío falla, muestra el mensaje del backend y devuelve el texto a la caja", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth("USER"));
    apiMock.listInternalAgentMessages.mockResolvedValue(page([]));
    apiMock.sendInternalAgentMessage.mockRejectedValue(
      new ApiError(403, "No tenés acceso al agente interno."),
    );
    renderPage();

    await user.type(await screen.findByLabelText("Mensaje"), "hola");
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tenés acceso al agente interno.",
    );
    expect(screen.getByLabelText("Mensaje")).toHaveValue("hola");
    expect(apiMock.sendInternalAgentMessage).toHaveBeenCalledTimes(1);
  });

  it("'Ver mensajes anteriores' pide la página siguiente y la antepone", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth("USER"));
    apiMock.listInternalAgentMessages.mockImplementation(async ({ page: numero }) =>
      numero === 1
        ? page([makeMessage({ content: "nuevo" })], {
            page: 1,
            total: 2,
            pageSize: 1,
            totalPages: 2,
          })
        : page([makeMessage({ content: "viejo" })], {
            page: 2,
            total: 2,
            pageSize: 1,
            totalPages: 2,
          }),
    );
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Ver mensajes anteriores" }));
    await waitFor(() => expect(burbujas()).toEqual(["Asistenteviejo", "Asistentenuevo"]));
    expect(
      screen.queryByRole("button", { name: "Ver mensajes anteriores" }),
    ).not.toBeInTheDocument();
  });

  it("sin agente configurado (404), a un ADMIN le ofrece configurarlo", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    apiMock.listInternalAgentMessages.mockRejectedValue(new ApiError(404, "no configurado"));
    renderPage();

    expect(await screen.findByRole("link", { name: "Configurar agente interno" })).toHaveAttribute(
      "href",
      "/internal-agent/settings",
    );
  });

  it("sin agente configurado (404), a un USER le dice que se lo pida a un administrador", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    apiMock.listInternalAgentMessages.mockRejectedValue(new ApiError(404, "no configurado"));
    renderPage();

    expect(
      await screen.findByText("Todavía no hay un agente interno configurado"),
    ).toBeInTheDocument();
    expect(screen.getByText("Pedíselo a un administrador.")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Configurar agente interno" }),
    ).not.toBeInTheDocument();
  });

  it("sin acceso (403): muestra el mensaje del backend y no reintenta", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    apiMock.listInternalAgentMessages.mockRejectedValue(
      new ApiError(
        403,
        "No tenés acceso al agente interno. Pedíselo a un administrador de tu organización.",
      ),
    );
    renderPage();

    expect(
      await screen.findByText(
        "No tenés acceso al agente interno. Pedíselo a un administrador de tu organización.",
      ),
    ).toBeInTheDocument();
    expect(apiMock.listInternalAgentMessages).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Mensaje")).not.toBeInTheDocument();
  });
});
