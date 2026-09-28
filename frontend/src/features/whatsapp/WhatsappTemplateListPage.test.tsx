import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeAutomation } from "../../test/automationFixtures";
import { ACTION_CREATE_FOLLOW_UP, ACTION_SEND_QR_FOLLOWUP } from "../automation/catalog";
import type { Automation } from "../automation/types";
import { ACTION_SEND_DISCOUNT_VOUCHER } from "./acciones";
import { WhatsappTemplateListPage } from "./WhatsappTemplateListPage";
import type { WhatsappTemplate } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const automationsUrl = `${env.apiUrl}/api/automations`;
const templatesUrl = `${env.apiUrl}/api/whatsapp-templates`;

function makeTemplate(overrides: Partial<WhatsappTemplate> = {}): WhatsappTemplate {
  return {
    id: "tpl-1",
    automationId: "au-qr",
    name: "seguimiento_postventa",
    language: "es_AR",
    bodyText: "Hola {nombre}, tu opinión: {link} ¡Gracias!",
    status: "APPROVED",
    rejectedReason: null,
    createdAt: "2026-09-28T12:00:00.000Z",
    updatedAt: "2026-09-28T12:00:00.000Z",
    ...overrides,
  };
}

// El listado de automatizaciones y la plantilla de cada regla (por su
// automationId, como el backend). Registra qué query le pidió el listado.
function mockBackend(reglas: Automation[], plantillas: Record<string, WhatsappTemplate | null>) {
  const pedidos: URLSearchParams[] = [];
  server.use(
    http.get(automationsUrl, ({ request }) => {
      pedidos.push(new URL(request.url).searchParams);
      return HttpResponse.json({
        data: reglas,
        pagination: { page: 1, pageSize: 100, total: reglas.length, totalPages: 1 },
      });
    }),
    http.get(templatesUrl, ({ request }) => {
      const automationId = new URL(request.url).searchParams.get("automationId") ?? "";
      return HttpResponse.json(plantillas[automationId] ?? null);
    }),
  );
  return pedidos;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <WhatsappTemplateListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("WhatsappTemplateListPage (ítem 181)", () => {
  it("lista SOLO las reglas que mandan WhatsApp, cada una con el estado de SU plantilla y el link a su pantalla", async () => {
    const pedidos = mockBackend(
      [
        makeAutomation({ id: "au-qr", name: "QR al ganar", actionType: ACTION_SEND_QR_FOLLOWUP }),
        makeAutomation({
          id: "au-cupon",
          name: "Cupón al ganar",
          actionType: ACTION_SEND_DISCOUNT_VOUCHER,
          isActive: false,
        }),
        makeAutomation({
          id: "au-tarea",
          name: "Tarea al ganar",
          actionType: ACTION_CREATE_FOLLOW_UP,
        }),
      ],
      { "au-qr": makeTemplate(), "au-cupon": null },
    );
    renderPage();

    const filaQr = (await screen.findByText("QR al ganar")).closest("tr") as HTMLElement;
    expect(await within(filaQr).findByText("Aprobada")).toBeInTheDocument();
    expect(within(filaQr).getByText("Enviar QR por WhatsApp")).toBeInTheDocument();
    expect(within(filaQr).getByRole("link", { name: "Plantilla de QR al ganar" })).toHaveAttribute(
      "href",
      "/whatsapp-template/au-qr",
    );

    const filaCupon = screen.getByText("Cupón al ganar").closest("tr") as HTMLElement;
    expect(await within(filaCupon).findByText("Sin plantilla")).toBeInTheDocument();
    // Inactiva también se lista: la plantilla se aprueba antes de activarla.
    expect(within(filaCupon).getByText("Inactiva")).toBeInTheDocument();
    expect(within(filaCupon).getByRole("link")).toHaveTextContent("Cargar plantilla");

    // La que no manda WhatsApp no aparece.
    expect(screen.queryByText("Tarea al ganar")).not.toBeInTheDocument();
    // Pide solo las reglas de "oportunidad ganada", las 100 del tope.
    expect(pedidos[0].get("triggerType")).toBe("opportunity.won");
    expect(pedidos[0].get("pageSize")).toBe("100");
  });

  it("pendiente y rechazada se ven con su badge", async () => {
    mockBackend(
      [
        makeAutomation({ id: "au-1", name: "Regla 1", actionType: ACTION_SEND_QR_FOLLOWUP }),
        makeAutomation({ id: "au-2", name: "Regla 2", actionType: ACTION_SEND_DISCOUNT_VOUCHER }),
      ],
      {
        "au-1": makeTemplate({ id: "t1", automationId: "au-1", status: "PENDING" }),
        "au-2": makeTemplate({ id: "t2", automationId: "au-2", status: "REJECTED" }),
      },
    );
    renderPage();

    expect(await screen.findByText("Pendiente")).toBeInTheDocument();
    expect(await screen.findByText("Rechazada")).toBeInTheDocument();
  });

  it("sin ninguna regla que mande WhatsApp, lo dice y lleva a Automatizaciones", async () => {
    mockBackend([makeAutomation({ actionType: ACTION_CREATE_FOLLOW_UP })], {});
    renderPage();

    expect(await screen.findByText(/Ninguna automatización manda WhatsApp/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Automatizaciones" })).toHaveAttribute(
      "href",
      "/automations",
    );
  });
});
