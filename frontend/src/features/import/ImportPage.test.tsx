import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeSource } from "../../test/sourceFixtures";
import { ImportPage } from "./ImportPage";
import { IMPORT_MAX_FILE_BYTES } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const sourcesUrl = `${env.apiUrl}/api/sources`;
const importsUrl = `${env.apiUrl}/api/imports`;

function renderPage(id = "src1") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/sources/${id}/import`]}>
        <Routes>
          <Route path="/sources/:id/import" element={<ImportPage />} />
          <Route path="/sources" element={<p>listado de fuentes</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function csv(nombre = "leads.csv", contenido = "Nombre,Mail\nAna,ana@x.test\n"): File {
  return new File([contenido], nombre, { type: "text/csv" });
}

function sourceHandler(overrides = {}) {
  return http.get(`${sourcesUrl}/:id`, () =>
    HttpResponse.json(makeSource({ id: "src1", name: "Feria", type: "FILE_IMPORT", ...overrides })),
  );
}

describe("ImportPage — la fuente tiene que corresponder", () => {
  it("una fuente que NO es FILE_IMPORT no ofrece el formulario", async () => {
    // Cubre entrar por URL escrita a mano: el cross-link de SourceListPage solo
    // aparece en las FILE_IMPORT, pero la URL es editable.
    server.use(sourceHandler({ type: "WEBHOOK", name: "Landing" }));
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(/no es de tipo Importación/);
    expect(screen.queryByLabelText(/Archivo/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Importar" })).not.toBeInTheDocument();
  });

  it("una fuente que no existe muestra el error del backend", async () => {
    server.use(
      http.get(`${sourcesUrl}/:id`, () =>
        HttpResponse.json({ error: { message: "Fuente no encontrada" } }, { status: 404 }),
      ),
    );
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Fuente no encontrada");
  });

  it("una fuente pausada avisa, porque el backend la rechaza", async () => {
    server.use(sourceHandler({ isActive: false }));
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(/pausada/);
  });
});

describe("ImportPage — validación antes de la red", () => {
  it("una extensión no soportada se avisa SIN llamar al backend", async () => {
    let subidas = 0;
    server.use(
      sourceHandler(),
      http.post(importsUrl, () => {
        subidas += 1;
        return HttpResponse.json({}, { status: 202 });
      }),
    );

    // applyAccept es opción de SETUP, no del call: user-event la lee de
    // this.config al filtrar los archivos. El input declara accept=".csv,.xlsx"
    // y user-event lo respeta, igual que el diálogo del browser — sin
    // desactivarlo el archivo ni se selecciona y no se ejercitaría nada.
    //
    // Pero accept es una sugerencia, no una garantía: un drag & drop lo saltea.
    // Por eso la validación defensiva tiene que existir, y por eso se prueba
    // desactivando el filtro en vez de confiar en él.
    const user = userEvent.setup({ applyAccept: false });
    renderPage();
    const input = await screen.findByLabelText(/Archivo/);

    await user.upload(input, csv("notas.txt", "hola"));
    await user.click(screen.getByRole("button", { name: "Importar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Formato no soportado/);
    expect(subidas).toBe(0);
  });

  it("un archivo por encima del tope se avisa SIN llamar al backend", async () => {
    let subidas = 0;
    server.use(
      sourceHandler(),
      http.post(importsUrl, () => {
        subidas += 1;
        return HttpResponse.json({}, { status: 202 });
      }),
    );

    const user = userEvent.setup();
    renderPage();
    const input = await screen.findByLabelText(/Archivo/);

    const grande = new File(["x".repeat(IMPORT_MAX_FILE_BYTES + 1)], "grande.csv", {
      type: "text/csv",
    });
    await user.upload(input, grande);
    await user.click(screen.getByRole("button", { name: "Importar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/supera el máximo/);
    expect(subidas).toBe(0);
  });

  it("sin archivo elegido avisa y no llama al backend", async () => {
    let subidas = 0;
    server.use(
      sourceHandler(),
      http.post(importsUrl, () => {
        subidas += 1;
        return HttpResponse.json({}, { status: 202 });
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText(/Archivo/);

    await user.click(screen.getByRole("button", { name: "Importar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Elegí un archivo/);
    expect(subidas).toBe(0);
  });
});

describe("ImportPage — subida y resultado", () => {
  const resultado = {
    batchId: "batch-1",
    encabezados: ["Nombre", "Mail"],
    filasLeidas: 12,
    insertados: 10,
    duplicados: 2,
  };

  it("una subida exitosa manda el multipart y muestra el panel con los números", async () => {
    let cuerpoCrudo: string | undefined;
    server.use(
      sourceHandler(),
      // Se lee el cuerpo CRUDO en vez de req.formData(): el parseo de multipart
      // del lado del servidor no está disponible en este entorno de test. Sirve
      // igual, o mejor: afirma sobre el multipart real que salió por la red,
      // boundary incluido.
      http.post(importsUrl, async ({ request: req }) => {
        cuerpoCrudo = await req.text();
        return HttpResponse.json(resultado, { status: 202 });
      }),
    );

    const user = userEvent.setup();
    renderPage();
    const input = await screen.findByLabelText(/Archivo/);

    await user.upload(input, csv());
    await user.click(screen.getByRole("button", { name: "Importar" }));

    // El multipart llevó el sourceId de la URL y el archivo.
    await waitFor(() => expect(cuerpoCrudo).toBeDefined());
    expect(cuerpoCrudo).toContain('name="sourceId"');
    expect(cuerpoCrudo).toContain("src1");
    expect(cuerpoCrudo).toContain('name="file"');
    // No se afirma el filename: en este entorno la serialización de FormData
    // escribe filename="blob" en vez del nombre real del File. Es un artefacto
    // del polyfill, no del código — un browser manda el nombre. Lo que sí
    // importa y sí se verifica es que las dos partes viajaron con sus nombres
    // de campo correctos.

    // Y el panel quedó en la pantalla, no en un modal.
    expect(await screen.findByText("Resultado de la importación")).toBeInTheDocument();
    expect(screen.getByText("batch-1")).toBeInTheDocument();
    expect(screen.getByText("Filas leídas: 12")).toBeInTheDocument();
    expect(screen.getByText("Eventos creados: 10")).toBeInTheDocument();
    expect(screen.getByText("Filas ya importadas antes (no se duplicaron): 2")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("un error del backend se muestra y no aparece el panel", async () => {
    server.use(
      sourceHandler(),
      http.post(importsUrl, () =>
        HttpResponse.json({ error: { message: "La fuente está pausada" } }, { status: 400 }),
      ),
    );

    const user = userEvent.setup();
    renderPage();
    const input = await screen.findByLabelText(/Archivo/);

    await user.upload(input, csv());
    await user.click(screen.getByRole("button", { name: "Importar" }));

    expect(await screen.findByText(/La fuente está pausada/)).toBeInTheDocument();
    expect(screen.queryByText("Resultado de la importación")).not.toBeInTheDocument();
  });

  it("'Actualizar estado' trae el resumen del lote, con sus fallas", async () => {
    let consultas = 0;
    server.use(
      sourceHandler(),
      http.post(importsUrl, () => HttpResponse.json(resultado, { status: 202 })),
      http.get(`${importsUrl}/:batchId`, ({ params }) => {
        consultas += 1;
        return HttpResponse.json({
          batchId: params.batchId,
          total: 12,
          pendientes: 3,
          promovidos: 8,
          fallidos: 1,
          fallas: [{ id: "ev1", errorMessage: "email: email inválido" }],
          fallasOmitidas: 0,
        });
      }),
    );

    const user = userEvent.setup();
    renderPage();
    const input = await screen.findByLabelText(/Archivo/);

    await user.upload(input, csv());
    await user.click(screen.getByRole("button", { name: "Importar" }));
    await screen.findByText("Resultado de la importación");

    // NO hay polling: hasta que no se toca el botón, no se consultó nada.
    expect(consultas).toBe(0);

    await user.click(screen.getByRole("button", { name: "Actualizar estado" }));

    expect(await screen.findByText("Pendientes: 3")).toBeInTheDocument();
    expect(screen.getByText("Promovidos a contactos: 8")).toBeInTheDocument();
    expect(screen.getByText("Fallidos: 1")).toBeInTheDocument();

    const tabla = within(screen.getByRole("table"));
    expect(tabla.getByText("email: email inválido")).toBeInTheDocument();
  });

  it("si hay fallas omitidas lo dice explícitamente — nunca truncar en silencio", async () => {
    server.use(
      sourceHandler(),
      http.post(importsUrl, () => HttpResponse.json(resultado, { status: 202 })),
      http.get(`${importsUrl}/:batchId`, () =>
        HttpResponse.json({
          batchId: "batch-1",
          total: 5000,
          pendientes: 0,
          promovidos: 0,
          fallidos: 5000,
          fallas: [{ id: "ev1", errorMessage: "falló" }],
          fallasOmitidas: 4999,
        }),
      ),
    );

    const user = userEvent.setup();
    renderPage();
    const input = await screen.findByLabelText(/Archivo/);

    await user.upload(input, csv());
    await user.click(screen.getByRole("button", { name: "Importar" }));
    await screen.findByText("Resultado de la importación");
    await user.click(screen.getByRole("button", { name: "Actualizar estado" }));

    expect(await screen.findByText(/4999 quedaron afuera/)).toBeInTheDocument();
  });
});

describe("ImportPage — Q-B: link al listado de eventos del lote", () => {
  it("el panel ofrece 'Ver estas filas' con el batchId del lote recién creado", async () => {
    // Las dos vistas se complementan: acá los contadores agregados, allá la cola
    // fila por fila con el motivo de cada falla y el botón de reintentar.
    server.use(
      sourceHandler(),
      http.post(importsUrl, () =>
        HttpResponse.json(
          {
            batchId: "batch-77",
            encabezados: ["Nombre"],
            filasLeidas: 3,
            insertados: 3,
            duplicados: 0,
          },
          { status: 202 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderPage();
    const input = await screen.findByLabelText(/Archivo/);

    await user.upload(input, csv());
    await user.click(screen.getByRole("button", { name: "Importar" }));

    const link = await screen.findByRole("link", { name: "Ver estas filas" });
    expect(link).toHaveAttribute("href", "/ingestion-events?batchId=batch-77");
  });

  it("sin subida todavía, el link no existe", async () => {
    server.use(sourceHandler());
    renderPage();
    await screen.findByLabelText(/Archivo/);

    expect(screen.queryByRole("link", { name: "Ver estas filas" })).not.toBeInTheDocument();
  });
});
