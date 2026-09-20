import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeBranch } from "../../test/branchFixtures";
import { makeKnowledgeBaseEntry } from "../../test/knowledgeBaseFixtures";
import { chooseSelectOption } from "../../test/chooseSelectOption";
import { AdminRoute } from "../../auth/AdminRoute";
import { ProtectedRoute } from "../../auth/ProtectedRoute";
import type { AuthContextValue } from "../../auth/AuthContext";
import { KnowledgeBaseFormPage } from "./KnowledgeBaseFormPage";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// Solo lo usa el bloque de AdminRoute del final: el formulario no consume
// useAuth.
const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

function mockAuth(role: "ADMIN" | "USER"): AuthContextValue {
  return {
    status: "authenticated",
    me: {
      id: "u1",
      email: "a@x.com",
      fullName: "A",
      organizationId: "org-1",
      role,
      isPlatformAdmin: false,
    },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

const baseUrl = `${env.apiUrl}/api/knowledge-base`;
const branchesUrl = `${env.apiUrl}/api/branches`;

function mockBranches() {
  return http.get(branchesUrl, () =>
    HttpResponse.json({
      data: [makeBranch(), makeBranch({ id: "b2", name: "Sucursal Chuy" })],
      pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
    }),
  );
}

// Se renderiza dentro de un Routes real para que useParams vea (o no vea) el
// :id — es lo único que distingue el modo creación del de edición.
function renderForm(ruta: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route path="/knowledge-base/new" element={<KnowledgeBaseFormPage />} />
          <Route path="/knowledge-base/:id/edit" element={<KnowledgeBaseFormPage />} />
          <Route path="/knowledge-base" element={<p>listado</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// El contenido se PEGA en vez de tipearse: es lo que una persona hace de
// verdad con un párrafo, y el test no depende de cientos de eventos de teclado.
async function escribirContenido(user: ReturnType<typeof userEvent.setup>, texto: string) {
  const campo = screen.getByLabelText("Contenido");
  await user.clear(campo);
  await user.click(campo);
  await user.paste(texto);
}

describe("KnowledgeBaseFormPage — creación", () => {
  it("manda el POST con los cuatro campos y vuelve al listado", async () => {
    const bodies: unknown[] = [];
    server.use(
      mockBranches(),
      http.post(baseUrl, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(makeKnowledgeBaseEntry(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/knowledge-base/new");

    await user.type(screen.getByLabelText("Título"), "Horarios de atención");
    await waitFor(() => expect(screen.getByLabelText("Sucursal")).toBeInTheDocument());
    await chooseSelectOption(user, screen.getByLabelText("Sucursal"), "Sucursal Chuy");
    await escribirContenido(user, "Lunes a viernes de 9 a 18.");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText("listado")).toBeInTheDocument());
    expect(bodies).toEqual([
      {
        branchId: "b2",
        title: "Horarios de atención",
        content: "Lunes a viernes de 9 a 18.",
        // Activa por default: una entrada nueva entra al prompt sin que haya
        // que configurar nada.
        isActive: true,
      },
    ]);
  });

  it("no hay traducción ni confirmación: el POST sale directo, sin ningún paso intermedio", async () => {
    let llamadas = 0;
    server.use(
      mockBranches(),
      http.post(baseUrl, () => {
        llamadas += 1;
        return HttpResponse.json(makeKnowledgeBaseEntry(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/knowledge-base/new");

    await user.type(screen.getByLabelText("Título"), "Formas de pago");
    await waitFor(() => expect(screen.getByLabelText("Sucursal")).toBeInTheDocument());
    await chooseSelectOption(user, screen.getByLabelText("Sucursal"), "Sucursal Chuy");
    await escribirContenido(user, "Efectivo, débito y crédito hasta 6 cuotas.");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    // A diferencia de las reglas del agente (ítem 56), esto es texto plano que
    // se usa tal cual: no hay panel de "esto es lo que entendimos".
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(llamadas).toBe(1));
  });

  it("guardar como inactiva: se manda isActive false", async () => {
    const bodies: { isActive?: boolean }[] = [];
    server.use(
      mockBranches(),
      http.post(baseUrl, async ({ request }) => {
        bodies.push((await request.json()) as { isActive?: boolean });
        return HttpResponse.json(makeKnowledgeBaseEntry(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/knowledge-base/new");

    await user.type(screen.getByLabelText("Título"), "Promo de invierno");
    await waitFor(() => expect(screen.getByLabelText("Sucursal")).toBeInTheDocument());
    await chooseSelectOption(user, screen.getByLabelText("Sucursal"), "Sucursal Chuy");
    await escribirContenido(user, "20% en todos los servicios.");
    await user.click(screen.getByLabelText("Activa"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(bodies[0]?.isActive).toBe(false));
  });

  it("con la lista de sucursales todavía cargando no sale ninguna request y se explica por qué", async () => {
    // El hueco que BranchSelect documenta y que cada formulario cubre por su
    // cuenta: mientras la lista carga NO hay ningún input que el `required`
    // del navegador pueda frenar, así que el submit llega y lo tiene que
    // detener validar(). Con la lista ya cargada este camino no se alcanza —
    // el propio <form> bloquea antes.
    let llamadas = 0;
    server.use(
      http.get(branchesUrl, () => new Promise(() => undefined)),
      http.post(baseUrl, () => {
        llamadas += 1;
        return HttpResponse.json(makeKnowledgeBaseEntry(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/knowledge-base/new");

    await user.type(screen.getByLabelText("Título"), "Horarios");
    await escribirContenido(user, "Lunes a viernes de 9 a 18.");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Elegí la sucursal a la que pertenece esta entrada.",
    );
    expect(llamadas).toBe(0);
  });

  it("Título y Contenido son requeridos por el navegador, y llevan el tope del backend", async () => {
    server.use(mockBranches());
    renderForm("/knowledge-base/new");

    const titulo = screen.getByLabelText("Título");
    expect(titulo).toBeRequired();
    expect(titulo).toHaveAttribute("maxLength", "200");

    const contenido = screen.getByLabelText("Contenido");
    expect(contenido).toBeRequired();
    expect(contenido).toHaveAttribute("maxLength", "10000");
  });

  it("un POST fallido muestra el mensaje del backend y NO navega", async () => {
    server.use(
      mockBranches(),
      http.post(baseUrl, () =>
        HttpResponse.json(
          { error: { message: "content no puede superar los 10000 caracteres" } },
          { status: 400 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderForm("/knowledge-base/new");

    await user.type(screen.getByLabelText("Título"), "Muy larga");
    await waitFor(() => expect(screen.getByLabelText("Sucursal")).toBeInTheDocument());
    await chooseSelectOption(user, screen.getByLabelText("Sucursal"), "Sucursal Chuy");
    await escribirContenido(user, "x".repeat(50));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "content no puede superar los 10000 caracteres",
    );
    expect(screen.queryByText("listado")).not.toBeInTheDocument();
  });
});

describe("KnowledgeBaseFormPage — edición", () => {
  it("hidrata los cuatro campos con lo que devuelve el GET", async () => {
    server.use(
      mockBranches(),
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json(
          makeKnowledgeBaseEntry({
            title: "Política de cancelación",
            content: "Se puede cancelar hasta 24 horas antes.",
            branchId: "b2",
            isActive: false,
          }),
        ),
      ),
    );

    renderForm("/knowledge-base/kb1/edit");

    expect(await screen.findByLabelText("Título")).toHaveValue("Política de cancelación");
    expect(screen.getByLabelText("Contenido")).toHaveValue(
      "Se puede cancelar hasta 24 horas antes.",
    );
    expect(screen.getByLabelText("Activa")).not.toBeChecked();
    await waitFor(() => expect(screen.getByLabelText("Sucursal")).toHaveValue("Sucursal Chuy"));
  });

  it("la sucursal SÍ se puede cambiar, a diferencia del formulario de Agente", async () => {
    const bodies: { branchId?: string }[] = [];
    server.use(
      mockBranches(),
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json(makeKnowledgeBaseEntry({ branchId: "b1" })),
      ),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        bodies.push((await request.json()) as { branchId?: string });
        return HttpResponse.json(makeKnowledgeBaseEntry({ branchId: "b2" }));
      }),
    );

    const user = userEvent.setup();
    renderForm("/knowledge-base/kb1/edit");

    // Habilitado, no deshabilitado con una explicación: no hay ningún dato
    // histórico que dependa de la sucursal de una entrada de KB.
    const sucursal = await screen.findByLabelText("Sucursal");
    expect(sucursal).toBeEnabled();
    await chooseSelectOption(user, sucursal, "Sucursal Chuy");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText("listado")).toBeInTheDocument());
    expect(bodies[0]?.branchId).toBe("b2");
  });

  it("el PATCH manda los cuatro campos, no un diff", async () => {
    const bodies: unknown[] = [];
    server.use(
      mockBranches(),
      http.get(`${baseUrl}/:id`, () => HttpResponse.json(makeKnowledgeBaseEntry())),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(makeKnowledgeBaseEntry());
      }),
    );

    const user = userEvent.setup();
    renderForm("/knowledge-base/kb1/edit");

    const titulo = await screen.findByLabelText("Título");
    await user.clear(titulo);
    await user.type(titulo, "Horarios");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText("listado")).toBeInTheDocument());
    // "La entrada queda así" es más simple que un diff, y el PATCH parcial lo
    // acepta — mismo criterio que Agent, Branch y Source.
    expect(bodies).toEqual([
      {
        branchId: "b1",
        title: "Horarios",
        content: "Lunes a viernes de 9 a 18. Sábados de 9 a 13.",
        isActive: true,
      },
    ]);
  });

  it("un GET fallido muestra el error y no renderiza el formulario", async () => {
    server.use(
      mockBranches(),
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json(
          { error: { message: "Entrada de la base de conocimiento no encontrada" } },
          { status: 404 },
        ),
      ),
    );

    renderForm("/knowledge-base/kb1/edit");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Entrada de la base de conocimiento no encontrada",
    );
    expect(screen.queryByLabelText("Título")).not.toBeInTheDocument();
  });
});

// Misma jerarquía real que app/router.tsx — el formulario es ADMIN-only por
// ruta, igual que el listado.
function renderUnderAdminRoute(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/companies" element={<div>lista de empresas</div>} />
            <Route element={<AdminRoute />}>
              <Route path="/knowledge-base/new" element={<KnowledgeBaseFormPage />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("KnowledgeBaseFormPage — bajo AdminRoute", () => {
  it("un USER entrando a /knowledge-base/new es redirigido", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    server.use(mockBranches());

    renderUnderAdminRoute("/knowledge-base/new");

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Nueva entrada" })).not.toBeInTheDocument();
  });

  it("un ADMIN sí ve el formulario", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(mockBranches());

    renderUnderAdminRoute("/knowledge-base/new");

    expect(await screen.findByRole("heading", { name: "Nueva entrada" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Ítem 60 — completar el Contenido subiendo un archivo.
//
// El endpoint se mockea con MSW: procesar un .docx o un .pdf de verdad es el
// trabajo del backend y ya está probado ahí (knowledgeBaseExtraction.service
// .test.ts y su integración). Lo que se prueba acá es lo que SOLO se ve desde
// la pantalla: que el texto cae en el campo, la confirmación antes de pisar lo
// que ya estaba escrito, el aviso de truncamiento y que un error del endpoint
// no le cuesta a nadie lo que venía cargando.
// ---------------------------------------------------------------------------

const extractUrl = `${baseUrl}/extract-text`;
const ETIQUETA_ARCHIVO = "Completar desde un archivo (.txt, .docx o .pdf)";

// El contenido del File no importa —MSW responde lo que el test diga— pero el
// nombre y el mimetype sí son los reales, y son lo que el test verifica que
// viaje en el multipart.
function archivo(nombre: string, tipo: string): File {
  return new File(["da igual: el backend es quien lo lee"], nombre, { type: tipo });
}

const TXT = ["un .txt", "horarios.txt", "text/plain"] as const;
const DOCX = [
  "un .docx",
  "politica.docx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;
const PDF = ["un .pdf", "formas-de-pago.pdf", "application/pdf"] as const;

function extractOk(text: string, truncated = false) {
  return http.post(extractUrl, () => HttpResponse.json({ text, truncated }));
}

function extractError(status: number, message: string) {
  return http.post(extractUrl, () => HttpResponse.json({ error: { message } }, { status }));
}

// La sucursal es lo único que no se puede tocar hasta que su lista cargó, así
// que cada caso espera por ella antes de empezar.
async function abrirFormularioNuevo() {
  renderForm("/knowledge-base/new");
  await waitFor(() => expect(screen.getByLabelText("Sucursal")).toBeInTheDocument());
}

function inputDeArchivo(): HTMLElement {
  return screen.getByLabelText(ETIQUETA_ARCHIVO);
}

describe("KnowledgeBaseFormPage — completar desde un archivo (ítem 60)", () => {
  afterEach(() => {
    // window.confirm se espía en varios casos de abajo y este proyecto no tiene
    // restoreMocks global: sin esto el espía sobreviviría al test que lo puso.
    vi.restoreAllMocks();
  });

  it.each([TXT, DOCX, PDF])(
    "%s sube al endpoint de extracción y su texto cae en el campo Contenido",
    async (_etiqueta, nombre, tipo) => {
      let cuerpoCrudo: string | undefined;
      server.use(
        mockBranches(),
        // Se lee el cuerpo CRUDO y no request.formData(): el parseo de
        // multipart del lado del servidor no está disponible en este entorno
        // de test — mismo camino que ImportPage.test.tsx, que lo deja anotado.
        // Sirve igual, o mejor: afirma sobre el multipart real que salió por
        // la red, con su boundary y sus encabezados de parte.
        http.post(extractUrl, async ({ request }) => {
          cuerpoCrudo = await request.text();
          return HttpResponse.json({ text: "Lunes a viernes de 9 a 18.", truncated: false });
        }),
      );

      const user = userEvent.setup();
      await abrirFormularioNuevo();

      await user.upload(inputDeArchivo(), archivo(nombre, tipo));

      await waitFor(() =>
        expect(screen.getByLabelText("Contenido")).toHaveValue("Lunes a viernes de 9 a 18."),
      );
      // Viaja en el campo "file" —el que espera knowledgeBaseUpload— y con su
      // mimetype, que es exactamente lo que mira el fileFilter del middleware
      // para aceptar o rechazar el formato.
      //
      // El nombre del archivo NO se afirma: el FormData de undici en este
      // entorno serializa la parte como filename="blob" y pierde el nombre
      // real. Es una limitación del test, no del navegador, y no es lo que
      // decide nada del lado del backend — ahí manda el mimetype.
      expect(cuerpoCrudo).toContain('name="file"');
      expect(cuerpoCrudo).toContain(`Content-Type: ${tipo}`);
    },
  );

  it("el texto extraído queda editable: es una carga inicial, no otra fuente de verdad", async () => {
    const bodies: { content?: string }[] = [];
    server.use(
      mockBranches(),
      extractOk("Lunes a viernes de 9 a 18."),
      http.post(baseUrl, async ({ request }) => {
        bodies.push((await request.json()) as { content?: string });
        return HttpResponse.json(makeKnowledgeBaseEntry(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    await abrirFormularioNuevo();

    await user.upload(inputDeArchivo(), archivo(TXT[1], TXT[2]));
    await waitFor(() =>
      expect(screen.getByLabelText("Contenido")).toHaveValue("Lunes a viernes de 9 a 18."),
    );

    await user.type(screen.getByLabelText("Contenido"), " Sábados de 9 a 13.");
    await user.type(screen.getByLabelText("Título"), "Horarios");
    await chooseSelectOption(user, screen.getByLabelText("Sucursal"), "Sucursal Chuy");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(bodies[0]?.content).toBe("Lunes a viernes de 9 a 18. Sábados de 9 a 13."),
    );
  });

  it("con el campo Contenido vacío no pregunta nada", async () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    server.use(mockBranches(), extractOk("Horarios nuevos."));

    const user = userEvent.setup();
    await abrirFormularioNuevo();

    await user.upload(inputDeArchivo(), archivo(TXT[1], TXT[2]));

    await waitFor(() => expect(screen.getByLabelText("Contenido")).toHaveValue("Horarios nuevos."));
    expect(confirmar).not.toHaveBeenCalled();
  });

  it("con contenido ya escrito pide confirmación antes de pisarlo", async () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    server.use(mockBranches(), extractOk("Lo que dice el archivo."));

    const user = userEvent.setup();
    await abrirFormularioNuevo();
    await escribirContenido(user, "Lo que ya estaba escrito a mano.");

    await user.upload(inputDeArchivo(), archivo(TXT[1], TXT[2]));

    expect(confirmar).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByLabelText("Contenido")).toHaveValue("Lo que dice el archivo."),
    );
  });

  it("cancelar la confirmación no pisa nada y ni siquiera sube el archivo", async () => {
    let llamadas = 0;
    vi.spyOn(window, "confirm").mockReturnValue(false);
    server.use(
      mockBranches(),
      http.post(extractUrl, () => {
        llamadas += 1;
        return HttpResponse.json({ text: "No debería llegar acá.", truncated: false });
      }),
    );

    const user = userEvent.setup();
    await abrirFormularioNuevo();
    await escribirContenido(user, "Lo que ya estaba escrito a mano.");

    await user.upload(inputDeArchivo(), archivo(TXT[1], TXT[2]));

    expect(screen.getByLabelText("Contenido")).toHaveValue("Lo que ya estaba escrito a mano.");
    // La confirmación va ANTES de subir: cancelar no gasta el request ni una
    // de las diez extracciones por minuto que permite el endpoint.
    expect(llamadas).toBe(0);
  });

  it("truncated: true muestra el aviso de que el texto se cortó", async () => {
    server.use(mockBranches(), extractOk("Un documento larguísimo.", true));

    const user = userEvent.setup();
    await abrirFormularioNuevo();

    await user.upload(inputDeArchivo(), archivo(PDF[1], PDF[2]));

    expect(await screen.findByText(/se cortó el texto/)).toBeInTheDocument();
  });

  it("truncated: false no muestra ningún aviso de recorte", async () => {
    server.use(mockBranches(), extractOk("Corto y al pie."));

    const user = userEvent.setup();
    await abrirFormularioNuevo();

    await user.upload(inputDeArchivo(), archivo(TXT[1], TXT[2]));

    await waitFor(() => expect(screen.getByLabelText("Contenido")).toHaveValue("Corto y al pie."));
    expect(screen.queryByText(/se cortó el texto/)).not.toBeInTheDocument();
  });

  // Los tres códigos que el endpoint puede devolver, con el mensaje real de
  // cada uno. En los tres el formulario tiene que quedar como estaba.
  it.each([
    [400, "Formato no soportado: se aceptan .txt, .docx y .pdf"],
    [413, "El archivo supera el máximo de 5 MB"],
    [
      422,
      "No se pudo extraer texto de este archivo. Puede ser un PDF escaneado (imagen, sin texto seleccionable) — probá copiarlo y pegarlo a mano.",
    ],
  ] as const)(
    "un %i del endpoint se muestra sin perder lo que ya estaba cargado",
    async (status, mensaje) => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      server.use(mockBranches(), extractError(status, mensaje));

      const user = userEvent.setup();
      await abrirFormularioNuevo();
      await user.type(screen.getByLabelText("Título"), "Horarios");
      await escribirContenido(user, "Lo que ya estaba escrito a mano.");

      await user.upload(inputDeArchivo(), archivo(PDF[1], PDF[2]));

      expect(await screen.findByRole("alert")).toHaveTextContent(mensaje);
      expect(screen.getByLabelText("Título")).toHaveValue("Horarios");
      expect(screen.getByLabelText("Contenido")).toHaveValue("Lo que ya estaba escrito a mano.");
    },
  );

  it("mientras extrae avisa que está trabajando y no deja guardar", async () => {
    let responder: (() => void) | undefined;
    server.use(
      mockBranches(),
      http.post(extractUrl, async () => {
        await new Promise<void>((resolve) => {
          responder = resolve;
        });
        return HttpResponse.json({ text: "Listo.", truncated: false });
      }),
    );

    const user = userEvent.setup();
    await abrirFormularioNuevo();

    await user.upload(inputDeArchivo(), archivo(TXT[1], TXT[2]));

    expect(await screen.findByText("Extrayendo texto…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();

    responder?.();
    await waitFor(() => expect(screen.getByLabelText("Contenido")).toHaveValue("Listo."));
    expect(screen.queryByText("Extrayendo texto…")).not.toBeInTheDocument();
  });

  // El maxLength del textarea frena lo que se TIPEA, no lo que se asigna desde
  // el archivo: sin este aviso el primer indicio de que el texto no entra
  // sería el 400 crudo del POST al guardar.
  it("un texto más largo que el máximo de la entrada avisa cuánto hay que recortar", async () => {
    server.use(mockBranches(), extractOk("x".repeat(10_050)));

    const user = userEvent.setup();
    await abrirFormularioNuevo();

    await user.upload(inputDeArchivo(), archivo(PDF[1], PDF[2]));

    expect(await screen.findByText(/Recortá 50 antes de guardar/)).toBeInTheDocument();
  });

  it("un texto que entra justo en el máximo no avisa nada", async () => {
    server.use(mockBranches(), extractOk("x".repeat(10_000)));

    const user = userEvent.setup();
    await abrirFormularioNuevo();

    await user.upload(inputDeArchivo(), archivo(PDF[1], PDF[2]));

    await waitFor(() => expect(screen.getByLabelText("Contenido")).toHaveValue("x".repeat(10_000)));
    expect(screen.queryByText(/antes de guardar/)).not.toBeInTheDocument();
  });

  // Ítem 61 — el control pasó a ser FileInputButton: el input nativo sigue en
  // el DOM (por eso user.upload no cambió) pero escondido, y el nombre del
  // archivo lo muestra la pantalla.
  it("el nombre del archivo se muestra al elegirlo y se borra si la extracción falla", async () => {
    // El segundo archivo llega con el Contenido ya cargado por el primero, así
    // que pasa por la confirmación de pisar el texto.
    vi.spyOn(window, "confirm").mockReturnValue(true);
    server.use(mockBranches(), extractOk("Horarios nuevos."));

    const user = userEvent.setup();
    await abrirFormularioNuevo();

    expect(inputDeArchivo()).toHaveClass("ds-sr-only");
    expect(screen.getByRole("button", { name: "Elegir archivo" })).toBeInTheDocument();
    expect(screen.getByText("Ningún archivo elegido")).toBeInTheDocument();

    await user.upload(inputDeArchivo(), archivo(TXT[1], TXT[2]));

    await waitFor(() => expect(screen.getByText(TXT[1])).toBeInTheDocument());

    // Un archivo que el backend no pudo leer NO deja su nombre a la vista: el
    // Contenido no salió de ahí.
    server.use(extractError(422, "No se pudo extraer texto de este archivo."));
    await user.upload(inputDeArchivo(), archivo(PDF[1], PDF[2]));

    await screen.findByRole("alert");
    expect(screen.queryByText(PDF[1])).not.toBeInTheDocument();
    expect(screen.getByText("Ningún archivo elegido")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Ítem 67 — quitar el archivo elegido.
//
// Hasta acá, una extracción exitosa dejaba el nombre del archivo a la vista
// para siempre: se limpiaba solo si la extracción fallaba o si se cancelaba la
// confirmación de pisar el contenido, nunca a pedido. Lo que se prueba es que
// el botón deshace la extracción ENTERA —nombre y contenido— y que cancelar el
// confirm no toca ninguna de las dos cosas.
// ---------------------------------------------------------------------------
describe("KnowledgeBaseFormPage — quitar el archivo elegido (ítem 67)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function botonQuitar(): HTMLElement {
    return screen.getByRole("button", { name: "Quitar archivo elegido" });
  }

  it("sin archivo elegido no hay botón de quitar", async () => {
    server.use(mockBranches());
    await abrirFormularioNuevo();

    expect(screen.getByText("Ningún archivo elegido")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Quitar archivo elegido" }),
    ).not.toBeInTheDocument();
  });

  it("confirmar borra el nombre Y el contenido que el archivo trajo", async () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    server.use(mockBranches(), extractOk("Lunes a viernes de 9 a 18."));

    const user = userEvent.setup();
    await abrirFormularioNuevo();

    await user.upload(inputDeArchivo(), archivo(TXT[1], TXT[2]));
    await waitFor(() =>
      expect(screen.getByLabelText("Contenido")).toHaveValue("Lunes a viernes de 9 a 18."),
    );
    // Con el Contenido vacío la extracción no pregunta nada: este confirm es el
    // del botón de quitar y de nadie más.
    expect(confirmar).not.toHaveBeenCalled();

    await user.click(botonQuitar());

    expect(confirmar).toHaveBeenCalledTimes(1);
    // Las dos cosas a la vez: dejar el texto con el nombre borrado diría que no
    // se cargó ningún archivo, que es justo lo contrario de lo que pasó.
    expect(screen.getByText("Ningún archivo elegido")).toBeInTheDocument();
    expect(screen.queryByText(TXT[1])).not.toBeInTheDocument();
    expect(screen.getByLabelText("Contenido")).toHaveValue("");
    // Y el botón se va con el archivo.
    expect(
      screen.queryByRole("button", { name: "Quitar archivo elegido" }),
    ).not.toBeInTheDocument();
  });

  it("cancelar el confirm no cambia nada: ni el nombre ni el contenido", async () => {
    server.use(mockBranches(), extractOk("Lunes a viernes de 9 a 18."));

    const user = userEvent.setup();
    await abrirFormularioNuevo();

    await user.upload(inputDeArchivo(), archivo(TXT[1], TXT[2]));
    await waitFor(() =>
      expect(screen.getByLabelText("Contenido")).toHaveValue("Lunes a viernes de 9 a 18."),
    );

    // El espía se pone recién acá para que la extracción de arriba no lo vea.
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.click(botonQuitar());

    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(screen.getByText(TXT[1])).toBeInTheDocument();
    expect(screen.getByLabelText("Contenido")).toHaveValue("Lunes a viernes de 9 a 18.");
  });

  it("volver a vacío es todo lo que puede hacer: no restaura lo que había antes del archivo", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    server.use(mockBranches(), extractOk("Lo que dice el archivo."));

    const user = userEvent.setup();
    await abrirFormularioNuevo();
    await escribirContenido(user, "Lo que ya estaba escrito a mano.");

    // Este primer confirm es el de pisar el contenido; el segundo, el de quitar.
    await user.upload(inputDeArchivo(), archivo(TXT[1], TXT[2]));
    await waitFor(() =>
      expect(screen.getByLabelText("Contenido")).toHaveValue("Lo que dice el archivo."),
    );

    await user.click(botonQuitar());

    // "Lo que ya estaba escrito a mano." NO vuelve, y no es un caso sin cubrir:
    // la extracción reemplaza el contenido por completo y ese texto no quedó
    // guardado en ningún lado. El mensaje del confirm lo dice antes.
    expect(screen.getByLabelText("Contenido")).toHaveValue("");
  });

  it("también se lleva el aviso de que el texto se había cortado", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    server.use(mockBranches(), extractOk("Un documento larguísimo.", true));

    const user = userEvent.setup();
    await abrirFormularioNuevo();

    await user.upload(inputDeArchivo(), archivo(PDF[1], PDF[2]));
    expect(await screen.findByText(/se cortó el texto/)).toBeInTheDocument();

    await user.click(botonQuitar());

    // El aviso hablaba del texto de ese archivo; sin el texto no tiene de qué
    // hablar.
    expect(screen.queryByText(/se cortó el texto/)).not.toBeInTheDocument();
  });

  it("mientras extrae, el botón de quitar está deshabilitado", async () => {
    // Un solo handler con contador y no dos registrados: en MSW el primero que
    // matchea gana para siempre, así que un segundo http.post a la misma URL
    // nunca llegaría a correr.
    let llamadas = 0;
    let responder: (() => void) | undefined;
    server.use(
      mockBranches(),
      http.post(extractUrl, async () => {
        llamadas += 1;
        if (llamadas === 1) {
          return HttpResponse.json({ text: "Primero.", truncated: false });
        }
        await new Promise<void>((resolve) => {
          responder = resolve;
        });
        return HttpResponse.json({ text: "Segundo.", truncated: false });
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();
    await abrirFormularioNuevo();

    // Hace falta un archivo YA elegido para que el botón exista, y una segunda
    // extracción en curso para verlo deshabilitado.
    await user.upload(inputDeArchivo(), archivo(TXT[1], TXT[2]));
    await waitFor(() => expect(screen.getByText(TXT[1])).toBeInTheDocument());

    await user.upload(inputDeArchivo(), archivo(PDF[1], PDF[2]));
    await screen.findByText("Extrayendo texto…");

    // Quitar a mitad de una extracción dejaría el formulario deshaciendo y
    // cargando la misma cosa al mismo tiempo.
    expect(botonQuitar()).toBeDisabled();

    responder?.();
    await waitFor(() => expect(screen.getByLabelText("Contenido")).toHaveValue("Segundo."));
    expect(botonQuitar()).toBeEnabled();
  });
});
