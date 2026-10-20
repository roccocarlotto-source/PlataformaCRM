import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { chooseSelectOption } from "../../test/chooseSelectOption";
import { env } from "../../config/env";
import { PreguntasALaAyudaPage } from "./PreguntasALaAyudaPage";
import { porcentaje, tituloDeTema } from "./preguntasALaAyudaFormat";
import type { InformeDePreguntas } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const RUTA = `${env.apiUrl}/api/admin/help-assistant/questions`;

function informe(cambios: Partial<InformeDePreguntas> = {}): InformeDePreguntas {
  return {
    dias: 30,
    resumen: {
      preguntas: 10,
      porResultado: { ANSWERED: 6, NOT_COVERED: 2, DATA_REDIRECT: 1, OFF_TOPIC: 0, ERROR: 1 },
      utiles: 3,
      noUtiles: 1,
      conCache: 4,
      costoUsd: 0.028,
    },
    pantallas: [
      { clave: "contactos", titulo: "Contactos", preguntas: 7 },
      { clave: null, titulo: null, preguntas: 3 },
    ],
    frecuentes: [
      { pregunta: "¿Cómo invito a un vendedor?", veces: 3, ultima: "2026-10-20T12:00:00.000Z" },
    ],
    recientes: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        createdAt: "2026-10-20T12:00:00.000Z",
        industry: "AUTOMOTORA",
        role: "USER",
        screen: "contactos",
        question: "¿Cómo exporto a PDF?",
        sources: ["usuarios-y-permisos#invitar"],
        outcome: "NOT_COVERED",
        feedback: "DOWN",
      },
    ],
    ...cambios,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/help-assistant"]}>
        <PreguntasALaAyudaPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PreguntasALaAyudaPage", () => {
  it("muestra el resumen, las frecuentes, las pantallas y las últimas preguntas", async () => {
    const pedidos: string[] = [];
    server.use(
      http.get(RUTA, ({ request }) => {
        pedidos.push(new URL(request.url).search);
        return HttpResponse.json(informe());
      }),
    );
    renderPage();

    expect(await screen.findByText("¿Cómo invito a un vendedor?")).toBeInTheDocument();
    expect(pedidos[0]).toBe("?dias=30");

    const resumen = screen.getByRole("region", { name: "Resumen" });
    expect(resumen).toHaveTextContent("Preguntas10");
    expect(resumen).toHaveTextContent(
      `6 respondidas con la guía (${porcentaje(6, 10)}), 1 pedían datos, 0 fuera de tema, 1 fallaron`,
    );
    expect(resumen).toHaveTextContent("La guía no lo cubre2");
    expect(resumen).toHaveTextContent("👍 3 · 👎 1");
    expect(resumen).toHaveTextContent("$0.028");
    // 4 de las 9 que no fallaron.
    expect(resumen).toHaveTextContent(`Con caché: ${porcentaje(4, 9)}`);

    expect(screen.getByText("¿Cómo invito a un vendedor?").closest("tr")).toHaveTextContent("3");
    expect(screen.getByText("Sin pantalla").closest("tr")).toHaveTextContent("3");

    const fila = screen.getByText("¿Cómo exporto a PDF?").closest("tr");
    expect(fila).toHaveTextContent("La guía no lo cubre");
    expect(fila).toHaveTextContent("Contactos · Automotora · Usuario");
    expect(fila).toHaveTextContent("Automotora");
    expect(fila).toHaveTextContent("Usuario");
    expect(screen.getByLabelText("No le sirvió")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: tituloDeTema("usuarios-y-permisos#invitar") }),
    ).toHaveAttribute("href", "/ayuda/usuarios-y-permisos#invitar");
  });

  it("cada filtro pide el informe de nuevo con ese filtro", async () => {
    const pedidos: URLSearchParams[] = [];
    server.use(
      http.get(RUTA, ({ request }) => {
        pedidos.push(new URL(request.url).searchParams);
        return HttpResponse.json(informe());
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("¿Cómo invito a un vendedor?");

    await chooseSelectOption(user, screen.getByLabelText("Resultado"), "La guía no lo cubre");
    await waitFor(() => expect(pedidos.at(-1)?.get("outcome")).toBe("NOT_COVERED"));

    await screen.findByText("¿Cómo invito a un vendedor?");
    await chooseSelectOption(user, screen.getByLabelText("Pantalla"), "Contactos");
    await waitFor(() => expect(pedidos.at(-1)?.get("screen")).toBe("contactos"));

    await screen.findByText("¿Cómo invito a un vendedor?");
    await chooseSelectOption(user, screen.getByLabelText("Período"), "Últimos 7 días");
    await waitFor(() => expect(pedidos.at(-1)?.get("dias")).toBe("7"));
    expect(pedidos.at(-1)?.get("outcome")).toBe("NOT_COVERED");

    await screen.findByText("¿Cómo invito a un vendedor?");
    await chooseSelectOption(user, screen.getByLabelText("Resultado"), "Todos");
    await waitFor(() => expect(pedidos.at(-1)?.has("outcome")).toBe(false));
  });

  it("sin preguntas, lo dice en vez de mostrar el informe vacío", async () => {
    server.use(
      http.get(RUTA, () =>
        HttpResponse.json(
          informe({
            resumen: {
              preguntas: 0,
              porResultado: {
                ANSWERED: 0,
                NOT_COVERED: 0,
                DATA_REDIRECT: 0,
                OFF_TOPIC: 0,
                ERROR: 0,
              },
              utiles: 0,
              noUtiles: 0,
              conCache: 0,
              costoUsd: null,
            },
            pantallas: [],
            frecuentes: [],
            recientes: [],
          }),
        ),
      ),
    );
    renderPage();
    expect(await screen.findByText("No hay preguntas")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Resumen" })).not.toBeInTheDocument();
  });

  it("si la API falla, lo dice", async () => {
    server.use(
      http.get(RUTA, () => HttpResponse.json({ error: { message: "Forbidden" } }, { status: 403 })),
    );
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar las preguntas");
  });

  it("tituloDeTema: el título de la guía, y el ancla tal cual si ya no existe", () => {
    expect(tituloDeTema("plataforma#uso-de-ia")).toBe("Uso de IA");
    expect(tituloDeTema("no-existe#tampoco")).toBe("no-existe#tampoco");
  });
});
