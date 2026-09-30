import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { makeAgent } from "../../test/agentFixtures";
import { env } from "../../config/env";
import { AgentModelPage } from "./AgentModelPage";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// B-05: el modelo de IA lo elige solo la plataforma.

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/agents/model"]}>
        <AgentModelPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AgentModelPage (B-05)", () => {
  it("cambia el modelo de un agente por su id y muestra el resultado", async () => {
    let body: unknown;
    let agentId: unknown;
    server.use(
      http.put(`${env.apiUrl}/api/admin/agents/:agentId/model`, async ({ request, params }) => {
        body = await request.json();
        agentId = params.agentId;
        return HttpResponse.json(
          makeAgent({ id: AGENT_ID, name: "Vera", modelName: "anthropic/claude-sonnet-4" }),
        );
      }),
    );
    const user = userEvent.setup();
    renderPage();

    const [idDelAgente] = screen.getAllByLabelText(/ID del agente/);
    await user.type(idDelAgente, ` ${AGENT_ID} `);
    const [modelo] = screen.getAllByLabelText(/Modelo/);
    await user.type(modelo, " anthropic/claude-sonnet-4 ");
    const [guardar] = screen.getAllByRole("button", { name: "Guardar" });
    await user.click(guardar);

    expect(
      await screen.findByText("Vera ahora usa anthropic/claude-sonnet-4."),
    ).toBeInTheDocument();
    expect(agentId).toBe(AGENT_ID);
    expect(body).toEqual({ modelName: "anthropic/claude-sonnet-4" });
  });

  it("cambia el modelo del agente interno de una organización", async () => {
    let organizationId: unknown;
    server.use(
      http.put(
        `${env.apiUrl}/api/admin/organizations/:organizationId/internal-agent/model`,
        ({ params }) => {
          organizationId = params.organizationId;
          return HttpResponse.json({
            id: "ia1",
            organizationId: ORG_ID,
            name: "Asistente",
            instructions: "x",
            modelProvider: "openrouter",
            modelName: "openai/gpt-4o-mini",
            enabledTools: [],
            createdAt: "2026-09-28T12:00:00.000Z",
            updatedAt: "2026-09-28T12:00:00.000Z",
          });
        },
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/ID de la organización/), ORG_ID);
    const modelos = screen.getAllByLabelText(/Modelo/);
    await user.type(modelos[1], "openai/gpt-4o-mini");
    await user.click(screen.getAllByRole("button", { name: "Guardar" })[1]);

    expect(await screen.findByText("Asistente ahora usa openai/gpt-4o-mini.")).toBeInTheDocument();
    expect(organizationId).toBe(ORG_ID);
  });

  it("muestra el error del backend", async () => {
    server.use(
      http.put(`${env.apiUrl}/api/admin/agents/:agentId/model`, () =>
        HttpResponse.json({ error: { message: "Agente no encontrado" } }, { status: 404 }),
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getAllByLabelText(/ID del agente/)[0], AGENT_ID);
    await user.type(screen.getAllByLabelText(/Modelo/)[0], "x/y");
    await user.click(screen.getAllByRole("button", { name: "Guardar" })[0]);

    await waitFor(() => expect(screen.getByText("Agente no encontrado")).toBeInTheDocument());
  });
});
