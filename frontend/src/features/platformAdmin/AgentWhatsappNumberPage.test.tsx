import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { makeAgent } from "../../test/agentFixtures";
import { chooseSelectOption } from "../../test/chooseSelectOption";
import { env } from "../../config/env";
import { AgentWhatsappNumberPage } from "./AgentWhatsappNumberPage";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// La organización y el agente se eligen de selectores (antes se pegaba el id
// del agente a mano). ORG_B no tiene agentes.

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const ORG_A = "22222222-2222-4222-8222-222222222222";
const ORG_B = "33333333-3333-4333-8333-333333333333";
const url = `${env.apiUrl}/api/admin/agents/:agentId/whatsapp-phone-number`;

function renderPage() {
  server.use(
    http.get(`${env.apiUrl}/api/admin/organizations`, () =>
      HttpResponse.json([
        { id: ORG_A, name: "Concesionaria Ejemplo", slug: "concesionaria-ejemplo" },
        { id: ORG_B, name: "Taller Ficticio", slug: "taller-ficticio" },
      ]),
    ),
    http.get(`${env.apiUrl}/api/admin/organizations/:organizationId/agents`, ({ params }) => {
      if (params.organizationId !== ORG_A) return HttpResponse.json([]);
      return HttpResponse.json([
        {
          id: AGENT_ID,
          name: "Agente AutoMax",
          branchName: "Casa central",
          modelProvider: "openrouter",
          modelName: "openai/gpt-4o-mini",
          isActive: true,
        },
      ]);
    }),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/agents/whatsapp-number"]}>
        <AgentWhatsappNumberPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function elegirAgente(user: ReturnType<typeof userEvent.setup>) {
  await chooseSelectOption(
    user,
    await screen.findByLabelText(/Organización/),
    "Concesionaria Ejemplo",
  );
  await chooseSelectOption(user, await screen.findByLabelText(/Agente/), "Agente AutoMax");
}

describe("AgentWhatsappNumberPage (ítem 127)", () => {
  it("PUT con el agente elegido y el número recortado; muestra el resultado", async () => {
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
    // Sin organización, el selector de agente está deshabilitado.
    expect(await screen.findByLabelText(/Agente/)).toBeDisabled();
    await elegirAgente(user);
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
    await elegirAgente(user);
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText(/el número quedó libre/)).toBeInTheDocument());
    expect(body).toEqual({ whatsappPhoneNumberId: null });
  });

  it("una organización sin agentes lo dice y no deja guardar", async () => {
    let put = false;
    server.use(
      http.put(url, () => {
        put = true;
        return HttpResponse.json(makeAgent());
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await chooseSelectOption(user, await screen.findByLabelText(/Organización/), "Taller Ficticio");

    expect(
      await screen.findByText("Esta organización no tiene agentes de atención a clientes."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Agente/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Elegí un agente.")).toBeInTheDocument();
    expect(put).toBe(false);
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
    await elegirAgente(user);
    await user.type(screen.getByLabelText("ID del número de WhatsApp"), "106540352242922");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(
      await screen.findByText("Ese número de WhatsApp ya está asignado a otro agente"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("ID del número de WhatsApp")).toHaveValue("106540352242922");
  });
});
