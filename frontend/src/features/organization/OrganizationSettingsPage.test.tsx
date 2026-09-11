import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeExchangeRate, makeOrganizationSettings } from "../../test/organizationFixtures";
import { ToastProvider } from "../../design-system/Toast";
import { OrganizationSettingsPage } from "./OrganizationSettingsPage";
import type { OrganizationSettings } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/organization`;

// ToastProvider como en App.tsx: la página llama a useToast() y sin el
// provider falla ruidosamente (ver design-system/useToast.ts). Sin router:
// la página no navega (es un singleton que se edita en el lugar).
function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <OrganizationSettingsPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function mockSettings(settings: OrganizationSettings) {
  let patchedBody: Record<string, unknown> | undefined;
  server.use(
    http.get(baseUrl, () => HttpResponse.json(settings)),
    http.patch(baseUrl, async ({ request }) => {
      patchedBody = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ ...settings, ...patchedBody });
    }),
  );
  return { getPatchedBody: () => patchedBody };
}

const optionsOf = (label: string) =>
  within(screen.getByLabelText(label))
    .getAllByRole("option")
    .map((option) => option.textContent);

describe("OrganizationSettingsPage — carga", () => {
  it("hidrata los dos selects con lo persistido y muestra la cotización vigente con su fecha", async () => {
    mockSettings(
      makeOrganizationSettings({
        name: "Automotora Demo",
        preferredCurrency: "USD",
        alternateCurrency: "UYU",
        exchangeRates: [makeExchangeRate({ rate: "40.123456", rateDate: "2026-09-10" })],
      }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("Moneda de preferencia")).toHaveValue("USD"));
    expect(screen.getByLabelText("Moneda alternativa")).toHaveValue("UYU");
    expect(screen.getByText(/Configuración de Automotora Demo/)).toBeInTheDocument();
    // Ambos selects: "Sin configurar" + las dos monedas de la operación, sin "Otra".
    expect(optionsOf("Moneda de preferencia")).toEqual(["Sin configurar", "USD", "UYU"]);
    expect(optionsOf("Moneda alternativa")).toEqual(["Sin configurar", "USD", "UYU"]);

    // Cotización de solo lectura: es-UY (coma decimal), hasta 4 decimales, y
    // la fecha del dato. No es un input.
    const rates = screen.getByRole("list", { name: "Cotizaciones vigentes" });
    expect(rates).toHaveTextContent("1 USD = 40,1235 UYU");
    expect(rates).toHaveTextContent(/cotización del 10 .*2026/);
    expect(within(rates).queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("sin moneda alternativa ni cotización: selects en 'Sin configurar' y aviso de que no hay cotización", async () => {
    mockSettings(
      makeOrganizationSettings({
        preferredCurrency: null,
        alternateCurrency: null,
        exchangeRates: [],
      }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("Moneda de preferencia")).toHaveValue(""));
    expect(screen.getByLabelText("Moneda alternativa")).toHaveValue("");
    expect(screen.getByText(/Todavía no hay cotización cargada/)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Cotizaciones vigentes" })).not.toBeInTheDocument();
  });

  it("una moneda persistida fuera de la lista se muestra como opción extra mientras sea la vigente", async () => {
    // Mismo criterio que Moneda en Oportunidad (ítem 18.B): "ARS" no está en
    // USD/UYU, pero es lo persistido — el select no puede decir "Sin
    // configurar" mientras el PATCH mandaría "ARS".
    mockSettings(makeOrganizationSettings({ preferredCurrency: "ARS", alternateCurrency: "USD" }));
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("Moneda de preferencia")).toHaveValue("ARS"));
    expect(optionsOf("Moneda de preferencia")).toEqual(["Sin configurar", "ARS", "USD", "UYU"]);
    // El otro select no se contamina con la opción extra.
    expect(optionsOf("Moneda alternativa")).toEqual(["Sin configurar", "USD", "UYU"]);
  });

  it("un error del GET muestra el mensaje y no presenta el formulario", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({ error: { message: "Organización no encontrada" } }, { status: 404 }),
      ),
    );
    renderPage();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Organización no encontrada");
    expect(screen.queryByLabelText("Moneda de preferencia")).not.toBeInTheDocument();
  });
});

describe("OrganizationSettingsPage — guardado", () => {
  it("guardar manda el PATCH con los dos campos y muestra el toast", async () => {
    const { getPatchedBody } = mockSettings(
      makeOrganizationSettings({ preferredCurrency: "USD", alternateCurrency: null }),
    );
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("Moneda de preferencia")).toHaveValue("USD"));
    await user.selectOptions(screen.getByLabelText("Moneda alternativa"), "UYU");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() =>
      expect(getPatchedBody()).toEqual({ preferredCurrency: "USD", alternateCurrency: "UYU" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Configuración guardada");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("'Sin configurar' viaja como null explícito (desconfigura), no se omite", async () => {
    const { getPatchedBody } = mockSettings(
      makeOrganizationSettings({ preferredCurrency: "USD", alternateCurrency: "UYU" }),
    );
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("Moneda alternativa")).toHaveValue("UYU"));
    await user.selectOptions(screen.getByLabelText("Moneda alternativa"), "");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() =>
      expect(getPatchedBody()).toEqual({ preferredCurrency: "USD", alternateCurrency: null }),
    );
  });

  it("el 400 de monedas iguales se muestra tal cual llega del backend, sin toast", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json(
          makeOrganizationSettings({ preferredCurrency: "USD", alternateCurrency: "UYU" }),
        ),
      ),
      http.patch(baseUrl, () =>
        HttpResponse.json(
          {
            error: {
              message: "La moneda de preferencia y la alternativa no pueden ser la misma",
            },
          },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("Moneda alternativa")).toHaveValue("UYU"));
    await user.selectOptions(screen.getByLabelText("Moneda alternativa"), "USD");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "La moneda de preferencia y la alternativa no pueden ser la misma",
    );
    expect(screen.getByRole("status")).toHaveTextContent("");
    // El formulario sigue editable con lo elegido: no se pierde nada.
    expect(screen.getByLabelText("Moneda alternativa")).toHaveValue("USD");
  });
});
