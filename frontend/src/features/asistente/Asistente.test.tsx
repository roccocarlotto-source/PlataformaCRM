import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { ProveedorDelAsistente } from "../../asistente/ProveedorDelAsistente";
import { PageHeader } from "../../design-system/PageHeader";
import { AYUDA } from "../guia/anclas";
import { BotonDelAsistente, HojaDeAyuda } from "./BotonYHojaDelAsistente";
import { PanelDelAsistente } from "./PanelDelAsistente";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const preguntasUrl = `${env.apiUrl}/api/help-assistant/questions`;
const feedbackUrl = (id: string) => `${preguntasUrl}/${id}/feedback`;

function DondeEstoy() {
  return <p data-testid="ruta">{useLocation().pathname}</p>;
}

function renderApp({ disponible = true, ruta = "/contacts" } = {}) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <ProveedorDelAsistente disponible={disponible}>
        <Routes>
          <Route
            path="/contacts"
            element={<PageHeader title="Contactos" help={AYUDA.contactos} />}
          />
          <Route path="/conversations/:id" element={<p>Conversación</p>} />
          <Route path="*" element={<DondeEstoy />} />
        </Routes>
        <BotonDelAsistente />
        <HojaDeAyuda />
        <PanelDelAsistente contactosEnPlural="clientes" />
      </ProveedorDelAsistente>
    </MemoryRouter>,
  );
}

const RESPUESTA = {
  id: "q-1",
  respuesta:
    "1. Abrí [Contactos](/contacts).\n2. Tocá **Nuevo contacto**.\n\nMás en la guía: [Nuevo contacto](/ayuda/contactos-y-consultas#nuevo-contacto)",
  fuentes: [{ titulo: "Nuevo contacto", href: "/ayuda/contactos-y-consultas#nuevo-contacto" }],
  tipo: "ANSWERED",
  restantesHoy: 19,
  firma: "firma-del-servidor",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("el asistente ¿Cómo se hace?", () => {
  it("sin asistente para esta persona no hay botón, y el ? es el link de siempre", () => {
    renderApp({ disponible: false });
    expect(screen.queryByRole("button", { name: /¿Cómo se hace\?/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ayuda de esta pantalla" })).toHaveAttribute(
      "href",
      "/ayuda/contactos-y-consultas#contactos",
    );
  });

  it("no hay botón flotante en el detalle de una conversación", () => {
    renderApp({ ruta: "/conversations/c-1" });
    expect(screen.queryByRole("button", { name: /¿Cómo se hace\?/ })).not.toBeInTheDocument();
  });

  it("pregunta con la pantalla actual, muestra la respuesta con sus links y registra el 👍", async () => {
    const cuerpos: unknown[] = [];
    const feedbacks: unknown[] = [];
    server.use(
      http.post(preguntasUrl, async ({ request }) => {
        cuerpos.push(await request.json());
        return HttpResponse.json(RESPUESTA);
      }),
      http.patch(feedbackUrl("q-1"), async ({ request }) => {
        feedbacks.push(await request.json());
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole("button", { name: /¿Cómo se hace\?/ }));
    expect(screen.getByRole("dialog", { name: "¿Cómo se hace?" })).toBeInTheDocument();
    expect(screen.getByText(/No escribas datos de clientes/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Tu pregunta"), "¿Cómo cargo un cliente?{Enter}");
    expect(await screen.findByRole("link", { name: "Nuevo contacto" })).toHaveAttribute(
      "href",
      "/ayuda/contactos-y-consultas#nuevo-contacto",
    );
    expect(cuerpos).toEqual([{ pregunta: "¿Cómo cargo un cliente?", pantalla: "contactos" }]);

    await user.click(screen.getByRole("button", { name: "Me sirvió" }));
    expect(screen.getByText("Gracias por avisar.")).toBeInTheDocument();
    await waitFor(() => expect(feedbacks).toEqual([{ feedback: "UP" }]));
  });

  it("la segunda pregunta lleva la primera como historial, con la firma del servidor", async () => {
    const cuerpos: { historial?: unknown }[] = [];
    server.use(
      http.post(preguntasUrl, async ({ request }) => {
        cuerpos.push((await request.json()) as { historial?: unknown });
        return HttpResponse.json(RESPUESTA);
      }),
    );
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: /¿Cómo se hace\?/ }));
    await user.type(screen.getByLabelText("Tu pregunta"), "Primera{Enter}");
    await screen.findAllByRole("button", { name: "Me sirvió" });
    await user.type(screen.getByLabelText("Tu pregunta"), "Segunda{Enter}");
    await waitFor(() => expect(cuerpos).toHaveLength(2));
    expect(cuerpos[1].historial).toEqual([
      { pregunta: "Primera", respuesta: RESPUESTA.respuesta, firma: "firma-del-servidor" },
    ]);
  });

  it("AGE-01: una respuesta sin firma (el servidor no firma) no se manda como historial", async () => {
    const cuerpos: { historial?: unknown }[] = [];
    server.use(
      http.post(preguntasUrl, async ({ request }) => {
        cuerpos.push((await request.json()) as { historial?: unknown });
        return HttpResponse.json({ ...RESPUESTA, firma: null });
      }),
    );
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: /¿Cómo se hace?/ }));
    await user.type(screen.getByLabelText("Tu pregunta"), "Primera{Enter}");
    await screen.findAllByRole("button", { name: "Me sirvió" });
    await user.type(screen.getByLabelText("Tu pregunta"), "Segunda{Enter}");
    await waitFor(() => expect(cuerpos).toHaveLength(2));
    expect(cuerpos[1].historial).toBeUndefined();
  });

  it("al llegar al tope del día: el aviso con el link a Ayuda y la caja deshabilitada", async () => {
    server.use(
      http.post(preguntasUrl, () =>
        HttpResponse.json(
          {
            error: {
              message:
                "Llegaste a las 20 preguntas de hoy. Mañana podés seguir preguntando. Mientras tanto, toda la guía está en Ayuda.",
              code: "TOPE_DIARIO_ASISTENTE",
            },
          },
          { status: 429 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: /¿Cómo se hace\?/ }));
    await user.type(screen.getByLabelText("Tu pregunta"), "Una más{Enter}");
    expect(await screen.findByText(/Llegaste a las 20 preguntas de hoy/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ayuda" })).toHaveAttribute("href", "/ayuda");
    expect(screen.getByLabelText("Tu pregunta")).toBeDisabled();
  });

  it("si falla, muestra el mensaje del backend y la pregunta sigue en la charla", async () => {
    server.use(
      http.post(preguntasUrl, () =>
        HttpResponse.json(
          { error: { message: "No pudimos responder ahora. Probá de nuevo en un momento." } },
          { status: 502 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: /¿Cómo se hace\?/ }));
    await user.type(screen.getByLabelText("Tu pregunta"), "Hola{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos responder ahora");
    expect(screen.getByText("Hola")).toBeInTheDocument();
  });

  it("en el celular no hay botón flotante: el ? abre la hoja con las dos opciones", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(max-width: 1023px)",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const user = userEvent.setup();
    renderApp();
    expect(screen.queryByRole("button", { name: /¿Cómo se hace\?/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Ayuda de esta pantalla" }));
    expect(screen.getByRole("button", { name: "Preguntale a la guía" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ver la guía de esta pantalla" }));
    expect(screen.getByTestId("ruta")).toHaveTextContent("/ayuda/contactos-y-consultas");
  });
});
