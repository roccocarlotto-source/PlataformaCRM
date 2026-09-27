import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { makeAgent } from "../../test/agentFixtures";
import { env } from "../../config/env";
import { AgentFacebookPagePage } from "./AgentFacebookPagePage";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const url = `${env.apiUrl}/api/admin/agents/:agentId/facebook-page`;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/agents/facebook-page"]}>
        <AgentFacebookPagePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AgentFacebookPagePage (ítem 173)", () => {
  it("PUT con el agente de la URL y la página recortada; muestra el resultado", async () => {
    let body: unknown;
    let agentId: unknown;
    server.use(
      http.put(url, async ({ request, params }) => {
        body = await request.json();
        agentId = params.agentId;
        return HttpResponse.json(
          makeAgent({
            id: AGENT_ID,
            name: "Agente AutoMax",
            facebookPageId: "104857600000001",
          }),
        );
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText("ID del agente"), ` ${AGENT_ID} `);
    await user.type(screen.getByLabelText("ID de la página de Facebook"), " 104857600000001 ");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(screen.getByText("Página de Facebook actualizada")).toBeInTheDocument(),
    );
    expect(agentId).toBe(AGENT_ID);
    expect(body).toEqual({ facebookPageId: "104857600000001" });
    expect(screen.getByText("Agente AutoMax")).toBeInTheDocument();
    expect(screen.getByText("104857600000001")).toBeInTheDocument();
  });

  it("vacío manda null: libera la página", async () => {
    let body: unknown;
    server.use(
      http.put(url, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeAgent({ id: AGENT_ID, facebookPageId: null }));
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText("ID del agente"), AGENT_ID);
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText(/la página quedó libre/)).toBeInTheDocument());
    expect(body).toEqual({ facebookPageId: null });
  });

  it("el error del backend (409 en uso) se muestra y el formulario queda", async () => {
    server.use(
      http.put(url, () =>
        HttpResponse.json(
          { error: { message: "Esa página de Facebook ya está asignada a otro agente" } },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText("ID del agente"), AGENT_ID);
    await user.type(screen.getByLabelText("ID de la página de Facebook"), "104857600000001");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(
      await screen.findByText("Esa página de Facebook ya está asignada a otro agente"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("ID del agente")).toHaveValue(AGENT_ID);
  });
});
