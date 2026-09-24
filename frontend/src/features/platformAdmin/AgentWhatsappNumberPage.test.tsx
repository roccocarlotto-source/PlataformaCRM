import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { makeAgent } from "../../test/agentFixtures";
import { env } from "../../config/env";
import { AgentWhatsappNumberPage } from "./AgentWhatsappNumberPage";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const url = `${env.apiUrl}/api/admin/agents/:agentId/whatsapp-phone-number`;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/agents/whatsapp-number"]}>
        <AgentWhatsappNumberPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AgentWhatsappNumberPage (ítem 127)", () => {
  it("PUT con el agente de la URL y el número recortado; muestra el resultado", async () => {
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
            whatsappPhoneNumberId: "106540352242922",
          }),
        );
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText("ID del agente"), ` ${AGENT_ID} `);
    await user.type(screen.getByLabelText("ID del número de WhatsApp"), " 106540352242922 ");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(screen.getByText("Número de WhatsApp actualizado")).toBeInTheDocument(),
    );
    expect(agentId).toBe(AGENT_ID);
    expect(body).toEqual({ whatsappPhoneNumberId: "106540352242922" });
    expect(screen.getByText("Agente AutoMax")).toBeInTheDocument();
    expect(screen.getByText("106540352242922")).toBeInTheDocument();
  });

  it("vacío manda null: libera el número", async () => {
    let body: unknown;
    server.use(
      http.put(url, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeAgent({ id: AGENT_ID, whatsappPhoneNumberId: null }));
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText("ID del agente"), AGENT_ID);
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText(/el número quedó libre/)).toBeInTheDocument());
    expect(body).toEqual({ whatsappPhoneNumberId: null });
  });

  it("el error del backend (409 en uso) se muestra y el formulario queda", async () => {
    server.use(
      http.put(url, () =>
        HttpResponse.json(
          { error: { message: "Ese número de WhatsApp ya está asignado a otro agente" } },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText("ID del agente"), AGENT_ID);
    await user.type(screen.getByLabelText("ID del número de WhatsApp"), "106540352242922");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(
      await screen.findByText("Ese número de WhatsApp ya está asignado a otro agente"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("ID del agente")).toHaveValue(AGENT_ID);
  });
});
