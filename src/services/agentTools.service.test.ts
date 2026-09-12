import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CATALOGO_DE_TOOLS,
  toolsHabilitadas,
  type ContextoDeEjecucionDeTool,
} from "./agentTools.service";

// Unitarios, SIN BASE: lo que se prueba acá es la forma del catálogo y la
// validación de argumentos de cada wrapper, que ocurre ANTES de tocar Postgres.
// Un wrapper que rechaza los args nunca llega a un repositorio, así que estos
// tests no necesitan conexión — si alguno la necesitara, fallaría con un error
// de Prisma y sería el aviso de que la validación dejó pasar algo.
//
// La resolución de owner/pipeline/stage y el scoping por sucursal —lo que sí
// necesita base— vive en agentOrchestration.integration-test.ts.

const CONTEXTO: ContextoDeEjecucionDeTool = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  conversation: {
    id: "00000000-0000-4000-8000-000000000002",
    contactId: "00000000-0000-4000-8000-000000000003",
    branchId: "00000000-0000-4000-8000-000000000004",
    agentId: "00000000-0000-4000-8000-000000000005",
  },
};

const UUID = "11111111-1111-4111-8111-111111111111";

async function rechazoDe(nombre: string, args: Record<string, unknown>): Promise<string> {
  const tool = CATALOGO_DE_TOOLS.get(nombre);
  assert.ok(tool, `la tool ${nombre} tiene que estar en el catálogo`);
  const resultado = await tool.ejecutar(args, CONTEXTO);
  assert.equal(resultado.ok, false, `debía rechazar los args ${JSON.stringify(args)}`);
  return resultado.ok ? "" : resultado.error;
}

// ---------------------------------------------------------------------------
// Forma del catálogo
// ---------------------------------------------------------------------------

test("el catálogo tiene exactamente las cuatro tools del paso 2b, con su nombre como clave", () => {
  assert.deepEqual([...CATALOGO_DE_TOOLS.keys()].sort(), [
    "create_booking",
    "create_opportunity",
    "get_availability",
    "update_opportunity",
  ]);
  for (const [nombre, tool] of CATALOGO_DE_TOOLS) {
    assert.equal(tool.definition.name, nombre);
    assert.ok(tool.definition.description.length > 20, `${nombre} necesita descripción`);
    assert.equal(tool.definition.parameters.type, "object");
  }
});

test("ninguna tool expone contactId, ownerId ni pipelineId al modelo", () => {
  // La nota del 12/09/2026 bajo §6: los resuelve el wrapper, siempre.
  for (const [nombre, tool] of CATALOGO_DE_TOOLS) {
    const propiedades = Object.keys(
      (tool.definition.parameters as { properties: Record<string, unknown> }).properties,
    );
    for (const prohibida of ["contactId", "ownerId", "pipelineId"]) {
      assert.ok(!propiedades.includes(prohibida), `${nombre} no debe exponer ${prohibida}`);
    }
  }
});

test("toolsHabilitadas es la intersección con el catálogo, en el orden del agente", () => {
  const tools = toolsHabilitadas(["create_booking", "tool_inventada", "create_opportunity"]);
  assert.deepEqual(
    tools.map((t) => t.definition.name),
    ["create_booking", "create_opportunity"],
  );
  assert.deepEqual(toolsHabilitadas([]), []);
});

// ---------------------------------------------------------------------------
// Validación de argumentos — antes de tocar la base
// ---------------------------------------------------------------------------

test("create_opportunity: title es requerido; amount negativo y currency inválida se rechazan", async () => {
  assert.match(await rechazoDe("create_opportunity", {}), /title/);
  assert.match(await rechazoDe("create_opportunity", { title: "x", amount: -1 }), /amount/);
  assert.match(
    await rechazoDe("create_opportunity", { title: "x", currency: "pesos" }),
    /currency/,
  );
});

test("update_opportunity: exige opportunityId UUID y al menos un campo más", async () => {
  assert.match(await rechazoDe("update_opportunity", { title: "x" }), /opportunityId/);
  assert.match(await rechazoDe("update_opportunity", { opportunityId: UUID }), /al menos un campo/);
  assert.match(
    await rechazoDe("update_opportunity", { opportunityId: UUID, status: "CANCELLED" }),
    /status/,
  );
  // Y no acepta lo que el modelo no debe controlar aunque lo mande: Zod
  // descarta las claves desconocidas, así que solo con ownerId queda "sin
  // campos" y se rechaza por eso.
  assert.match(
    await rechazoDe("update_opportunity", { opportunityId: UUID, ownerId: UUID }),
    /al menos un campo/,
  );
});

test("get_availability: fechas ISO con zona, hasta > desde, y tope de rango", async () => {
  const base = { resourceId: UUID, serviceTypeId: UUID };

  assert.match(
    await rechazoDe("get_availability", { ...base, desde: "2026-09-14", hasta: "2026-09-15" }),
    /ISO 8601/,
  );
  assert.match(
    await rechazoDe("get_availability", {
      ...base,
      desde: "2026-09-15T00:00:00Z",
      hasta: "2026-09-14T00:00:00Z",
    }),
    /posterior a desde/,
  );
  assert.match(
    await rechazoDe("get_availability", {
      ...base,
      desde: "2026-01-01T00:00:00Z",
      hasta: "2026-12-31T00:00:00Z",
    }),
    /62 días/,
  );
});

test("create_booking: exige resourceId, serviceTypeId y startsAt ISO con zona", async () => {
  assert.match(await rechazoDe("create_booking", { resourceId: UUID }), /serviceTypeId/);
  assert.match(
    await rechazoDe("create_booking", {
      resourceId: UUID,
      serviceTypeId: UUID,
      startsAt: "mañana a las 3",
    }),
    /ISO 8601/,
  );
});
