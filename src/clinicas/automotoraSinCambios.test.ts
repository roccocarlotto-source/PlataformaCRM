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
  SOLO_CLINICA,
  modulosDe,
  toolDelRubro,
  type Modulo,
} from "../config/ediciones";
import { exigirModuloDeLaEdicion } from "../middlewares/moduloDeLaEdicion";
import {
  puedeEjecutarTool,
  type OrganizacionDelAgente,
} from "../services/agentPermissions.service";
import {
  INSTRUCCION_DE_CIERRE_POR_TOPE,
  INSTRUCCION_OPORTUNIDAD_CON_INICIATIVA,
  INSTRUCCION_SIN_AUTORIDAD_COMERCIAL,
  INSTRUCCION_SOLO_LO_QUE_TE_CONSTA,
  MENSAJE_DE_FUGA_BLOQUEADA,
  armarSystemPrompt,
  textosDeAutomotora,
  ENCABEZADO_INDICACIONES,
} from "../services/agentOrchestration.service";
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
import { calcularTurnos } from "../services/availability.service";
import { CAMPOS_DE_CLINICA, sinCamposDeClinica } from "./camposDeClinica";
import { canReadActivity, scopeActivityFiltersToActor } from "../services/activity.service";
import {
  CAPACIDADES,
  estaEnSusSedes,
  filtroDeSedes,
  puede,
  sedesDelActor,
} from "../services/permisos";
import { exigirRolDelRubro } from "../config/ediciones";
import { crearClienteGoogleCalendar } from "../services/googleCalendar.service";
import { vocabularioDe } from "../config/vocabulario";
import type { AuthContext } from "../types/auth";
import { AppError } from "../utils/AppError";
import {
  ACTION_INQUIRY_FOLLOW_UP,
  TEXTO_POR_DEFECTO as TEXTO_POR_DEFECTO_DE_CONSULTA,
  configDeSeguimientoDeConsultaSchema,
  crearAccionSeguimientoDeConsulta,
} from "../services/automationActions/inquiryFollowUp";
import {
  botonesDeLaAccion,
  categoriaDeLaAccion,
  variablesDeLaAccion,
} from "../services/whatsappTemplate.service";
import { validarTextoDePlantilla } from "../utils/whatsappTemplateText";

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

// Las rutas de una automotora: todas menos las de los módulos solo de
// clínica (R5 en adelante), que no existían antes y no son suyas (las prueba
// el test de abajo). Que ningún módulo de una automotora termine en
// SOLO_CLINICA lo fija el primer test (la lista fija de sus módulos).
const TODAS_LAS_RUTAS = MODULOS.filter((m) => !SOLO_CLINICA.has(m)).flatMap(
  (m: Modulo) => RUTAS_POR_MODULO[m],
);
const RUTAS_SOLO_DE_CLINICA = [...SOLO_CLINICA].flatMap((m: Modulo) => RUTAS_POR_MODULO[m]);

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

test("gate: las rutas de los módulos solo de clínica dan 403 con motivo RUBRO a una automotora, en las dos ediciones", () => {
  assert.ok(RUTAS_SOLO_DE_CLINICA.length > 0);
  for (const edition of EDICIONES) {
    for (const ruta of RUTAS_SOLO_DE_CLINICA) {
      const [metodo, patron] = ruta.split(" ");
      const err = errorDe(() =>
        exigirModuloDeLaEdicion(pedido(metodo, patron), automotora(edition)),
      );
      assert.equal(err?.statusCode, 403, `${edition}: ${ruta}`);
      assert.equal(err?.message, "Esta función no está disponible para tu rubro.");
      const detalles = err?.details as Record<string, unknown>;
      assert.equal(detalles.code, "MODULO_NO_INCLUIDO");
      assert.equal(detalles.motivo, "RUBRO");
      assert.ok(SOLO_CLINICA.has(detalles.modulo as Modulo), ruta);
    }
  }
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
    // R5: ninguna tool con versión propia (las de agenda de una clínica).
    toolsPropias: {},
    // R11: ninguna tool exclusiva y los textos del prompt de siempre.
    toolsExclusivas: {},
    textosDelPrompt: null,
  });
});

// ---------------------------------------------------------------------------
// R11: las tools de turnos y los textos del rubro (§3.2) son solo de clínica.
// ---------------------------------------------------------------------------

const TOOLS_DE_TURNOS = ["get_contact_bookings", "reschedule_booking", "cancel_booking"];

test("R11: una automotora no ve ni ejecuta las tools de turnos aunque enabledTools las nombre", () => {
  for (const edition of EDICIONES) {
    const organizacion: OrganizacionDelAgente = { edition, industry: "AUTOMOTORA" };
    assert.deepEqual(
      toolsHabilitadas([...TOOLS_DE_HOY, ...TOOLS_DE_TURNOS], organizacion).map(
        (t) => t.definition.name,
      ),
      TOOLS_DE_HOY,
    );
    for (const nombre of TOOLS_DE_TURNOS) {
      assert.equal(toolDelRubro(nombre, edition, "AUTOMOTORA"), false, nombre);
      assert.equal(
        puedeEjecutarTool({ enabledTools: [nombre], guardrails: {}, organizacion }, nombre, {}, {})
          .allowed,
        false,
        `${edition}: ${nombre}`,
      );
    }
  }
});

test("R11: el prompt de una automotora con los textos de automotora explícitos es el del snapshot, byte a byte", () => {
  const agente = {
    instructions:
      "Sos el asistente de ventas de Automotora Ejemplo. Respondé consultas sobre stock y coordiná un test drive.",
    tone: "Cordial y directo",
    guardrails: { temasProhibidos: ["política"], accionesProhibidas: ["reserve_vehicle"] },
  };
  const contexto = { ahora: new Date("2026-10-09T15:00:00.000Z"), zona: "America/Montevideo" };
  const porDefecto = armarSystemPrompt(agente, [], contexto);
  const explicito = armarSystemPrompt(
    agente,
    [],
    contexto,
    undefined,
    null,
    [],
    undefined,
    [],
    null,
    reglasDelRubro("AUTOMOTORA").instruccionesDelPrompt,
    true,
    textosDeAutomotora(),
  );
  assert.equal(explicito, porDefecto);
  assert.ok(
    fs.readFileSync(SNAPSHOT_DEL_PROMPT, "utf8").startsWith(`${porDefecto}\n\n----- tools -----`),
  );
  // Los textos de automotora son las constantes de siempre.
  assert.deepEqual(textosDeAutomotora(), {
    sinAutoridadComercial: INSTRUCCION_SIN_AUTORIDAD_COMERCIAL,
    soloLoQueTeConsta: INSTRUCCION_SOLO_LO_QUE_TE_CONSTA,
    iniciativa: INSTRUCCION_OPORTUNIDAD_CON_INICIATIVA,
    gestionDeTurnos: null,
    mensajeDeFugaBloqueada: MENSAJE_DE_FUGA_BLOQUEADA,
    cierrePorTope: INSTRUCCION_DE_CIERRE_POR_TOPE,
  });
});

test("las tools de una automotora no se recortan: son los mismos objetos del catálogo", () => {
  const tools = toolsHabilitadas(TOOLS_DE_HOY, { edition: "COMPLETA", industry: "AUTOMOTORA" });
  const recortadas = toolsSinCampos(tools, reglasDelRubro("AUTOMOTORA").camposFueraDeLasTools);
  assert.equal(recortadas.length, tools.length);
  recortadas.forEach((tool, i) => assert.equal(tool, tools[i]));
});

// ---------------------------------------------------------------------------
// R12 (rol Recepción, docs/rubros.md §11): ADMIN y USER pueden exactamente lo
// mismo que antes (cada capacidad de permisos.ts es el `role === "ADMIN"` que
// reemplazó), y una automotora no admite el rol nuevo.
// ---------------------------------------------------------------------------

test("permisos de ADMIN y USER: los de antes de R12", () => {
  for (const capacidad of CAPACIDADES) {
    assert.equal(puede({ role: "ADMIN" }, capacidad), true, capacidad);
    assert.equal(puede({ role: "USER" }, capacidad), false, capacidad);
  }
});

test("en una automotora, asignar RECEPCION da 400; ADMIN y USER se siguen pudiendo asignar", () => {
  assert.throws(
    () => exigirRolDelRubro("RECEPCION", "AUTOMOTORA"),
    (err: unknown) => err instanceof AppError && err.statusCode === 400,
  );
  assert.doesNotThrow(() => exigirRolDelRubro("ADMIN", "AUTOMOTORA"));
  assert.doesNotThrow(() => exigirRolDelRubro("USER", "AUTOMOTORA"));
});

// ---------------------------------------------------------------------------
// R20 (usuarios por sede, docs/rubros.md §11.5): en una automotora nadie queda
// limitado por sede. sedesDelActor da "todas" para ADMIN y USER, el contexto
// de autenticación no tiene la clave `sedes`, y los filtros de sede de los
// listados son los que pidió el cliente, sin agregar nada. Las tareas de un
// USER se acotan como antes (lo suyo), sin mirar la sede.
// ---------------------------------------------------------------------------

test("usuarios por sede: una automotora ve todas las sedes, como antes de R20", () => {
  for (const role of ["ADMIN", "USER"] as const) {
    const auth = { ...automotora("COMPLETA"), role };
    assert.equal("sedes" in auth, false);
    assert.equal(sedesDelActor(auth), "todas");
    assert.deepEqual(filtroDeSedes(auth), {});
    assert.deepEqual(filtroDeSedes(auth, "33333333-3333-3333-3333-333333333333"), {
      branchId: "33333333-3333-3333-3333-333333333333",
    });
    assert.equal(estaEnSusSedes(auth, "33333333-3333-3333-3333-333333333333"), true);
  }
  const usuario = { ...automotora("COMPLETA"), role: "USER" as const };
  assert.deepEqual(scopeActivityFiltersToActor(usuario, { assigneeId: "otra" }), {
    assigneeId: usuario.userId,
  });
  assert.equal(
    canReadActivity(usuario, { assigneeId: "otra", branchId: null }),
    false,
    "un USER sigue sin ver las tareas sin asignar",
  );
});

// ---------------------------------------------------------------------------
// R6 (bloqueos y sobreturnos): sin bloqueos, la cuenta de la disponibilidad es
// la de antes; y las filas de una automotora salen sin las columnas de clínica.
// ---------------------------------------------------------------------------

test("R6: calcularTurnos sin bloqueos da lo mismo que antes, y una automotora no ve columnas de clínica", () => {
  const franja = {
    inicio: new Date("2027-03-01T12:00:00Z"),
    fin: new Date("2027-03-01T14:00:00Z"),
  };
  const base = {
    franjasDeTrabajo: [franja],
    ocupadosEnGoogle: [],
    reservasConfirmadas: [],
    duracionMin: 60,
    capacidad: 1,
  };
  assert.deepEqual(calcularTurnos({ ...base, bloqueos: [] }), calcularTurnos(base));
  assert.equal(calcularTurnos(base).length, 2);

  const recurso = { id: "r", name: "Vendedor", allowsOverbooking: false, maxOverbookingsPerDay: 1 };
  assert.deepEqual(sinCamposDeClinica(recurso, "AUTOMOTORA", CAMPOS_DE_CLINICA.resource), {
    id: "r",
    name: "Vendedor",
  });
  assert.deepEqual(sinCamposDeClinica(recurso, "CLINICA", CAMPOS_DE_CLINICA.resource), recurso);
  assert.deepEqual(
    sinCamposDeClinica({ id: "b", isOverbooking: false }, "AUTOMOTORA", CAMPOS_DE_CLINICA.booking),
    { id: "b" },
  );
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

// ---------------------------------------------------------------------------
// R8 (un calendario de Google por profesional): una automotora sigue pidiendo
// exactamente los mismos dos scopes, con los mismos parámetros, aunque el
// pedido ahora lleve el rubro. Las sucursales ya conectadas no reconectan nada.
// ---------------------------------------------------------------------------

test("R8: la URL de autorización de una automotora con el rubro explícito es la de antes, byte a byte", () => {
  const cliente = crearClienteGoogleCalendar({
    clientId: "client-id-de-prueba.apps.googleusercontent.com",
    clientSecret: "secreto-de-prueba",
    redirectUri: "https://api.example.com/api/integrations/google-calendar/callback",
  });
  assert.equal(
    cliente.construirUrlDeAutorizacion("state-firmado-de-prueba", "AUTOMOTORA"),
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

// ---------------------------------------------------------------------------
// R15 (docs/rubros.md §9.1): el seguimiento de consultas de una automotora es
// el de siempre: su texto por defecto, sus variables, su schema, y la acción no
// lee turnos. El barrido con un test drive agendado está en
// seguimientoConTurnos.integration-test.ts.
// ---------------------------------------------------------------------------

test("R15: el seguimiento de consultas de una automotora no cambia", async () => {
  assert.equal(
    TEXTO_POR_DEFECTO_DE_CONSULTA,
    "¡{saludo}! Te escribimos por tu consulta sobre {vehiculo}. ¿Seguís interesado? Si querés, te ayudamos a coordinar una visita o un test drive.",
  );
  assert.deepEqual(
    variablesDeLaAccion(ACTION_INQUIRY_FOLLOW_UP, "LINK").map((v) => v.token),
    ["{saludo}", "{vehiculo}"],
  );
  assert.equal(
    configDeSeguimientoDeConsultaSchema.safeParse({
      messageText: "¡{saludo}! Tu consulta sobre {prestacion}. Escribinos.",
    }).success,
    false,
  );

  let turnosLeidos = 0;
  const agendados: unknown[] = [];
  const accion = crearAccionSeguimientoDeConsulta({
    leerContacto: async () => ({
      id: "c1",
      firstName: "Martín",
      lastName: "Pérez",
      ownerId: "vendedor",
      deletedAt: null,
      noInterestAt: null,
      leadServiceOfInterest: null,
      vehicleOfInterest: null,
    }),
    leerConversacion: async () => ({ status: "ACTIVE", assignedUserId: null }),
    humanoHabloUltimo: async () => false,
    hayOportunidadAbierta: async () => false,
    respondioDespues: async () => false,
    mensajesDelCliente: async () => [],
    resolverAsignado: async () => "vendedor",
    agendar: async (data) => {
      agendados.push(data);
      return true;
    },
    agendarYCrearTarea: async () => true,
    esClinica: async () => false,
    turnoFrena: async () => {
      turnosLeidos++;
      return true;
    },
    ahora: () => new Date("2026-10-09T15:00:00.000Z"),
  });
  await accion.handler({
    organizationId: "org",
    automationId: "regla",
    config: { messageText: TEXTO_POR_DEFECTO_DE_CONSULTA },
    payload: {
      contactId: "11111111-1111-4111-8111-111111111111",
      conversationId: "22222222-2222-4222-8222-222222222222",
      channel: "WHATSAPP",
      branchId: "33333333-3333-4333-8333-333333333333",
      ownerId: null,
      lastInboundAt: "2026-10-05T15:00:00.000Z",
    },
    outboxEventId: "44444444-4444-4444-8444-444444444444",
  });
  assert.equal(turnosLeidos, 0, "una automotora no lee turnos");
  assert.equal(agendados.length, 1, "agenda como siempre");
});

// ---------------------------------------------------------------------------
// R13 (docs/rubros.md §6): el recordatorio de turno es solo de clínica. Una
// automotora no tiene el módulo, sus plantillas siguen sin botones y con su
// categoría, sus textos se validan con los mensajes de siempre, y sus
// reservas no muestran patientConfirmedAt.
// ---------------------------------------------------------------------------

test("R13: una automotora no tiene recordatorios y sus plantillas no cambian", () => {
  for (const edition of EDICIONES) {
    assert.equal(modulosDe(edition, "AUTOMOTORA").has("recordatorios_de_turno"), false);
  }
  for (const accion of [
    "opportunity.send_qr_followup",
    "opportunity.send_discount_voucher",
    ACTION_INQUIRY_FOLLOW_UP,
  ]) {
    assert.equal(categoriaDeLaAccion(accion), "MARKETING", accion);
    assert.equal(botonesDeLaAccion(accion), undefined, accion);
  }
  assert.equal(
    validarTextoDePlantilla("Hola {nombre}, mirá {link}.", { conLink: false }),
    'Con "solo imagen" el link no va en el texto: sacá {link}',
  );
  assert.equal(
    validarTextoDePlantilla("Hola {nombre}, tu turno es el {dia}.", { conLink: true }),
    '"{dia}" no es una variable válida: solo se pueden usar {nombre} y {link}',
  );
  const reserva = { id: "b1", patientConfirmedAt: new Date(), completedAt: null };
  assert.deepEqual(
    Object.keys(sinCamposDeClinica(reserva, "AUTOMOTORA", CAMPOS_DE_CLINICA.booking)),
    ["id"],
  );
});

test("R18: una entrada de la base de conocimiento de una automotora sale sin kind, y su prompt no tiene el bloque de indicaciones", () => {
  const entrada = { id: "e1", title: "Horarios", kind: "GENERAL" };
  assert.deepEqual(
    Object.keys(sinCamposDeClinica(entrada, "AUTOMOTORA", CAMPOS_DE_CLINICA.knowledgeBaseEntry)),
    ["id", "title"],
  );
  const prompt = armarSystemPrompt(
    { instructions: "Sos el asistente.", tone: null, guardrails: {} },
    [{ title: "Horarios", content: "9 a 18.", kind: "GENERAL" }],
  );
  assert.ok(!prompt.includes(ENCABEZADO_INDICACIONES));
});
