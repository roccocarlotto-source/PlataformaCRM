import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { makeAgent } from "../../test/agentFixtures";
import { chooseSelectOption, listSelectOptions } from "../../test/chooseSelectOption";
import { env } from "../../config/env";
import { AgentModelPage } from "./AgentModelPage";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// B-05: el modelo de IA lo elige solo la plataforma. La organización y el
// agente se eligen de selectores (antes se pegaban los ids a mano).

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const OTRO_AGENT_ID = "44444444-4444-4444-8444-444444444444";
const ORG_A = "22222222-2222-4222-8222-222222222222";
const ORG_B = "33333333-3333-4333-8333-333333333333";

// Las organizaciones del selector y los agentes de cada una. ORG_B no tiene
// agentes. Cada pedido de agentes queda registrado.
let pedidosDeAgentes: string[] = [];

function renderPage() {
  pedidosDeAgentes = [];
  server.use(
    http.get(`${env.apiUrl}/api/admin/organizations`, () =>
      HttpResponse.json([
        { id: ORG_A, name: "Concesionaria Ejemplo", slug: "concesionaria-ejemplo" },
        { id: ORG_B, name: "Taller Ficticio", slug: "taller-ficticio" },
      ]),
    ),
    http.get(`${env.apiUrl}/api/admin/organizations/:organizationId/agents`, ({ params }) => {
      pedidosDeAgentes.push(String(params.organizationId));
      if (params.organizationId !== ORG_A) return HttpResponse.json([]);
      return HttpResponse.json([
        {
          id: AGENT_ID,
          name: "Vera",
          branchName: "Casa central",
          modelProvider: "openrouter",
          modelName: "openai/gpt-4o-mini",
          isActive: true,
        },
        {
          id: OTRO_AGENT_ID,
          name: "Zoe",
          branchName: "Sucursal norte",
          modelProvider: "openrouter",
          modelName: "openai/gpt-4o-mini",
          isActive: false,
        },
      ]);
    }),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/agents/model"]}>
        <AgentModelPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Cada tarjeta es un <form>; se busca dentro de la suya por su título.
function tarjeta(titulo: string): HTMLElement {
  const form = screen.getByText(titulo).closest("form");
  if (!form) throw new Error(`No está la tarjeta ${titulo}`);
  return form;
}

describe("AgentModelPage (B-05)", () => {
  it("elige organización y agente, y cambia el modelo de ese agente", async () => {
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
    const card = tarjeta("Agente de atención a clientes");

    // Sin organización, el selector de agente está deshabilitado y no se pide nada.
    expect(within(card).getByLabelText(/Agente/)).toBeDisabled();

    await chooseSelectOption(
      user,
      await within(card).findByLabelText(/Organización/),
      "Concesionaria Ejemplo",
    );
    const agente = await within(card).findByRole("combobox", { name: /Agente/ });
    await waitFor(() => expect(agente).toBeEnabled());
    expect(pedidosDeAgentes).toEqual([ORG_A]);
    expect(await listSelectOptions(user, agente)).toEqual(["Elegir agente…", "Vera", "Zoe"]);
    expect(within(card).getByText("Sucursal norte · openai/gpt-4o-mini · Inactivo")).toBeVisible();
    await user.click(within(card).getByRole("option", { name: "Vera" }));

    await user.type(within(card).getByLabelText(/Modelo/), " anthropic/claude-sonnet-4 ");
    await user.click(within(card).getByRole("button", { name: "Guardar" }));

    expect(
      await screen.findByText("Vera ahora usa anthropic/claude-sonnet-4."),
    ).toBeInTheDocument();
    expect(agentId).toBe(AGENT_ID);
    expect(body).toEqual({ modelName: "anthropic/claude-sonnet-4" });
  });

  it("una organización sin agentes lo dice, sin selector de agente", async () => {
    const user = userEvent.setup();
    renderPage();
    const card = tarjeta("Agente de atención a clientes");

    await chooseSelectOption(
      user,
      await within(card).findByLabelText(/Organización/),
      "Taller Ficticio",
    );

    expect(
      await within(card).findByText("Esta organización no tiene agentes de atención a clientes."),
    ).toBeInTheDocument();
    expect(within(card).queryByRole("combobox", { name: /Agente/ })).not.toBeInTheDocument();
    expect(pedidosDeAgentes).toEqual([ORG_B]);
  });

  it("cambiar de organización descarta el agente elegido", async () => {
    let put = false;
    server.use(
      http.put(`${env.apiUrl}/api/admin/agents/:agentId/model`, () => {
        put = true;
        return HttpResponse.json(makeAgent());
      }),
    );
    const user = userEvent.setup();
    renderPage();
    const card = tarjeta("Agente de atención a clientes");

    const organizacion = await within(card).findByLabelText(/Organización/);
    await chooseSelectOption(user, organizacion, "Concesionaria Ejemplo");
    await chooseSelectOption(user, await within(card).findByLabelText(/Agente/), "Vera");
    await chooseSelectOption(user, organizacion, "Taller Ficticio");
    await chooseSelectOption(user, organizacion, "Concesionaria Ejemplo");

    expect(await within(card).findByLabelText(/Agente/)).toHaveValue("");
    await user.type(within(card).getByLabelText(/Modelo/), "x/y");
    await user.click(within(card).getByRole("button", { name: "Guardar" }));
    // `required` en el selector bloquea el submit sin agente.
    expect(put).toBe(false);
  });

  it("elige la organización y cambia el modelo de su agente interno", async () => {
    let organizationId: unknown;
    let body: unknown;
    server.use(
      http.put(
        `${env.apiUrl}/api/admin/organizations/:organizationId/internal-agent/model`,
        async ({ params, request }) => {
          organizationId = params.organizationId;
          body = await request.json();
          return HttpResponse.json({
            id: "ia1",
            organizationId: ORG_A,
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
    const card = tarjeta("Agente interno de una organización");

    await chooseSelectOption(
      user,
      await within(card).findByLabelText(/Organización/),
      "Concesionaria Ejemplo",
    );
    await user.type(within(card).getByLabelText(/Modelo/), "openai/gpt-4o-mini");
    await user.click(within(card).getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Asistente ahora usa openai/gpt-4o-mini.")).toBeInTheDocument();
    expect(organizationId).toBe(ORG_A);
    expect(body).toEqual({ modelName: "openai/gpt-4o-mini" });
    // La tarjeta del agente interno no pide la lista de agentes.
    expect(pedidosDeAgentes).toEqual([]);
  });

  it("muestra el error del backend", async () => {
    server.use(
      http.put(`${env.apiUrl}/api/admin/agents/:agentId/model`, () =>
        HttpResponse.json({ error: { message: "Agente no encontrado" } }, { status: 404 }),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    const card = tarjeta("Agente de atención a clientes");

    await chooseSelectOption(
      user,
      await within(card).findByLabelText(/Organización/),
      "Concesionaria Ejemplo",
    );
    await chooseSelectOption(user, await within(card).findByLabelText(/Agente/), "Vera");
    await user.type(within(card).getByLabelText(/Modelo/), "x/y");
    await user.click(within(card).getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText("Agente no encontrado")).toBeInTheDocument());
  });
});
