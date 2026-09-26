import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { ToastProvider } from "../../design-system/Toast";
import { WhatsappTemplatePage } from "./WhatsappTemplatePage";
import type { WhatsappTemplate } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/whatsapp-templates`;

function makeTemplate(overrides: Partial<WhatsappTemplate> = {}): WhatsappTemplate {
  return {
    id: "tpl-1",
    name: "seguimiento_postventa",
    language: "es_AR",
    bodyText: "Hola {nombre}, gracias por tu compra. Tu opinión: {link} ¡Gracias!",
    status: "PENDING",
    rejectedReason: null,
    createdAt: "2026-09-26T12:00:00.000Z",
    updatedAt: "2026-09-26T12:00:00.000Z",
    ...overrides,
  };
}

// ToastProvider como en App.tsx (la página llama a useToast). Sin router: la
// página no navega, es un singleton que se edita en el lugar.
function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <WhatsappTemplatePage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WhatsappTemplatePage — sin plantilla", () => {
  it("muestra el formulario precargado y la vista previa con los ejemplos", async () => {
    server.use(http.get(baseUrl, () => HttpResponse.json(null)));
    renderPage();

    expect(await screen.findByRole("heading", { name: "Nueva plantilla" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Nombre interno/)).toHaveValue("seguimiento_postventa");
    expect(screen.getByLabelText("Vista previa del mensaje")).toHaveTextContent(
      /Hola Ana, gracias por tu compra.*https:\/\/g\.page\/r\/ejemplo\/review/,
    );
  });

  it("envía nombre, idioma y el texto CON los tokens (la traducción la hace el backend) y muestra la plantilla pendiente", async () => {
    const user = userEvent.setup();
    let enviado: Record<string, unknown> | undefined;
    server.use(
      http.get(baseUrl, () => HttpResponse.json(null)),
      http.post(baseUrl, async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeTemplate({ bodyText: enviado.bodyText as string }), {
          status: 201,
        });
      }),
    );
    renderPage();

    const mensaje = (await screen.findByLabelText(/Mensaje/)) as HTMLTextAreaElement;
    await user.clear(mensaje);
    // paste y no type: type interpreta las llaves como teclas especiales.
    await user.paste("Hola , tu opinión acá: {link} ¡Gracias!");
    // "Insertar {nombre}" lo pone donde está el cursor, y lo deja después.
    mensaje.setSelectionRange(5, 5);
    await user.click(screen.getByRole("button", { name: "Insertar {nombre}" }));
    await waitFor(() =>
      expect(mensaje).toHaveValue("Hola {nombre}, tu opinión acá: {link} ¡Gracias!"),
    );
    await waitFor(() => expect(mensaje.selectionStart).toBe(13));

    await user.click(screen.getByRole("button", { name: "Enviar a Meta para aprobación" }));

    expect(await screen.findByRole("heading", { name: "Plantilla actual" })).toBeInTheDocument();
    expect(enviado).toEqual({
      name: "seguimiento_postventa",
      language: "es_AR",
      bodyText: "Hola {nombre}, tu opinión acá: {link} ¡Gracias!",
    });
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
  });

  it("muestra tal cual el mensaje del 400 del backend (las reglas del texto viven allá)", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(baseUrl, () => HttpResponse.json(null)),
      http.post(baseUrl, () =>
        HttpResponse.json(
          { error: { message: "{nombre} tiene que aparecer antes que {link}" } },
          { status: 400 },
        ),
      ),
    );
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Enviar a Meta para aprobación" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "{nombre} tiene que aparecer antes que {link}",
    );
  });
});

describe("WhatsappTemplatePage — con plantilla", () => {
  it("rechazada: badge Rechazada con el motivo de Meta", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json(makeTemplate({ status: "REJECTED", rejectedReason: "INVALID_FORMAT" })),
      ),
    );
    renderPage();

    expect(await screen.findByText("Rechazada")).toBeInTheDocument();
    expect(screen.getByText(/Meta no la aprobó: INVALID_FORMAT/)).toBeInTheDocument();
  });

  it("'Actualizar estado' repregunta y muestra el estado nuevo", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(baseUrl, () => HttpResponse.json(makeTemplate())),
      http.post(`${baseUrl}/tpl-1/refresh`, () =>
        HttpResponse.json(makeTemplate({ status: "APPROVED" })),
      ),
    );
    renderPage();

    expect(await screen.findByText("Pendiente")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Actualizar estado" }));

    expect(await screen.findByText("Aprobada")).toBeInTheDocument();
  });

  it("'Borrar y volver a intentar' confirma, borra y deja el formulario precargado con lo que se borró", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let borrado = false;
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json(
          makeTemplate({
            name: "mi_plantilla",
            status: "REJECTED",
            bodyText: "Hola {nombre}, mirá: {link} chau",
          }),
        ),
      ),
      http.delete(`${baseUrl}/tpl-1`, () => {
        borrado = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Borrar y volver a intentar" }));

    expect(await screen.findByRole("heading", { name: "Nueva plantilla" })).toBeInTheDocument();
    expect(borrado).toBe(true);
    expect(screen.getByLabelText(/Nombre interno/)).toHaveValue("mi_plantilla");
    expect(screen.getByLabelText(/Mensaje/)).toHaveValue("Hola {nombre}, mirá: {link} chau");
  });

  it("si no se confirma, no borra nada", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    let borrado = false;
    server.use(
      http.get(baseUrl, () => HttpResponse.json(makeTemplate())),
      http.delete(`${baseUrl}/tpl-1`, () => {
        borrado = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Borrar y volver a intentar" }));

    expect(borrado).toBe(false);
    expect(screen.getByRole("heading", { name: "Plantilla actual" })).toBeInTheDocument();
  });
});
