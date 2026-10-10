import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { Express, Request } from "express";
import {
  CAMPOS_POR_RUTA,
  MODULOS,
  MODULOS_POR_EDICION,
  MODULOS_SIN_RUTAS,
  RUTAS_POR_MODULO,
  RUTAS_PUBLICAS,
  moduloDeLaRuta,
  modulosDe,
} from "./ediciones";
import { authenticate } from "../middlewares/authenticate";
import {
  CAMPO_NO_INCLUIDO,
  MODULO_NO_INCLUIDO,
  exigirModuloDeLaEdicion,
  rutaDelRequest,
} from "../middlewares/moduloDeLaEdicion";
import type { AuthContext } from "../types/auth";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// El catálogo de ediciones contra el ROUTER REAL (docs/ediciones.md §5.4,
// punto 1). Sin base de datos.
//
// Recorre la app que exporta app.ts y clasifica cada ruta por si su cadena
// tiene `authenticate` (comparando la función, no el nombre). Falla si:
//   - una ruta con `authenticate` no está en RUTAS_POR_MODULO;
//   - una ruta sin `authenticate` no está en RUTAS_PUBLICAS;
//   - una ruta del catálogo ya no existe en el router;
//   - un módulo sin rutas no está declarado en MODULOS_SIN_RUTAS (o uno
//     declarado ahí tiene rutas).
// ---------------------------------------------------------------------------

interface RutaMontada {
  ruta: string;
  autenticada: boolean;
}

interface Capa {
  route?: {
    path: string | string[];
    methods: Record<string, boolean>;
    stack: { handle: unknown }[];
  };
  name: string;
  regexp?: RegExp;
  handle: { stack?: Capa[] };
}

// El prefijo de un router montado con app.use("/api", router), a partir de la
// regexp que arma Express 4: /^\/api\/?(?=\/|$)/i. Los routers sin prefijo
// tienen la regexp de "/" (/^\/?(?=\/|$)/i).
function prefijoDe(capa: Capa): string {
  const fuente = capa.regexp?.source ?? "";
  const crudo = fuente
    .replace(/^\^/, "")
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, "")
    .replace(/\\\//g, "/");
  return crudo === "/" || crudo === "" ? "" : crudo;
}

function rutasMontadas(app: Express): RutaMontada[] {
  const salida: RutaMontada[] = [];
  const recorrer = (pila: Capa[], prefijo: string) => {
    for (const capa of pila) {
      if (capa.route) {
        const paths = Array.isArray(capa.route.path) ? capa.route.path : [capa.route.path];
        const autenticada = capa.route.stack.some((s) => s.handle === authenticate);
        for (const metodo of Object.keys(capa.route.methods)) {
          if (!capa.route.methods[metodo]) continue;
          for (const path of paths) {
            salida.push({ ruta: `${metodo.toUpperCase()} ${prefijo}${path}`, autenticada });
          }
        }
      } else if (capa.name === "router" && capa.handle.stack) {
        recorrer(capa.handle.stack, prefijo + prefijoDe(capa));
      }
    }
  };
  recorrer((app as unknown as { _router: { stack: Capa[] } })._router.stack, "");
  return salida;
}

let montadas: RutaMontada[];

before(async () => {
  process.env.LOG_LEVEL = "fatal";
  const { app }: { app: Express } = await import("../app.js");
  montadas = rutasMontadas(app);
});

const catalogadas = MODULOS.flatMap((m) => RUTAS_POR_MODULO[m]);

test("el recorrido encuentra las rutas de la app (si da pocas, el recorrido está roto)", () => {
  assert.ok(montadas.length > 150, `solo ${String(montadas.length)} rutas`);
  assert.ok(montadas.some((r) => r.ruta === "GET /api/quotes/:id" && r.autenticada));
  assert.ok(montadas.some((r) => r.ruta === "POST /webhooks/whatsapp" && !r.autenticada));
});

test("toda ruta con authenticate está en RUTAS_POR_MODULO", () => {
  const sinClasificar = montadas
    .filter((r) => r.autenticada && moduloDeLaRuta(r.ruta) === undefined)
    .map((r) => r.ruta);
  assert.deepEqual(sinClasificar, [], "clasificar estas rutas en src/config/ediciones.ts");
});

test("toda ruta sin authenticate está en RUTAS_PUBLICAS", () => {
  const sinClasificar = montadas
    .filter((r) => !r.autenticada && !RUTAS_PUBLICAS.includes(r.ruta))
    .map((r) => r.ruta);
  assert.deepEqual(
    sinClasificar,
    [],
    "agregar estas rutas a RUTAS_PUBLICAS (o ponerles authenticate)",
  );
});

test("toda ruta del catálogo existe en el router, y con la autenticación que dice su lista", () => {
  const autenticadas = new Set(montadas.filter((r) => r.autenticada).map((r) => r.ruta));
  const publicas = new Set(montadas.filter((r) => !r.autenticada).map((r) => r.ruta));
  assert.deepEqual(
    catalogadas.filter((r) => !autenticadas.has(r)),
    [],
    "rutas de RUTAS_POR_MODULO que no existen (o no tienen authenticate)",
  );
  assert.deepEqual(
    RUTAS_PUBLICAS.filter((r) => !publicas.has(r)),
    [],
    "rutas de RUTAS_PUBLICAS que no existen (o tienen authenticate)",
  );
});

test("un módulo sin rutas está declarado en MODULOS_SIN_RUTAS, y uno declarado ahí no tiene rutas", () => {
  for (const modulo of MODULOS) {
    const vacio = RUTAS_POR_MODULO[modulo].length === 0;
    assert.equal(
      vacio,
      MODULOS_SIN_RUTAS.has(modulo),
      `${modulo}: ${vacio ? "sin rutas y no está reservado" : "tiene rutas y figura como reservado"}`,
    );
  }
});

test("COMPLETA tiene todos los módulos; ESENCIAL, todos menos los de solo COMPLETA", () => {
  assert.deepEqual([...MODULOS_POR_EDICION.COMPLETA].sort(), [...MODULOS].sort());
  // Por edición sola: los módulos solo de clínica (agenda_clinica, R5) están
  // en las dos ediciones; los saca el rubro, no la edición.
  const fuera = MODULOS.filter((m) => !MODULOS_POR_EDICION.ESENCIAL.has(m)).sort();
  assert.deepEqual(fuera, [
    "cotizaciones",
    "dashboard_comercial",
    "empresas",
    "entregas",
    "financiacion",
    "pagos",
    "permutas",
    "procesos_de_venta",
  ]);
  // Las rutas que no pueden depender de la edición del usuario.
  for (const modulo of ["plataforma", "comun", "dashboard_atencion"] as const) {
    assert.ok(modulosDe("ESENCIAL", "AUTOMOTORA").has(modulo), modulo);
  }
});

test("las rutas con bloqueo por campo están en el catálogo y en un módulo incluido en ESENCIAL", () => {
  for (const ruta of Object.keys(CAMPOS_POR_RUTA)) {
    const modulo = moduloDeLaRuta(ruta);
    assert.ok(modulo, ruta);
    assert.ok(modulosDe("ESENCIAL", "AUTOMOTORA").has(modulo), ruta);
  }
});

// ---------------------------------------------------------------------------
// El gate, sin HTTP: un request falso con la forma que deja Express.
// ---------------------------------------------------------------------------

function pedido(metodo: string, patron: string, body?: unknown): Request {
  return {
    method: metodo,
    baseUrl: "/api",
    route: { path: patron },
    path: patron,
    body,
    log: { error: () => undefined },
  } as unknown as Request;
}

function auth(edition: AuthContext["edition"]): AuthContext {
  return {
    userId: "11111111-1111-1111-1111-111111111111",
    organizationId: "22222222-2222-2222-2222-222222222222",
    role: "ADMIN",
    email: "persona@example.com",
    fullName: "Persona de Prueba",
    edition,
    industry: "AUTOMOTORA",
  };
}

function errorDe(fn: () => void): AppError | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    assert.ok(err instanceof AppError);
    return err;
  }
}

test("rutaDelRequest arma el patrón de Express; HEAD se clasifica como GET", () => {
  assert.equal(rutaDelRequest(pedido("GET", "/quotes/:id")), "GET /api/quotes/:id");
  assert.equal(rutaDelRequest(pedido("HEAD", "/quotes/:id")), "GET /api/quotes/:id");
});

test("COMPLETA: no-op total, incluso para una ruta sin clasificar o un campo excluido", () => {
  assert.equal(
    errorDe(() => exigirModuloDeLaEdicion(pedido("GET", "/quotes"), auth("COMPLETA"))),
    undefined,
  );
  assert.equal(
    errorDe(() => exigirModuloDeLaEdicion(pedido("GET", "/no-existe"), auth("COMPLETA"))),
    undefined,
  );
  assert.equal(
    errorDe(() =>
      exigirModuloDeLaEdicion(
        pedido("POST", "/contacts", { companyId: "33333333-3333-3333-3333-333333333333" }),
        auth("COMPLETA"),
      ),
    ),
    undefined,
  );
});

test("ESENCIAL: ruta de un módulo excluido → 403 MODULO_NO_INCLUIDO con el módulo", () => {
  const err = errorDe(() =>
    exigirModuloDeLaEdicion(pedido("PATCH", "/quotes/:id"), auth("ESENCIAL")),
  );
  assert.equal(err?.statusCode, 403);
  assert.deepEqual(err?.details, {
    code: MODULO_NO_INCLUIDO,
    modulo: "cotizaciones",
    motivo: "EDICION",
  });
});

test("ESENCIAL: ruta sin clasificar → falla cerrado, 403 con modulo sin_clasificar", () => {
  const err = errorDe(() => exigirModuloDeLaEdicion(pedido("GET", "/no-existe"), auth("ESENCIAL")));
  assert.equal(err?.statusCode, 403);
  assert.deepEqual(err?.details, {
    code: MODULO_NO_INCLUIDO,
    modulo: "sin_clasificar",
    motivo: "EDICION",
  });
});

test("ESENCIAL: ruta incluida pasa", () => {
  assert.equal(
    errorDe(() => exigirModuloDeLaEdicion(pedido("GET", "/contacts"), auth("ESENCIAL"))),
    undefined,
  );
  assert.equal(
    errorDe(() => exigirModuloDeLaEdicion(pedido("GET", "/admin/organizations"), auth("ESENCIAL"))),
    undefined,
  );
});

test("ESENCIAL: un campo excluido con valor → 400 CAMPO_NO_INCLUIDO; null o ausente pasa", () => {
  const conEmpresa = errorDe(() =>
    exigirModuloDeLaEdicion(
      pedido("POST", "/contacts", {
        firstName: "Ana",
        companyId: "33333333-3333-3333-3333-333333333333",
      }),
      auth("ESENCIAL"),
    ),
  );
  assert.equal(conEmpresa?.statusCode, 400);
  assert.deepEqual(conEmpresa?.details, {
    code: CAMPO_NO_INCLUIDO,
    campo: "companyId",
    modulo: "empresas",
    motivo: "EDICION",
  });

  const financiacion = errorDe(() =>
    exigirModuloDeLaEdicion(
      pedido("PATCH", "/opportunities/:id", { financingType: "BANK" }),
      auth("ESENCIAL"),
    ),
  );
  assert.deepEqual(financiacion?.details, {
    code: CAMPO_NO_INCLUIDO,
    campo: "financingType",
    modulo: "financiacion",
    motivo: "EDICION",
  });

  const permuta = errorDe(() =>
    exigirModuloDeLaEdicion(
      pedido("PATCH", "/vehicles/:id", {
        tradeInOpportunityId: "33333333-3333-3333-3333-333333333333",
      }),
      auth("ESENCIAL"),
    ),
  );
  assert.deepEqual(permuta?.details, {
    code: CAMPO_NO_INCLUIDO,
    campo: "tradeInOpportunityId",
    modulo: "permutas",
    motivo: "EDICION",
  });

  assert.equal(
    errorDe(() =>
      exigirModuloDeLaEdicion(
        pedido("PATCH", "/contacts/:id", { companyId: null }),
        auth("ESENCIAL"),
      ),
    ),
    undefined,
  );
  assert.equal(
    errorDe(() =>
      exigirModuloDeLaEdicion(pedido("POST", "/contacts", { firstName: "Ana" }), auth("ESENCIAL")),
    ),
    undefined,
  );
  // pipelineId/stageId son de procesos_de_venta (paso B): en ESENCIAL, 400.
  const conProceso = errorDe(() =>
    exigirModuloDeLaEdicion(
      pedido("POST", "/opportunities", { pipelineId: "33333333-3333-3333-3333-333333333333" }),
      auth("ESENCIAL"),
    ),
  );
  assert.deepEqual(conProceso?.details, {
    code: CAMPO_NO_INCLUIDO,
    campo: "pipelineId",
    modulo: "procesos_de_venta",
    motivo: "EDICION",
  });
  const conEtapa = errorDe(() =>
    exigirModuloDeLaEdicion(
      pedido("PATCH", "/opportunities/:id", { stageId: "33333333-3333-3333-3333-333333333333" }),
      auth("ESENCIAL"),
    ),
  );
  assert.equal(conEtapa?.statusCode, 400);
  // En COMPLETA, como siempre.
  assert.equal(
    errorDe(() =>
      exigirModuloDeLaEdicion(
        pedido("POST", "/opportunities", { pipelineId: "33333333-3333-3333-3333-333333333333" }),
        auth("COMPLETA"),
      ),
    ),
    undefined,
  );
});
