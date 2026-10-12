import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { ToastProvider } from "../../design-system/Toast";
import { MensajesDeSaludSection } from "./MensajesDeSaludSection";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// ---------------------------------------------------------------------------
// Mensajes de salud de una clínica (docs/rubros.md §5.3, D11 revisada):
// precargados con el texto por defecto, el aviso de responsabilidad, los
// términos del código en solo lectura, su propio guardado y el último cambio.
// ---------------------------------------------------------------------------

const url = `${env.apiUrl}/api/clinica/mensajes-de-salud`;

const URGENCIA = "Si es una urgencia, llamá ya al 911. Ya le avisamos al equipo de {clinica}.";
const CONSULTA = "Esa consulta la tiene que ver un profesional de {clinica}.";

function respuesta(overrides: Record<string, unknown> = {}) {
  return {
    urgencyMessageText: null,
    clinicalMessageText: null,
    extraUrgencyTerms: [],
    extraClinicalTerms: [],
    porDefecto: {
      urgencyMessageText: URGENCIA,
      clinicalMessageText: CONSULTA,
      urgencyTerms: ["no puedo respirar", "hinch* + cara"],
      clinicalTerms: ["me arde", "es normal"],
    },
    ultimoCambio: null,
    ...overrides,
  };
}

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MensajesDeSaludSection />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("MensajesDeSaludSection", () => {
  it("precarga los textos por defecto, muestra el aviso de responsabilidad y los términos que no se sacan", async () => {
    server.use(http.get(url, () => HttpResponse.json(respuesta())));
    renderSection();

    expect(await screen.findByLabelText("Mensaje de urgencia")).toHaveValue(URGENCIA);
    expect(screen.getByLabelText("Mensaje de consulta clínica")).toHaveValue(CONSULTA);
    expect(
      screen.getByText("El contenido de estos mensajes es responsabilidad de la clínica."),
    ).toBeInTheDocument();
    expect(screen.getByText("no puedo respirar · hinch* + cara")).toBeInTheDocument();
    expect(screen.getByText(/Todavía no se cambiaron/)).toBeInTheDocument();
    // Los términos del código no tienen ✕: no se pueden sacar.
    expect(screen.queryByRole("button", { name: /Quitar no puedo respirar/ })).toBeNull();
  });

  it("guarda con su propio botón: el texto por defecto viaja como null y los términos agregados", async () => {
    let enviado: unknown = null;
    server.use(
      http.get(url, () => HttpResponse.json(respuesta())),
      http.put(url, async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json(
          respuesta({
            extraClinicalTerms: ["botox"],
            ultimoCambio: {
              changedBy: { id: "u1", fullName: "Ana Admin" },
              createdAt: "2026-10-12T15:00:00.000Z",
            },
          }),
        );
      }),
    );
    const user = userEvent.setup();
    renderSection();

    const campo = await screen.findByLabelText("Palabras que también son consulta clínica");
    await user.type(campo, "Botox{Enter}");
    await user.click(screen.getByRole("button", { name: "Guardar mensajes de salud" }));

    await screen.findByText(/Último cambio: Ana Admin/);
    expect(enviado).toEqual({
      urgencyMessageText: null,
      clinicalMessageText: null,
      extraUrgencyTerms: [],
      extraClinicalTerms: ["Botox"],
    });
    const lista = screen.getByRole("list", {
      name: "Palabras que también son consulta clínica agregados",
    });
    expect(within(lista).getByText("botox")).toBeInTheDocument();
  });

  it("muestra el 400 del backend (urgencia sin teléfono) y vuelve al texto por defecto con un botón", async () => {
    server.use(
      http.get(url, () =>
        HttpResponse.json(respuesta({ urgencyMessageText: "Llamá al 105 ya, {clinica}." })),
      ),
      http.put(url, () =>
        HttpResponse.json(
          {
            error: {
              message:
                "El mensaje de urgencia tiene que incluir un teléfono de emergencia (por ejemplo, 911).",
            },
          },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderSection();

    const urgencia = await screen.findByLabelText("Mensaje de urgencia");
    expect(urgencia).toHaveValue("Llamá al 105 ya, {clinica}.");
    await user.clear(urgencia);
    await user.type(urgencia, "Andá a la guardia más cercana.");
    await user.click(screen.getByRole("button", { name: "Guardar mensajes de salud" }));
    expect(await screen.findByText(/tiene que incluir un teléfono/)).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Volver al texto por defecto" })[0]);
    expect(urgencia).toHaveValue(URGENCIA);
  });
});
