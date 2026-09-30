import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { CATALOGO_DE_TOOLS, SUFIJO_ERROR_DE_ARGUMENTOS } from "./agentTools.service";
import { MAX_DIAS_DE_RANGO } from "./availability.service";
import {
  CATALOGO_DE_TOOLS_INTERNAS,
  MENSAJE_TAREA_SIN_VINCULO,
  SUFIJO_ERROR_DE_ARGUMENTOS_INTERNO,
  toolsHabilitadasInternas,
  type ToolInterna,
} from "./internalAgentTools.service";

// ---------------------------------------------------------------------------
// Ítem 179: el catálogo del agente interno, sin base. Todo lo de acá corta
// ANTES de tocar Postgres (validación de argumentos, falta de vínculo); la
// resolución por texto, la creación real de la tarea y la agenda están en
// internalAgent.integration-test.ts.
// ---------------------------------------------------------------------------

const CONTEXTO = { organizationId: randomUUID(), userId: randomUUID(), role: "USER" as const };

function tool(nombre: string): ToolInterna {
  const t = CATALOGO_DE_TOOLS_INTERNAS.get(nombre);
  assert.ok(t, `${nombre} no está en el catálogo interno`);
  return t;
}

async function error(nombre: string, args: Record<string, unknown>): Promise<string> {
  const resultado = await tool(nombre).ejecutar(args, CONTEXTO);
  assert.equal(resultado.ok, false, `se esperaba un fallo con ${JSON.stringify(args)}`);
  return resultado.ok ? "" : resultado.error;
}

test("el catálogo interno tiene exactamente las dos tools de la primera versión", () => {
  assert.deepEqual([...CATALOGO_DE_TOOLS_INTERNAS.keys()].sort(), [
    "create_internal_task",
    "get_agenda",
  ]);
});

test("es un catálogo separado: ninguna tool interna está en el de los agentes de cliente, ni al revés", () => {
  for (const nombre of CATALOGO_DE_TOOLS_INTERNAS.keys()) {
    assert.equal(CATALOGO_DE_TOOLS.has(nombre), false, `${nombre} está en los dos catálogos`);
  }
  assert.deepEqual(toolsHabilitadasInternas([...CATALOGO_DE_TOOLS.keys()]), []);
});

test("toolsHabilitadasInternas: la intersección con el catálogo, en el orden de enabledTools", () => {
  const nombres = toolsHabilitadasInternas([
    "get_agenda",
    "no_existe",
    "create_opportunity",
    "create_internal_task",
  ]).map((t) => t.definition.name);
  assert.deepEqual(nombres, ["get_agenda", "create_internal_task"]);
  assert.deepEqual(toolsHabilitadasInternas([]), []);
});

test("las definiciones: JSON Schema cerrado y los requeridos correctos", () => {
  const esperados: Record<string, string[]> = {
    create_internal_task: ["asunto"],
    get_agenda: ["desde"],
  };
  for (const [nombre, requeridos] of Object.entries(esperados)) {
    const { definition } = tool(nombre);
    assert.equal(definition.name, nombre);
    assert.equal(definition.parameters.type, "object");
    assert.equal(definition.parameters.additionalProperties, false);
    assert.deepEqual(definition.parameters.required, requeridos);
    assert.ok(definition.description.length > 0);
  }
});

// ---------------------------------------------------------------------------
// create_internal_task
// ---------------------------------------------------------------------------

test("create_internal_task sin asunto: error de argumentos con el sufijo INTERNO, no el de cliente", async () => {
  const mensaje = await error("create_internal_task", { contacto: "Ana López" });
  assert.match(mensaje, /^Argumentos inválidos — asunto:/);
  assert.ok(mensaje.endsWith(SUFIJO_ERROR_DE_ARGUMENTOS_INTERNO));
  assert.ok(!mensaje.includes(SUFIJO_ERROR_DE_ARGUMENTOS));
  assert.doesNotMatch(mensaje, /cliente/);
});

test("create_internal_task con asunto vacío (solo espacios) es un error de argumentos", async () => {
  const mensaje = await error("create_internal_task", { asunto: "   ", contacto: "Ana" });
  assert.match(mensaje, /asunto/);
});

test("create_internal_task sin contacto ni oportunidad: el fallo legible que pide precisión, antes de la base", async () => {
  assert.equal(
    await error("create_internal_task", { asunto: "Llamar" }),
    MENSAJE_TAREA_SIN_VINCULO,
  );
});

test("create_internal_task: contacto/oportunidad vacíos cuentan como ausentes (ítem 86)", async () => {
  assert.equal(
    await error("create_internal_task", { asunto: "Llamar", contacto: "", oportunidad: null }),
    MENSAJE_TAREA_SIN_VINCULO,
  );
});

test("create_internal_task: una fechaLimite sin offset es un error de argumentos", async () => {
  const mensaje = await error("create_internal_task", {
    asunto: "Llamar",
    contacto: "Ana",
    fechaLimite: "2026-10-02 09:00",
  });
  assert.match(mensaje, /fechaLimite: debe ser una fecha-hora ISO 8601 con zona/);
});

// ---------------------------------------------------------------------------
// get_agenda
// ---------------------------------------------------------------------------

test("get_agenda sin desde es un error de argumentos", async () => {
  const mensaje = await error("get_agenda", {});
  assert.match(mensaje, /^Argumentos inválidos — desde:/);
  assert.ok(mensaje.endsWith(SUFIJO_ERROR_DE_ARGUMENTOS_INTERNO));
});

test("get_agenda: hasta anterior a desde es un error de argumentos", async () => {
  const mensaje = await error("get_agenda", {
    desde: "2026-10-02T00:00:00-03:00",
    hasta: "2026-10-01T00:00:00-03:00",
  });
  assert.match(mensaje, /hasta debe ser posterior a desde/);
});

test("get_agenda: un rango de más del máximo es un error de argumentos", async () => {
  const desde = new Date("2026-10-01T00:00:00-03:00");
  const hasta = new Date(desde.getTime() + (MAX_DIAS_DE_RANGO + 1) * 24 * 60 * 60 * 1000);
  const mensaje = await error("get_agenda", {
    desde: "2026-10-01T00:00:00-03:00",
    hasta: hasta.toISOString(),
  });
  assert.match(mensaje, new RegExp(`no puede superar los ${MAX_DIAS_DE_RANGO} días`));
});
