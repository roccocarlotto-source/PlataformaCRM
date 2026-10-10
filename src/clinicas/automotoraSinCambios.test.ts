import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { OrganizationEdition } from "@prisma/client";
import type { Request } from "express";
import {
  MODULOS,
  MODULO_DE_LA_TOOL,
  RUTAS_POR_MODULO,
  modulosDe,
  type Modulo,
} from "../config/ediciones";
import { exigirModuloDeLaEdicion } from "../middlewares/moduloDeLaEdicion";
import {
  puedeEjecutarTool,
  type OrganizacionDelAgente,
} from "../services/agentPermissions.service";
import { armarSystemPrompt } from "../services/agentOrchestration.service";
import {
  CATALOGO_DE_TOOLS,
  toolsHabilitadas,
  toolsSinCampos,
} from "../services/agentTools.service";
import {
  createOrganizationWithFoundingAdmin,
  defaultOrganizationAdminDeps,
} from "../services/organizationAdmin.service";
import { SIN_REGLAS, reglasDelRubro } from "../services/reglasDelRubro";
import { crearClienteGoogleCalendar } from "../services/googleCalendar.service";
import { vocabularioDe } from "../config/vocabulario";
import type { AuthContext } from "../types/auth";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// Suite "automotora sin cambios" (docs/rubros.md §0.3 y §14.1), unitaria.
//
// Hace cumplir la regla firme del plan de clínicas: nada de clínicas cambia
// el comportamiento de una automotora. CADA PR DEL PLAN QUE TOCA EL NÚCLEO LE
// AGREGA SU CASO, acá o en el par de integración
// (automotoraSinCambios.integration-test.ts).
//
// Los valores esperados son FIJOS, copiados del comportamiento de antes de
// R2: no salen del catálogo, porque lo que se quiere detectar es justamente
// un cambio del catálogo que le cambie algo a una automotora. Si un PR cambia
// a propósito lo que ve una automotora (un módulo nuevo para todos, una tool
// nueva), actualiza la lista acá y lo dice en su descripción.
//
// Casos de R2: el catálogo de módulos, el gate (rutas, 403 y 400), las tools
// que se ofrecen y se ejecutan, y el prompt del agente. /api/me, contra la
// app real, en el par de integración. Casos de R3: el vocabulario de /api/me
// y el alta sin nada de clínica.
// ---------------------------------------------------------------------------

const EDICIONES: OrganizationEdition[] = ["COMPLETA", "ESENCIAL"];

// Los módulos de una automotora antes de R2, en el orden del catálogo.
const MODULOS_DE_HOY: Record<OrganizationEdition, readonly string[]> = {
  COMPLETA: [
    "comun",
    "plataforma",
    "usuarios",
    "contactos",
    "conversaciones",
    "agentes",
    "canales",
    "base_de_conocimiento",
    "sucursales",
    "agenda",
    "stock",
    "tareas",
    "cupones_y_qr",
    "automatizaciones",
    "oportunidades",
    "campos_personalizados",
    "agente_interno",
    "ingesta",
    "dashboard_atencion",
    "procesos_de_venta",
    "cotizaciones",
    "pagos",
    "entregas",
    "empresas",
    "dashboard_comercial",
    "financiacion",
    "permutas",
  ],
  ESENCIAL: [
    "comun",
    "plataforma",
    "usuarios",
    "contactos",
    "conversaciones",
    "agentes",
    "canales",
    "base_de_conocimiento",
    "sucursales",
    "agenda",
    "stock",
    "tareas",
    "cupones_y_qr",
    "automatizaciones",
    "oportunidades",
    "campos_personalizados",
    "agente_interno",
    "ingesta",
    "dashboard_atencion",
  ],
};

// Las 29 rutas que bloquea ESENCIAL (docs/ediciones.md §5.3), con su módulo.
const BLOQUEADAS_EN_ESENCIAL: Record<string, string> = {
  "GET /api/pipelines": "procesos_de_venta",
  "POST /api/pipelines": "procesos_de_venta",
  "GET /api/pipelines/:id": "procesos_de_venta",
  "PATCH /api/pipelines/:id": "procesos_de_venta",
  "DELETE /api/pipelines/:id": "procesos_de_venta",
  "GET /api/stages": "procesos_de_venta",
  "POST /api/stages": "procesos_de_venta",
  "GET /api/stages/:id": "procesos_de_venta",
  "PATCH /api/stages/:id": "procesos_de_venta",
  "DELETE /api/stages/:id": "procesos_de_venta",
  "GET /api/quotes": "cotizaciones",
  "POST /api/quotes": "cotizaciones",
  "GET /api/quotes/:id": "cotizaciones",
  "PATCH /api/quotes/:id": "cotizaciones",
  "GET /api/payments": "pagos",
  "POST /api/payments": "pagos",
  "GET /api/payments/:id": "pagos",
  "PATCH /api/payments/:id": "pagos",
  "DELETE /api/payments/:id": "pagos",
  "GET /api/deliveries": "entregas",
  "GET /api/deliveries/:id": "entregas",
  "PATCH /api/deliveries/:id": "entregas",
  "GET /api/companies": "empresas",
  "POST /api/companies": "empresas",
  "GET /api/companies/:id": "empresas",
  "PATCH /api/companies/:id": "empresas",
  "DELETE /api/companies/:id": "empresas",
  "GET /api/opportunities/dashboard-summary": "dashboard_comercial",
  "GET /api/opportunities/revenue-series": "dashboard_comercial",
};

// Las 14 tools del catálogo de antes de R2, en su orden.
const TOOLS_DE_HOY = [
  "create_opportunity",
  "update_opportunity",
  "reserve_vehicle",
  "get_availability",
  "create_booking",
  "create_lead",
  "update_lead",
  "update_contact_custom_fields",
  "get_payment_info",
  "get_contact_info",
  "search_vehicles",
  "get_service_types",
  "get_contact_activities",
  "mark_no_interest",
];

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

test("modulosDe(e, AUTOMOTORA) es lo que tenía una automotora antes de R2, en las dos ediciones", () => {
  for (const edition of EDICIONES) {
    assert.deepEqual(
      MODULOS.filter((m) => modulosDe(edition, "AUTOMOTORA").has(m)),
      MODULOS_DE_HOY[edition],
      edition,
    );
  }
});

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

function pedido(metodo: string, patronCompleto: string, body?: unknown): Request {
  const patron = patronCompleto.replace(/^\/api/, "");
  return {
    method: metodo,
    baseUrl: "/api",
    route: { path: patron },
    path: patron,
    body,
    log: { error: () => undefined },
  } as unknown as Request;
}

function automotora(edition: OrganizationEdition): AuthContext {
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

const TODAS_LAS_RUTAS = MODULOS.flatMap((m: Modulo) => RUTAS_POR_MODULO[m]);

test("gate, COMPLETA: no-op total, en todas las rutas, sin clasificar y con cualquier campo", () => {
  const id = "33333333-3333-3333-3333-333333333333";
  for (const ruta of [...TODAS_LAS_RUTAS, "GET /api/no-existe"]) {
    const [metodo, patron] = ruta.split(" ");
    const cuerpo = {
      companyId: id,
      financingType: "BANK",
      tradeInOpportunityId: id,
      vehicleOfInterestId: id,
      opportunityId: id,
    };
    assert.equal(
      errorDe(() =>
        exigirModuloDeLaEdicion(pedido(metodo, patron, cuerpo), automotora("COMPLETA")),
      ),
      undefined,
      ruta,
    );
  }
});

test("gate, ESENCIAL: bloquea exactamente las 29 rutas de siempre, con el 403 de siempre más motivo EDICION", () => {
  const bloqueadas: Record<string, string> = {};
  for (const ruta of TODAS_LAS_RUTAS) {
    const [metodo, patron] = ruta.split(" ");
    const err = errorDe(() =>
      exigirModuloDeLaEdicion(pedido(metodo, patron), automotora("ESENCIAL")),
    );
    if (!err) continue;
    // El cuerpo de antes (code y modulo) intacto, el mismo texto y el mismo
    // status; motivo es el único campo nuevo (D12, aditivo).
    assert.equal(err.statusCode, 403, ruta);
    assert.equal(err.message, "Esta función no está incluida en tu edición.");
    const { code, modulo, motivo, ...resto } = err.details as Record<string, unknown>;
    assert.equal(code, "MODULO_NO_INCLUIDO");
    assert.equal(motivo, "EDICION");
    assert.deepEqual(resto, {}, `${ruta}: campos nuevos en el 403`);
    bloqueadas[ruta] = modulo as string;
  }
  assert.deepEqual(bloqueadas, BLOQUEADAS_EN_ESENCIAL);
});

test("gate, ESENCIAL: los bloqueos por campo son los de siempre; los del rubro no aplican", () => {
  const id = "33333333-3333-3333-3333-333333333333";
  const conEmpresa = errorDe(() =>
    exigirModuloDeLaEdicion(
      pedido("POST", "/api/contacts", { companyId: id }),
      automotora("ESENCIAL"),
    ),
  );
  assert.equal(conEmpresa?.statusCode, 400);
  assert.equal(conEmpresa?.message, "El campo companyId no está incluido en tu edición.");
  assert.deepEqual(conEmpresa?.details, {
    code: "CAMPO_NO_INCLUIDO",
    campo: "companyId",
    modulo: "empresas",
    motivo: "EDICION",
  });

  for (const [metodo, patron, cuerpo] of [
    ["PATCH", "/api/contacts/:id", { vehicleOfInterestId: id }],
    ["POST", "/api/activities", { opportunityId: id }],
    ["PATCH", "/api/activities/:id", { opportunityId: id }],
    ["POST", "/api/bookings", { opportunityId: id }],
  ] as const) {
    assert.equal(
      errorDe(() =>
        exigirModuloDeLaEdicion(pedido(metodo, patron, cuerpo), automotora("ESENCIAL")),
      ),
      undefined,
      `${metodo} ${patron}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

test("el catálogo de tools es el de antes de R2, y cada tool tiene su módulo", () => {
  assert.deepEqual([...CATALOGO_DE_TOOLS.keys()], TOOLS_DE_HOY);
  assert.deepEqual(Object.keys(MODULO_DE_LA_TOOL).sort(), [...TOOLS_DE_HOY].sort());
});

test("tools de una automotora: se ofrecen y se ejecutan todas, en las dos ediciones; una inventada sigue sin ofrecerse", () => {
  for (const edition of EDICIONES) {
    const organizacion: OrganizacionDelAgente = { edition, industry: "AUTOMOTORA" };
    assert.deepEqual(
      toolsHabilitadas([...TOOLS_DE_HOY, "tool_inventada"], organizacion).map(
        (t) => t.definition.name,
      ),
      TOOLS_DE_HOY,
      edition,
    );
    for (const nombre of [...TOOLS_DE_HOY, "tool_inventada"]) {
      assert.deepEqual(
        puedeEjecutarTool(
          { enabledTools: [...TOOLS_DE_HOY, "tool_inventada"], guardrails: {}, organizacion },
          nombre,
          {},
          {},
        ),
        { allowed: true },
        `${edition}: ${nombre}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Prompt del agente: snapshot con datos fijos. El system prompt y las
// definiciones de tools que recibe el modelo de una automotora.
//
// Para regenerarlo cuando un cambio del prompt es a propósito (y entonces no
// es un cambio "de clínicas"): ACTUALIZAR_SNAPSHOTS=1 npx tsx --test
// src/clinicas/automotoraSinCambios.test.ts, y revisar el diff.
// ---------------------------------------------------------------------------

const SNAPSHOT_DEL_PROMPT = path.join(__dirname, "__snapshots__", "prompt-automotora.txt");

test("el prompt y las tools que ve el modelo de un agente de automotora no cambian", () => {
  const prompt = armarSystemPrompt(
    {
      instructions:
        "Sos el asistente de ventas de Automotora Ejemplo. Respondé consultas sobre stock y coordiná un test drive.",
      tone: "Cordial y directo",
      guardrails: {
        temasProhibidos: ["política"],
        accionesProhibidas: ["reserve_vehicle"],
      },
    },
    [],
    { ahora: new Date("2026-10-09T15:00:00.000Z"), zona: "America/Montevideo" },
  );
  const tools = toolsHabilitadas(TOOLS_DE_HOY, { edition: "COMPLETA", industry: "AUTOMOTORA" }).map(
    (t) => t.definition,
  );
  const actual = `${prompt}\n\n----- tools -----\n${JSON.stringify(tools, null, 2)}\n`;

  if (process.env.ACTUALIZAR_SNAPSHOTS === "1") {
    fs.mkdirSync(path.dirname(SNAPSHOT_DEL_PROMPT), { recursive: true });
    fs.writeFileSync(SNAPSHOT_DEL_PROMPT, actual);
  }
  assert.equal(actual, fs.readFileSync(SNAPSHOT_DEL_PROMPT, "utf8"));
});

// ---------------------------------------------------------------------------
// R3: el vocabulario que /api/me le devuelve a una automotora son los textos
// que sus pantallas muestran hoy, escritos acá a mano. Si alguno cambia, es
// un cambio para todas las automotoras y va en su propio PR.
// ---------------------------------------------------------------------------

test("vocabulario de una automotora: los textos de hoy, con o sin término del contacto", () => {
  const esperado = {
    marca: "Plataforma CRM",
    contacto: {
      singular: "cliente",
      plural: "clientes",
      singularTitulo: "Cliente",
      pluralTitulo: "Clientes",
    },
    recurso: {
      singular: "recurso",
      plural: "recursos",
      singularTitulo: "Recurso",
      pluralTitulo: "Recursos",
    },
    tipoDeServicio: {
      singular: "tipo de servicio",
      plural: "tipos de servicio",
      singularTitulo: "Tipo de servicio",
      pluralTitulo: "Tipos de servicio",
    },
    reserva: {
      singular: "reserva",
      plural: "reservas",
      singularTitulo: "Reserva",
      pluralTitulo: "Reservas",
    },
    agenda: {
      singular: "calendario",
      plural: "calendarios",
      singularTitulo: "Calendario",
      pluralTitulo: "Calendarios",
    },
    responsable: {
      singular: "vendedor",
      plural: "vendedores",
      singularTitulo: "Vendedor",
      pluralTitulo: "Vendedores",
    },
  };
  assert.deepEqual(vocabularioDe("AUTOMOTORA", null), esperado);
  assert.deepEqual(vocabularioDe("AUTOMOTORA", "PACIENTE"), esperado);
});

test("el alta de una automotora no crea nada de clínica, aunque CLINICA se habilite", async () => {
  const configuraciones: string[] = [];
  const result = await createOrganizationWithFoundingAdmin(
    {
      organizationName: "Automotora Ejemplo",
      adminFullName: "Persona de Prueba",
      adminEmail: "persona@example.com",
    },
    {
      ...defaultOrganizationAdminDeps,
      supabaseAdmin: () =>
        ({
          auth: {
            admin: {
              inviteUserByEmail: async (email: string) => ({
                data: { user: { id: "11111111-1111-4111-8111-111111111111", email } },
                error: null,
              }),
            },
          },
        }) as never,
      frontendOrigin: "https://app.example.com",
      findUserByEmail: async () => null,
      findPendingInvitationByEmail: async () => null,
      findOrganizationBySlug: async () => null,
      findRoleByName: async () => ({ id: "role-admin" }),
      createOrganization: async (data) => ({ id: "org-nueva", ...data }),
      createProcesoDeVentaFijo: async () =>
        assert.fail("una automotora COMPLETA no tiene proceso fijo"),
      createClinicSettings: async (organizationId) => {
        configuraciones.push(organizationId);
      },
      clinicaHabilitada: true,
      createUser: async (data) => ({ ...data }),
      transaction: (fn) => fn({} as never),
    },
  );
  assert.equal(result.organization.industry, "AUTOMOTORA");
  assert.equal(result.organization.edition, "COMPLETA");
  assert.deepEqual(configuraciones, []);
});

// ---------------------------------------------------------------------------
// R4 (guardrails de salud, docs/rubros.md §5.3): los puntos de extensión del
// loop no tienen nada para una automotora. El prompt sigue siendo el del
// snapshot de arriba, y "me arde la garganta" llega al modelo (eso, contra la
// base, en src/clinicas/guardrailsDeSalud.integration-test.ts).
// ---------------------------------------------------------------------------

test("las reglas del rubro de una automotora están vacías: ningún verificador, instrucción ni campo recortado", () => {
  assert.deepEqual(reglasDelRubro("AUTOMOTORA"), SIN_REGLAS);
  assert.deepEqual(SIN_REGLAS, {
    entradaPrioritaria: [],
    entrada: [],
    salida: [],
    callaDespuesDeDerivar: false,
    instruccionesDelPrompt: [],
    camposFueraDeLasTools: {},
  });
});

test("las tools de una automotora no se recortan: son los mismos objetos del catálogo", () => {
  const tools = toolsHabilitadas(TOOLS_DE_HOY, { edition: "COMPLETA", industry: "AUTOMOTORA" });
  const recortadas = toolsSinCampos(tools, reglasDelRubro("AUTOMOTORA").camposFueraDeLasTools);
  assert.equal(recortadas.length, tools.length);
  recortadas.forEach((tool, i) => assert.equal(tool, tools[i]));
});

// ---------------------------------------------------------------------------
// R7 (canales de Google en su propia tabla, docs/rubros.md §4.6): el pedido de
// autorización de Google de una automotora es EXACTAMENTE el de antes, con los
// mismos dos scopes y los mismos parámetros. Una sucursal ya conectada no
// tiene que volver a autorizar nada. El literal es la URL de antes de R7 con
// una configuración y un state de prueba.
// ---------------------------------------------------------------------------

test("la URL de autorización de Google de una automotora es la de antes, con los mismos dos scopes", () => {
  const url = crearClienteGoogleCalendar({
    clientId: "client-id-de-prueba.apps.googleusercontent.com",
    clientSecret: "secreto-de-prueba",
    redirectUri: "https://api.example.com/api/integrations/google-calendar/callback",
  }).construirUrlDeAutorizacion("state-firmado-de-prueba");

  assert.equal(
    url,
    "https://accounts.google.com/o/oauth2/v2/auth" +
      "?client_id=client-id-de-prueba.apps.googleusercontent.com" +
      "&redirect_uri=https%3A%2F%2Fapi.example.com%2Fapi%2Fintegrations%2Fgoogle-calendar%2Fcallback" +
      "&response_type=code" +
      "&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.events+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.events.freebusy" +
      "&access_type=offline" +
      "&prompt=consent" +
      "&state=state-firmado-de-prueba",
  );
});
