import assert from "node:assert/strict";
import { test } from "node:test";
import type { OrganizationEdition, OrganizationIndustry } from "@prisma/client";
import type { Request } from "express";
import {
  MODULOS,
  MODULOS_POR_EDICION,
  MODULOS_POR_RUBRO,
  MODULO_DE_LA_TOOL,
  RUTAS_POR_MODULO,
  modulosDe,
  motivoDeExclusion,
  toolDelRubro,
} from "./ediciones";
import {
  CAMPO_NO_INCLUIDO,
  MODULO_NO_INCLUIDO,
  exigirModuloDeLaEdicion,
} from "../middlewares/moduloDeLaEdicion";
import { puedeEjecutarTool } from "../services/agentPermissions.service";
import { CATALOGO_DE_TOOLS, toolsHabilitadas } from "../services/agentTools.service";
import type { AuthContext } from "../types/auth";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// El rubro en el catálogo, en el gate y en las tools (docs/rubros.md §1.2 y
// §5.1, PR R2). Sin base de datos. Los casos del gate y de las tools salen de
// modulosDe y del catálogo, no de una lista a mano; las listas a mano que hay
// son la tabla de §2 y §5.1, para que un cambio del catálogo que la
// contradiga se note.
//
// Lo que una automotora tiene que seguir haciendo igual que antes está en
// src/clinicas/automotoraSinCambios.test.ts.
// ---------------------------------------------------------------------------

const EDICIONES: OrganizationEdition[] = ["COMPLETA", "ESENCIAL"];
const RUBROS: OrganizationIndustry[] = ["AUTOMOTORA", "CLINICA"];
const COMBINACIONES = EDICIONES.flatMap((edition) =>
  RUBROS.map((industry) => ({ edition, industry })),
);

test("CLINICA no tiene stock, oportunidades ni lo que cuelga de ellas (§2)", () => {
  assert.deepEqual(MODULOS.filter((m) => !MODULOS_POR_RUBRO.CLINICA.has(m)).sort(), [
    "cotizaciones",
    "dashboard_comercial",
    "empresas",
    "entregas",
    "financiacion",
    "oportunidades",
    "pagos",
    "permutas",
    "procesos_de_venta",
    "stock",
  ]);
});

test("modulosDe es la intersección de la edición y el rubro, en las cuatro combinaciones", () => {
  for (const { edition, industry } of COMBINACIONES) {
    const esperado = MODULOS.filter(
      (m) => MODULOS_POR_EDICION[edition].has(m) && MODULOS_POR_RUBRO[industry].has(m),
    );
    assert.deepEqual(
      MODULOS.filter((m) => modulosDe(edition, industry).has(m)),
      esperado,
      `${edition}/${industry}`,
    );
    // Lo que no puede depender del rubro ni de la edición.
    for (const modulo of ["comun", "plataforma"] as const) {
      assert.ok(modulosDe(edition, industry).has(modulo), `${edition}/${industry}: ${modulo}`);
    }
  }
});

test("motivoDeExclusion: RUBRO si el rubro no lo tiene (aunque la edición tampoco), si no EDICION", () => {
  for (const { edition, industry } of COMBINACIONES) {
    for (const modulo of MODULOS.filter((m) => !modulosDe(edition, industry).has(m))) {
      assert.equal(
        motivoDeExclusion(modulo, industry),
        MODULOS_POR_RUBRO[industry].has(modulo) ? "EDICION" : "RUBRO",
        `${edition}/${industry}: ${modulo}`,
      );
    }
  }
  // Una clínica ESENCIAL sin cotizaciones: subir de edición no se las daría.
  assert.equal(motivoDeExclusion("cotizaciones", "CLINICA"), "RUBRO");
  assert.equal(motivoDeExclusion("cotizaciones", "AUTOMOTORA"), "EDICION");
});

// ---------------------------------------------------------------------------
// El gate, sin HTTP (mismo request falso que src/config/ediciones.test.ts).
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

function auth(edition: OrganizationEdition, industry: OrganizationIndustry): AuthContext {
  return {
    userId: "11111111-1111-1111-1111-111111111111",
    organizationId: "22222222-2222-2222-2222-222222222222",
    role: "ADMIN",
    email: "persona@example.com",
    fullName: "Persona de Prueba",
    edition,
    industry,
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

test("gate en CLINICA: cada ruta del catálogo da 403 exactamente si su módulo no está, con su motivo", () => {
  for (const edition of EDICIONES) {
    const permitidos = modulosDe(edition, "CLINICA");
    for (const modulo of MODULOS) {
      for (const ruta of RUTAS_POR_MODULO[modulo]) {
        const [metodo, patron] = ruta.split(" ");
        const err = errorDe(() =>
          exigirModuloDeLaEdicion(pedido(metodo, patron), auth(edition, "CLINICA")),
        );
        if (permitidos.has(modulo)) {
          assert.equal(err, undefined, `${edition}: ${ruta}`);
        } else {
          assert.equal(err?.statusCode, 403, `${edition}: ${ruta}`);
          assert.deepEqual(err?.details, {
            code: MODULO_NO_INCLUIDO,
            modulo,
            motivo: motivoDeExclusion(modulo, "CLINICA"),
          });
        }
      }
    }
  }
});

test("gate en CLINICA: el texto dice rubro, no edición; sync-vehicles es del stock", () => {
  const stock = errorDe(() =>
    exigirModuloDeLaEdicion(pedido("GET", "/api/vehicles"), auth("COMPLETA", "CLINICA")),
  );
  assert.equal(stock?.message, "Esta función no está disponible para tu rubro.");
  assert.equal((stock?.details as { motivo?: string }).motivo, "RUBRO");

  const sync = errorDe(() =>
    exigirModuloDeLaEdicion(
      pedido("POST", "/api/knowledge-base/sync-vehicles"),
      auth("ESENCIAL", "CLINICA"),
    ),
  );
  assert.equal((sync?.details as { modulo?: string }).modulo, "stock");
  // El resto de la base de conocimiento sí está.
  assert.equal(
    errorDe(() =>
      exigirModuloDeLaEdicion(pedido("GET", "/api/knowledge-base"), auth("ESENCIAL", "CLINICA")),
    ),
    undefined,
  );
});

test("gate en CLINICA COMPLETA: ya no es un no-op, y una ruta sin clasificar falla cerrado con motivo RUBRO", () => {
  const err = errorDe(() =>
    exigirModuloDeLaEdicion(pedido("GET", "/api/no-existe"), auth("COMPLETA", "CLINICA")),
  );
  assert.equal(err?.statusCode, 403);
  assert.deepEqual(err?.details, {
    code: MODULO_NO_INCLUIDO,
    modulo: "sin_clasificar",
    motivo: "RUBRO",
  });
});

test("bloqueos por campo del rubro: 400 con motivo RUBRO en CLINICA; null o ausente pasa", () => {
  const id = "33333333-3333-3333-3333-333333333333";
  const casos: [string, string, Record<string, unknown>, string, string][] = [
    ["PATCH", "/api/contacts/:id", { vehicleOfInterestId: id }, "vehicleOfInterestId", "stock"],
    ["POST", "/api/activities", { opportunityId: id }, "opportunityId", "oportunidades"],
    ["PATCH", "/api/activities/:id", { opportunityId: id }, "opportunityId", "oportunidades"],
    ["POST", "/api/bookings", { opportunityId: id }, "opportunityId", "oportunidades"],
    // De la edición, pero en CLINICA lo excluye también el rubro.
    ["POST", "/api/contacts", { companyId: id }, "companyId", "empresas"],
  ];
  for (const edition of EDICIONES) {
    for (const [metodo, patron, body, campo, modulo] of casos) {
      const err = errorDe(() =>
        exigirModuloDeLaEdicion(pedido(metodo, patron, body), auth(edition, "CLINICA")),
      );
      assert.equal(err?.statusCode, 400, `${edition}: ${metodo} ${patron}`);
      assert.equal(err?.message, `El campo ${campo} no está disponible para tu rubro.`);
      assert.deepEqual(err?.details, { code: CAMPO_NO_INCLUIDO, campo, modulo, motivo: "RUBRO" });
    }
    assert.equal(
      errorDe(() =>
        exigirModuloDeLaEdicion(
          pedido("PATCH", "/api/contacts/:id", { vehicleOfInterestId: null }),
          auth(edition, "CLINICA"),
        ),
      ),
      undefined,
    );
    assert.equal(
      errorDe(() =>
        exigirModuloDeLaEdicion(
          pedido("PATCH", "/api/contacts/:id", { firstName: "Ana" }),
          auth(edition, "CLINICA"),
        ),
      ),
      undefined,
    );
  }
});

// ---------------------------------------------------------------------------
// Tools (§5.1)
// ---------------------------------------------------------------------------

test("toolDelRubro en CLINICA: generado desde el módulo de cada tool, menos get_payment_info", () => {
  for (const edition of EDICIONES) {
    for (const [nombre, modulo] of Object.entries(MODULO_DE_LA_TOOL)) {
      assert.equal(
        toolDelRubro(nombre, edition, "CLINICA"),
        nombre !== "get_payment_info" && modulosDe(edition, "CLINICA").has(modulo),
        `${edition}: ${nombre}`,
      );
    }
    // Falla cerrado: una tool sin módulo no está en una clínica.
    assert.equal(toolDelRubro("tool_inventada", edition, "CLINICA"), false);
  }
});

test("toolDelRubro en CLINICA coincide con la tabla de §5.1", () => {
  const enClinica = [...CATALOGO_DE_TOOLS.keys()]
    .filter((nombre) => toolDelRubro(nombre, "ESENCIAL", "CLINICA"))
    .sort();
  assert.deepEqual(enClinica, [
    "create_booking",
    "create_lead",
    "get_availability",
    "get_contact_activities",
    "get_contact_info",
    "get_service_types",
    "mark_no_interest",
    "update_contact_custom_fields",
    "update_lead",
  ]);
});

test("un agente de clínica no ve ni ejecuta una tool fuera del rubro aunque esté en enabledTools", () => {
  const todas = [...CATALOGO_DE_TOOLS.keys()];
  for (const edition of EDICIONES) {
    const organizacion = { edition, industry: "CLINICA" as const };
    const ofrecidas = toolsHabilitadas(todas, organizacion).map((t) => t.definition.name);
    assert.deepEqual(
      ofrecidas,
      todas.filter((nombre) => toolDelRubro(nombre, edition, "CLINICA")),
    );
    for (const nombre of [
      "search_vehicles",
      "reserve_vehicle",
      "create_opportunity",
      "get_payment_info",
    ]) {
      assert.ok(!ofrecidas.includes(nombre), nombre);
      const decision = puedeEjecutarTool(
        { enabledTools: todas, guardrails: {}, organizacion },
        nombre,
        {},
        {},
      );
      assert.equal(decision.allowed, false, nombre);
      assert.equal(decision.reason, `La acción "${nombre}" no está disponible para este rubro`);
    }
    assert.deepEqual(
      puedeEjecutarTool(
        { enabledTools: todas, guardrails: {}, organizacion },
        "create_booking",
        {},
        {},
      ),
      { allowed: true },
    );
  }
});

test("una tool que no está en enabledTools sigue respondiendo 'no habilitada', también en CLINICA", () => {
  const decision = puedeEjecutarTool(
    {
      enabledTools: [],
      guardrails: {},
      organizacion: { edition: "COMPLETA", industry: "CLINICA" },
    },
    "search_vehicles",
    {},
    {},
  );
  assert.match(decision.reason ?? "", /no está habilitada/);
});
