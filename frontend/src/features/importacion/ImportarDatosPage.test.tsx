import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { chooseSelectOption, listSelectOptions } from "../../test/chooseSelectOption";
import { env } from "../../config/env";
import { ImportarDatosPage } from "./ImportarDatosPage";
import type { EstadoDelLote, FilaDelLote, Lote } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// ---------------------------------------------------------------------------
// Plataforma → Importar datos (docs/importacion-de-datos.md §8). Un backend
// falso con estado: el lote pasa de STAGED a READY al guardar el mapeo y de
// READY a DONE al confirmar, que es lo que hace el worker en el de verdad.
// Datos inventados. Que un no platform admin no llegue lo fija
// PlatformAdminRoute como en el resto de Plataforma.
// ---------------------------------------------------------------------------

const ORG = "22222222-2222-4222-8222-222222222222";
const LOTE = "44444444-4444-4444-8444-444444444444";
const base = `${env.apiUrl}/api/admin/organizations/${ORG}/imports`;

let estado: EstadoDelLote;
let crearEmpresas: boolean;
let subidas: Record<string, string>[];
let configs: Record<string, unknown>[];
let decisiones: unknown[];
let confirmaciones: number;
let descargas: string[];

function lote(): Lote {
  return {
    id: LOTE,
    organizationId: ORG,
    sourceId: "55555555-5555-4555-8555-555555555555",
    entityType: "CONTACT",
    status: estado,
    fileName: "contactos.csv",
    rowCount: 3,
    config: {
      archivo: {
        nombre: "contactos.csv",
        encabezados: ["Nombre completo", "Mail", "Etapa"],
        lectura: { separador: ";", codificacion: "utf-8" },
      },
      ajustes:
        estado === "STAGED"
          ? null
          : {
              mapeo: { "Nombre completo": "fullName", Mail: "email", Etapa: "lifecycleStage" },
              formato: {
                fecha: "DD/MM/AAAA",
                separadorDecimal: ",",
                si: ["sí"],
                no: ["no"],
                separadorDeOpciones: ";",
              },
              etapas: { Cliente: "CUSTOMER" },
              duplicados: "FILL_EMPTY",
              crearEmpresas,
            },
    },
    counters:
      estado === "DONE"
        ? {
            final: {
              total: 3,
              porEstado: { PROCESSED: 2, FAILED: 1 },
              porPlan: {},
              porResultado: { CREATED: 1, UPDATED: 1 },
            },
          }
        : estado === "READY"
          ? {
              analisis: {
                empresasNuevas: 2,
                ejemplosDeEmpresasNuevas: ["Ejemplo SA", "Otra SRL"],
                sinClave: 0,
              },
            }
          : null,
    errorMessage: null,
    createdAt: "2026-10-06T12:00:00.000Z",
    confirmedAt: null,
    finishedAt: null,
  };
}

const FILAS: FilaDelLote[] = [
  {
    id: "f1",
    rowNumber: 1,
    rawPayload: { "Nombre completo": "Ana Pérez", Mail: "ana@example.com", Etapa: "Cliente" },
    plan: { tipo: "CREATE", advertencias: [], empresaNueva: "Ejemplo SA" },
    decision: null,
    status: "STAGED",
    outcome: null,
    errorMessage: null,
  },
  {
    id: "f2",
    rowNumber: 2,
    rawPayload: { "Nombre completo": "Beto Gómez", Mail: "beto@example.com", Etapa: "Cliente" },
    plan: {
      tipo: "CONFLICT",
      advertencias: [],
      existenteId: "66666666-6666-4666-8666-666666666666",
      cambios: [
        { campo: "lastName", actual: "Gomez", entrante: "Gómez", accion: "difiere" },
        {
          campo: "email",
          actual: "b@example.com",
          entrante: "beto@example.com",
          accion: "difiere_bloqueado",
          motivo: "no se pisa",
        },
      ],
    },
    decision: null,
    status: "STAGED",
    outcome: null,
    errorMessage: null,
  },
  {
    id: "f3",
    rowNumber: 3,
    rawPayload: { "Nombre completo": "", Mail: "no-es-mail", Etapa: "" },
    plan: { tipo: "FAIL", errores: ["Falta el nombre"], advertencias: [] },
    decision: null,
    status: "STAGED",
    outcome: null,
    errorMessage: null,
  },
];

beforeEach(() => {
  estado = "STAGED";
  crearEmpresas = true;
  subidas = [];
  configs = [];
  decisiones = [];
  confirmaciones = 0;
  descargas = [];
  server.use(
    http.get(`${env.apiUrl}/api/admin/organizations`, () =>
      HttpResponse.json([
        { id: ORG, name: "Concesionaria Ejemplo", slug: "concesionaria-ejemplo" },
      ]),
    ),
    http.get(`${base}/options`, () =>
      HttpResponse.json({
        usuarios: [],
        fuentes: [],
        camposPersonalizados: [
          {
            key: "forma_de_pago",
            label: "Forma de pago",
            type: "MULTI_SELECT",
            options: ["Contado"],
          },
        ],
      }),
    ),
    http.get(base, () => HttpResponse.json({ data: [], total: 0, page: 1, pageSize: 10 })),
    http.get(`${base}/syncs`, () => HttpResponse.json([])),
    http.post(base, async ({ request }) => {
      // El cuerpo CRUDO, como ImportPage.test.tsx: el parseo de multipart del
      // lado del servidor no está en este entorno. Cada campo de texto es una
      // parte con su name y su valor.
      const crudo = await request.text();
      const campos: Record<string, string> = {};
      for (const [, nombre, valor] of crudo.matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)\r\n/g)) {
        campos[nombre] = valor;
      }
      if (crudo.includes('name="file"')) campos.file = "archivo";
      subidas.push(campos);
      return HttpResponse.json(
        {
          lote: lote(),
          encabezados: ["Nombre completo", "Mail", "Etapa"],
          lectura: { separador: ";", codificacion: "utf-8" },
          muestra: FILAS.map((f) => f.rawPayload),
          mapeoSugerido: { "Nombre completo": "fullName", Mail: "email" },
        },
        { status: 201 },
      );
    }),
    http.get(`${base}/${LOTE}`, () =>
      HttpResponse.json({
        lote: lote(),
        resumen: {
          total: 3,
          porEstado: {},
          porPlan: { CREATE: 1, CONFLICT: 1, FAIL: 1 },
          porResultado: {},
        },
      }),
    ),
    http.get(`${base}/${LOTE}/rows`, () =>
      HttpResponse.json({ data: FILAS, total: FILAS.length, page: 1, pageSize: 50 }),
    ),
    http.put(`${base}/${LOTE}/config`, async ({ request }) => {
      const cuerpo = (await request.json()) as Record<string, unknown>;
      configs.push(cuerpo);
      crearEmpresas = cuerpo.crearEmpresas as boolean;
      estado = "READY";
      return HttpResponse.json(lote());
    }),
    http.patch(`${base}/${LOTE}/rows`, async ({ request }) => {
      decisiones.push(await request.json());
      return HttpResponse.json({ actualizadas: 1 });
    }),
    http.post(`${base}/${LOTE}/confirm`, () => {
      confirmaciones++;
      estado = "DONE";
      return HttpResponse.json({ confirmadas: 3 });
    }),
    http.get(`${base}/${LOTE}/failed.csv`, () => {
      descargas.push("failed");
      return new HttpResponse("﻿Nombre;Motivo\r\n", { headers: { "Content-Type": "text/csv" } });
    }),
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
  URL.createObjectURL = vi.fn(() => "blob:ficticio");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderPage(entrada = "/admin/imports") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entrada]}>
        <ImportarDatosPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ImportarDatosPage", () => {
  it("de punta a punta: organización, archivo, mapeo, vista previa con decisión por fila, confirmar e informe con el CSV de fallidas", async () => {
    const user = userEvent.setup();
    renderPage();

    await chooseSelectOption(
      user,
      await screen.findByRole("combobox", { name: "Organización" }),
      "Concesionaria Ejemplo",
    );
    await chooseSelectOption(
      user,
      await screen.findByRole("combobox", { name: "Qué se importa" }),
      "Contactos",
    );
    await user.type(screen.getByLabelText("Nombre del sistema de origen"), "Planilla de ventas");
    const archivo = new File(["Nombre completo;Mail\nAna;ana@example.com\n"], "contactos.csv", {
      type: "text/csv",
    });
    await user.upload(screen.getByLabelText(/Archivo/), archivo);
    await user.click(screen.getByRole("button", { name: "Subir y continuar" }));

    await waitFor(() => expect(subidas).toHaveLength(1));
    expect(subidas[0]).toMatchObject({
      entityType: "CONTACT",
      sourceName: "Planilla de ventas",
      file: "archivo",
    });

    // El mapeo sugerido viene precargado; se suma la etapa.
    const etapa = await screen.findByRole("combobox", { name: "Etapa" });
    await chooseSelectOption(user, etapa, "Etapa");
    // Con la columna de etapa mapeada aparece el valor de la muestra.
    await chooseSelectOption(
      user,
      await screen.findByRole("combobox", { name: "Cliente" }),
      "Cliente",
    );
    await user.click(screen.getByRole("button", { name: "Ver la vista previa" }));

    await waitFor(() => expect(configs).toHaveLength(1));
    expect(configs[0]).toMatchObject({
      mapeo: { "Nombre completo": "fullName", Mail: "email", Etapa: "lifecycleStage" },
      etapas: { Cliente: "CUSTOMER" },
      duplicados: "FILL_EMPTY",
      crearEmpresas: true,
    });

    // Vista previa.
    expect(await screen.findByText("Se crearán 2 empresas")).toBeInTheDocument();
    expect(await screen.findByText(/Fila 2: Beto Gómez/)).toBeInTheDocument();
    expect(screen.getByText("Falta el nombre")).toBeInTheDocument();
    expect(screen.getByText(/en el CRM «Gomez», en el archivo «Gómez»/)).toBeInTheDocument();
    expect(screen.getByText(/No se pisa: en el CRM «b@example.com»/)).toBeInTheDocument();

    await chooseSelectOption(
      user,
      screen.getByRole("combobox", { name: "Qué hacer con la fila 2" }),
      "Pisar con lo del archivo",
    );
    await waitFor(() => expect(decisiones).toEqual([{ rowIds: ["f2"], decision: "OVERWRITE" }]));

    await user.click(screen.getByRole("button", { name: "Confirmar e importar" }));
    await waitFor(() => expect(confirmaciones).toBe(1));

    // Informe.
    const informe = await screen.findByRole("heading", { name: "Informe" });
    const tarjeta = informe.closest("section") ?? document.body;
    expect(within(tarjeta as HTMLElement).getByText("Creados").nextSibling).toHaveTextContent("1");
    await user.click(screen.getByRole("button", { name: "Descargar filas fallidas" }));
    await waitFor(() => expect(descargas).toEqual(["failed"]));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("deshacer: desde el informe, con confirmación; la deshecha muestra lo borrado y lo que se dejó con su motivo", async () => {
    estado = "DONE";
    let pedidos = 0;
    server.use(
      http.post(`${base}/${LOTE}/undo`, () => {
        pedidos++;
        estado = "UNDONE";
        return HttpResponse.json(lote());
      }),
      http.get(`${base}/${LOTE}`, () => {
        const l = lote();
        if (estado === "UNDONE") {
          l.counters = {
            ...l.counters,
            deshacer: {
              borrados: { CONTACT: 2, COMPANY: 1 },
              omitidos: [
                {
                  tipo: "CONTACT",
                  id: "77777777-7777-4777-8777-777777777777",
                  motivo: "ya tiene uso propio en el CRM (activities)",
                },
              ],
              totalOmitidos: 1,
            },
          };
        }
        return HttpResponse.json({
          lote: l,
          resumen: { total: 3, porEstado: {}, porPlan: {}, porResultado: {} },
        });
      }),
    );
    const user = userEvent.setup();
    renderPage(`/admin/imports?organizationId=${ORG}&batchId=${LOTE}`);
    await user.click(await screen.findByRole("button", { name: "Deshacer lo creado" }));
    await waitFor(() => expect(pedidos).toBe(1));
    expect(window.confirm).toHaveBeenCalled();
    expect(
      await screen.findByText(/Se dieron de baja 2 contactos, 1 empresas/),
    ).toBeInTheDocument();
    expect(screen.getByText(/ya tiene uso propio en el CRM \(activities\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deshacer lo creado" })).not.toBeInTheDocument();
  });

  it("historial: el autor por defecto es el ADMIN más antiguo, y los valores de tipo se asignan; el PUT lleva historial", async () => {
    const historial = (): Lote => ({
      ...lote(),
      entityType: "ACTIVITY",
      config: {
        archivo: {
          nombre: "historial.csv",
          encabezados: ["ID Cliente", "Tipo", "Texto"],
          lectura: { separador: ";", codificacion: "utf-8" },
        },
        ajustes: null,
      },
    });
    server.use(
      http.get(`${base}/options`, () =>
        HttpResponse.json({
          usuarios: [
            {
              id: "u-vend",
              email: "vende@example.com",
              fullName: "Vendedora Antigua",
              rol: "USER",
            },
            { id: "u-admin", email: "admin@example.com", fullName: "Admin Antiguo", rol: "ADMIN" },
            { id: "u-admin2", email: "admin2@example.com", fullName: "Admin Nuevo", rol: "ADMIN" },
          ],
          fuentes: [],
          camposPersonalizados: [],
        }),
      ),
      http.get(`${base}/${LOTE}`, () =>
        HttpResponse.json({
          lote: historial(),
          resumen: { total: 2, porEstado: {}, porPlan: {}, porResultado: {} },
        }),
      ),
      http.get(`${base}/${LOTE}/rows`, () =>
        HttpResponse.json({
          data: [
            {
              ...FILAS[0],
              rawPayload: { "ID Cliente": "C-1", Tipo: "Llamada", Texto: "No atendió" },
            },
          ],
          total: 1,
          page: 1,
          pageSize: 50,
        }),
      ),
    );
    const user = userEvent.setup();
    renderPage(`/admin/imports?organizationId=${ORG}&batchId=${LOTE}`);
    const autor = await screen.findByRole("combobox", { name: "Autor de las actividades" });
    expect(autor).toHaveValue("Admin Antiguo");
    await chooseSelectOption(
      user,
      screen.getByRole("combobox", { name: "ID Cliente" }),
      "Id del contacto en el origen",
    );
    await chooseSelectOption(
      user,
      screen.getByRole("combobox", { name: "Tipo" }),
      "Tipo (nota, llamada o tarea)",
    );
    await chooseSelectOption(user, screen.getByRole("combobox", { name: "Texto" }), "Texto");
    await chooseSelectOption(
      user,
      await screen.findByRole("combobox", { name: "Llamada" }),
      "Llamada",
    );
    await user.click(screen.getByRole("button", { name: "Ver la vista previa" }));
    await waitFor(() => expect(configs).toHaveLength(1));
    expect(configs[0]).toMatchObject({
      mapeo: { "ID Cliente": "contactExternalId", Tipo: "type", Texto: "body" },
      historial: { autorId: "u-admin", tipos: { Llamada: "CALL" } },
    });
  });

  it("stock: con una sola sucursal se elige sola, el responsable es el ADMIN más antiguo, y el PUT lleva stock con los estados", async () => {
    const stock = (): Lote => ({
      ...lote(),
      entityType: "VEHICLE",
      config: {
        archivo: {
          nombre: "stock.csv",
          encabezados: ["Marca", "Modelo", "Año", "Estado"],
          lectura: { separador: ";", codificacion: "utf-8" },
        },
        ajustes: null,
      },
    });
    server.use(
      http.get(`${base}/options`, () =>
        HttpResponse.json({
          usuarios: [
            { id: "u-admin", email: "admin@example.com", fullName: "Admin Antiguo", rol: "ADMIN" },
          ],
          fuentes: [],
          camposPersonalizados: [],
          sucursales: [{ id: "b-1", name: "Sucursal Ficticia" }],
        }),
      ),
      http.get(`${base}/${LOTE}`, () =>
        HttpResponse.json({
          lote: stock(),
          resumen: { total: 1, porEstado: {}, porPlan: {}, porResultado: {} },
        }),
      ),
      http.get(`${base}/${LOTE}/rows`, () =>
        HttpResponse.json({
          data: [
            {
              ...FILAS[0],
              rawPayload: {
                Marca: "Marca Ficticia",
                Modelo: "Modelo A",
                Año: 2020,
                Estado: "Reservada",
              },
            },
          ],
          total: 1,
          page: 1,
          pageSize: 50,
        }),
      ),
    );
    const user = userEvent.setup();
    renderPage(`/admin/imports?organizationId=${ORG}&batchId=${LOTE}`);
    expect(
      await screen.findByRole("combobox", { name: "Sucursal de las unidades nuevas" }),
    ).toHaveValue("Sucursal Ficticia");
    expect(
      screen.getByRole("combobox", { name: "Responsable de los cambios en las fichas" }),
    ).toHaveValue("Admin Antiguo");
    for (const [columna, destino] of [
      ["Marca", "Marca"],
      ["Modelo", "Modelo"],
      ["Año", "Año"],
      ["Estado", "Estado"],
    ]) {
      await chooseSelectOption(user, screen.getByRole("combobox", { name: columna }), destino);
    }
    await chooseSelectOption(
      user,
      await screen.findByRole("combobox", { name: "Reservada" }),
      "Reservada (entra como No disponible)",
    );
    await user.click(screen.getByRole("button", { name: "Ver la vista previa" }));
    await waitFor(() => expect(configs).toHaveLength(1));
    expect(configs[0]).toMatchObject({
      mapeo: { Marca: "make", Modelo: "model", Año: "year", Estado: "status" },
      stock: {
        branchId: "b-1",
        responsableId: "u-admin",
        importarVendidas: false,
        estados: { Reservada: "RESERVED" },
      },
    });
  });

  it("stock terminado: el informe dice cuántas fotos se bajaron y cuántas no, y descarga el CSV de las que no", async () => {
    estado = "DONE";
    let pedidas = 0;
    server.use(
      http.get(`${base}/${LOTE}`, () =>
        HttpResponse.json({
          lote: { ...lote(), entityType: "VEHICLE" },
          resumen: { total: 2, porEstado: {}, porPlan: {}, porResultado: {} },
          fotos: { DONE: 3, FAILED: 1, SKIPPED: 1 },
        }),
      ),
      http.get(`${base}/${LOTE}/photos.csv`, () => {
        pedidas++;
        return new HttpResponse("Unidad;Link\r\n", { headers: { "Content-Type": "text/csv" } });
      }),
    );
    const user = userEvent.setup();
    renderPage(`/admin/imports?organizationId=${ORG}&batchId=${LOTE}`);
    expect(await screen.findByText(/Fotos: 3 bajadas, 2 sin bajar/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Descargar fotos sin bajar" }));
    await waitFor(() => expect(pedidas).toBe(1));
  });

  it("«No crear empresas» vuelve a mandar los ajustes con crearEmpresas: false", async () => {
    estado = "READY";
    const user = userEvent.setup();
    renderPage(`/admin/imports?organizationId=${ORG}&batchId=${LOTE}`);
    await user.click(await screen.findByRole("button", { name: "No crear empresas" }));
    await waitFor(() => expect(configs).toHaveLength(1));
    expect(configs[0]).toMatchObject({ crearEmpresas: false });
  });

  it("Google Sheets: solo aparece para el stock, manda el link a /sheets y muestra por qué no se pudo leer", async () => {
    const pedidos: unknown[] = [];
    server.use(
      http.post(`${base}/sheets`, async ({ request }) => {
        pedidos.push(await request.json());
        return HttpResponse.json(
          { error: { message: "La planilla no está compartida con el enlace" } },
          { status: 400 },
        );
      }),
    );
    const user = userEvent.setup();
    renderPage(`/admin/imports?organizationId=${ORG}`);
    const tipo = await screen.findByRole("combobox", { name: "Qué se importa" });
    await chooseSelectOption(user, tipo, "Contactos");
    expect(screen.queryByRole("combobox", { name: "De dónde" })).not.toBeInTheDocument();
    await chooseSelectOption(user, tipo, "Stock de vehículos");
    await chooseSelectOption(
      user,
      screen.getByRole("combobox", { name: "De dónde" }),
      "Un link de Google Sheets",
    );
    await user.type(screen.getByLabelText("Nombre del sistema de origen"), "Planilla");
    await user.type(
      screen.getByLabelText("Link de la planilla"),
      "https://docs.google.com/spreadsheets/d/1PlanillaFicticia_0123456789/edit",
    );
    await user.click(screen.getByRole("button", { name: "Subir y continuar" }));
    expect(
      await screen.findByText(/No pudimos leer la planilla: La planilla no está compartida/),
    ).toBeInTheDocument();
    expect(pedidos).toEqual([
      {
        entityType: "VEHICLE",
        sourceName: "Planilla",
        sheetUrl: "https://docs.google.com/spreadsheets/d/1PlanillaFicticia_0123456789/edit",
      },
    ]);
  });

  it("sincronizar: un lote de Google Sheets ofrece la casilla, y confirmar manda el intervalo y las faltantes", async () => {
    estado = "READY";
    const cuerpos: unknown[] = [];
    server.use(
      http.get(`${base}/${LOTE}`, () =>
        HttpResponse.json({
          lote: { ...lote(), entityType: "VEHICLE", originKind: "GOOGLE_SHEETS_LINK" },
          resumen: { total: 3, porEstado: {}, porPlan: { CREATE: 3 }, porResultado: {} },
        }),
      ),
      http.get(`${base}/${LOTE}/rows`, () =>
        HttpResponse.json({ data: [], total: 0, page: 1, pageSize: 50 }),
      ),
      http.post(`${base}/${LOTE}/confirm`, async ({ request }) => {
        cuerpos.push(await request.json());
        return HttpResponse.json({ confirmadas: 3, syncId: "s-1" });
      }),
    );
    const user = userEvent.setup();
    renderPage(`/admin/imports?organizationId=${ORG}&batchId=${LOTE}`);
    await user.click(await screen.findByLabelText("Mantener sincronizado con la planilla"));
    expect(
      screen.getByText(/En cada sincronización se actualizan los campos mapeados/),
    ).toBeInTheDocument();
    const horas = screen.getByLabelText(/Cada cuántas horas/);
    await user.clear(horas);
    await user.type(horas, "0");
    expect(screen.getByRole("button", { name: "Confirmar e importar" })).toBeDisabled();
    await user.clear(horas);
    await user.type(horas, "12");
    await user.click(screen.getByLabelText(/Pasar a No disponible/));
    await user.click(screen.getByRole("button", { name: "Confirmar e importar" }));
    await waitFor(() =>
      expect(cuerpos).toEqual([{ sincronizar: { intervalHours: 12, marcarFaltantes: true } }]),
    );
  });

  it("un lote de archivo no ofrece sincronizar y confirma sin cuerpo de sincronización", async () => {
    estado = "READY";
    const cuerpos: unknown[] = [];
    server.use(
      http.post(`${base}/${LOTE}/confirm`, async ({ request }) => {
        cuerpos.push(await request.json());
        return HttpResponse.json({ confirmadas: 3, syncId: null });
      }),
    );
    const user = userEvent.setup();
    renderPage(`/admin/imports?organizationId=${ORG}&batchId=${LOTE}`);
    await user.click(await screen.findByRole("button", { name: "Confirmar e importar" }));
    await waitFor(() => expect(cuerpos).toEqual([{}]));
    expect(
      screen.queryByLabelText("Mantener sincronizado con la planilla"),
    ).not.toBeInTheDocument();
  });

  it("sincronizaciones: la pausada por fallas se resalta con su error; reanudar, pausar y borrar llaman al backend", async () => {
    const llamadas: string[] = [];
    const sync = (extra: Record<string, unknown>) => ({
      id: "s-1",
      source: { name: "Planilla de stock" },
      intervalHours: 6,
      markMissingUnavailable: false,
      nextRunAt: new Date().toISOString(),
      lastRunAt: new Date(Date.now() - 14 * 3_600_000).toISOString(),
      lastStatus: "FAILED",
      lastError: "La planilla no está compartida con el enlace",
      consecutiveFailures: 3,
      pausedAt: new Date().toISOString(),
      pausedReason: "AUTO_FAILURES",
      createdAt: new Date().toISOString(),
      ultimaCorrida: { id: LOTE, status: "DONE", createdAt: new Date().toISOString() },
      ...extra,
    });
    server.use(
      http.get(`${base}/syncs`, () =>
        HttpResponse.json([
          sync({}),
          sync({
            id: "s-2",
            pausedAt: null,
            pausedReason: null,
            lastStatus: "OK",
            lastError: null,
          }),
        ]),
      ),
      http.post(`${base}/syncs/:id/:que`, ({ params }) => {
        llamadas.push(`${String(params.que)} ${String(params.id)}`);
        return HttpResponse.json({});
      }),
      http.delete(`${base}/syncs/:id`, ({ params }) => {
        llamadas.push(`delete ${String(params.id)}`);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderPage(`/admin/imports?organizationId=${ORG}`);
    expect(await screen.findByText("Pausada: falló 3 veces seguidas")).toBeInTheDocument();
    expect(screen.getByText(/Error: La planilla no está compartida/)).toBeInTheDocument();
    expect(screen.getAllByText(/última sincronización hace 14 h/)).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Reanudar" }));
    await user.click(screen.getByRole("button", { name: "Pausar" }));
    await user.click(screen.getAllByRole("button", { name: "Borrar" })[1]);
    await waitFor(() => expect(llamadas).toEqual(["resume s-1", "pause s-2", "delete s-2"]));
  });

  it("un archivo que el backend rechaza muestra el motivo, y no avanza", async () => {
    server.use(
      http.post(base, () =>
        HttpResponse.json(
          {
            error: {
              message:
                "Los archivos .xls no se pueden leer. Guardalo como .xlsx o .csv y volvé a subirlo",
            },
          },
          { status: 415 },
        ),
      ),
    );
    const user = userEvent.setup({ applyAccept: false });
    renderPage(`/admin/imports?organizationId=${ORG}`);
    await chooseSelectOption(
      user,
      await screen.findByRole("combobox", { name: "Qué se importa" }),
      "Empresas",
    );
    await user.type(screen.getByLabelText("Nombre del sistema de origen"), "Vieja");
    await user.upload(screen.getByLabelText(/Archivo/), new File(["x"], "clientes.xls"));
    await user.click(screen.getByRole("button", { name: "Subir y continuar" }));
    expect(
      await screen.findByText(/Guardalo como \.xlsx o \.csv y volvé a subirlo/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ver la vista previa" })).not.toBeInTheDocument();
  });
});

// Ediciones (docs/ediciones.md §2.2, paso E1): una organización destino
// ESENCIAL no tiene empresas. El backend (paso G) rechaza el lote igual.
describe("ImportarDatosPage — organización destino por edición", () => {
  function destino(edition: "COMPLETA" | "ESENCIAL") {
    server.use(
      http.get(`${env.apiUrl}/api/admin/organizations`, () =>
        HttpResponse.json([
          {
            id: ORG,
            name: "Concesionaria Ejemplo",
            slug: "concesionaria-ejemplo",
            edition,
            industry: "AUTOMOTORA",
          },
        ]),
      ),
    );
  }

  async function subirContactos(user: ReturnType<typeof userEvent.setup>) {
    const tipo = await screen.findByRole("combobox", { name: "Qué se importa" });
    await chooseSelectOption(user, tipo, "Contactos");
    await user.type(screen.getByLabelText("Nombre del sistema de origen"), "Planilla");
    await user.upload(
      screen.getByLabelText(/Archivo/),
      new File(["Nombre completo;Mail\nAna;ana@example.com\n"], "contactos.csv", {
        type: "text/csv",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Subir y continuar" }));
    await screen.findByRole("button", { name: "Ver la vista previa" });
  }

  it("ESENCIAL: no se ofrece importar empresas ni crearlas al importar contactos", async () => {
    destino("ESENCIAL");
    const user = userEvent.setup();
    renderPage(`/admin/imports?organizationId=${ORG}`);

    const tipo = await screen.findByRole("combobox", { name: "Qué se importa" });
    const opciones = await listSelectOptions(user, tipo);
    expect(opciones).not.toContain("Empresas");
    expect(opciones).toContain("Contactos");
    await user.keyboard("{Escape}");
    expect(screen.getByText(/^Primero stock/)).toBeInTheDocument();

    await subirContactos(user);
    expect(screen.queryByLabelText("Crear las empresas que no existen")).not.toBeInTheDocument();
  });

  it("COMPLETA: se ofrecen empresas y la casilla de crearlas, como siempre", async () => {
    destino("COMPLETA");
    const user = userEvent.setup();
    renderPage(`/admin/imports?organizationId=${ORG}`);

    const tipo = await screen.findByRole("combobox", { name: "Qué se importa" });
    expect(await listSelectOptions(user, tipo)).toContain("Empresas");
    await user.keyboard("{Escape}");
    expect(screen.getByText(/^Primero empresas y stock/)).toBeInTheDocument();

    await subirContactos(user);
    expect(screen.getByLabelText("Crear las empresas que no existen")).toBeInTheDocument();
  });
});
