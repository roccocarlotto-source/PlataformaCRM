import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CATALOGO_DE_TOOLS,
  NOMBRE_TOOL_PAGO,
  SUFIJO_ERROR_DE_ARGUMENTOS,
  canonizarNombreDeTool,
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

test("el catálogo tiene exactamente las once tools (pasos 2b y 3, ítems 74 y 85), con su nombre como clave", () => {
  assert.deepEqual([...CATALOGO_DE_TOOLS.keys()].sort(), [
    "create_booking",
    "create_lead",
    "create_opportunity",
    "get_availability",
    "get_contact_activities",
    "get_contact_info",
    "get_payment_info",
    "get_service_types",
    "search_vehicles",
    "update_lead",
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

// ---------------------------------------------------------------------------
// create_lead / update_lead (paso 3) — mismo schema, misma validación
// ---------------------------------------------------------------------------

test("create_lead y update_lead exponen el mismo schema y ninguno pide contactId", () => {
  const crear = CATALOGO_DE_TOOLS.get("create_lead")!;
  const actualizar = CATALOGO_DE_TOOLS.get("update_lead")!;
  assert.deepEqual(crear.definition.parameters, actualizar.definition.parameters);
  assert.notEqual(crear.definition.description, actualizar.definition.description);

  const parametros = crear.definition.parameters as {
    required: string[];
    properties: Record<string, unknown>;
  };
  assert.deepEqual(parametros.required, []);
  assert.deepEqual(Object.keys(parametros.properties).sort(), [
    "aiData",
    "budgetAmount",
    "budgetCurrency",
    "intent",
    "location",
    "notes",
    "score",
    "serviceOfInterest",
    "urgency",
  ]);
});

for (const nombre of ["create_lead", "update_lead"]) {
  test(`${nombre}: exige al menos un dato de calificación`, async () => {
    assert.match(await rechazoDe(nombre, {}), /al menos un dato/);
    // Y lo que el modelo no debe controlar no cuenta como dato: Zod descarta
    // las claves desconocidas (contactId, lifecycleStage) y queda vacío.
    assert.match(
      await rechazoDe(nombre, { contactId: UUID, lifecycleStage: "CUSTOMER" }),
      /al menos un dato/,
    );
  });

  test(`${nombre}: score entre 0 y 100, entero — mismo rango que el CHECK de la base`, async () => {
    assert.match(await rechazoDe(nombre, { score: 101 }), /entre 0 y 100/);
    assert.match(await rechazoDe(nombre, { score: -1 }), /entre 0 y 100/);
    assert.match(await rechazoDe(nombre, { score: 50.5 }), /entero/);
  });

  test(`${nombre}: budgetAmount y budgetCurrency van en par`, async () => {
    assert.match(await rechazoDe(nombre, { budgetAmount: 1000 }), /van juntos/);
    assert.match(await rechazoDe(nombre, { budgetCurrency: "UYU" }), /van juntos/);
    assert.match(
      await rechazoDe(nombre, { budgetAmount: -5, budgetCurrency: "UYU" }),
      /budgetAmount/,
    );
    assert.match(await rechazoDe(nombre, { budgetAmount: 5, budgetCurrency: "pesos" }), /currency/);
  });

  test(`${nombre}: urgency solo LOW/MEDIUM/HIGH y aiData tiene que ser un objeto`, async () => {
    assert.match(await rechazoDe(nombre, { urgency: "URGENTE" }), /urgency/);
    assert.match(await rechazoDe(nombre, { aiData: ["x"] }), /aiData/);
  });
}

// ---------------------------------------------------------------------------
// get_payment_info (ítem 74) — la forma. Que devuelva lo configurado en la
// sucursal necesita base: branchPaymentInfo.integration-test.ts.
// ---------------------------------------------------------------------------

test("get_payment_info: sin parámetros, y el nombre exportado es el del catálogo", () => {
  assert.equal(NOMBRE_TOOL_PAGO, "get_payment_info");
  const tool = CATALOGO_DE_TOOLS.get(NOMBRE_TOOL_PAGO)!;
  const parametros = tool.definition.parameters as { properties: Record<string, unknown> };
  // Ni siquiera branchId: la sucursal sale del contexto, el modelo no elige.
  assert.deepEqual(parametros.properties, {});
});

test("get_payment_info: la descripción conserva el criterio de cuándo compartir el detalle", () => {
  // El matiz del ítem 74 vive SOLO en esta descripción (no hay gate de
  // código). Si alguien la reescribe y se pierde, este test lo avisa.
  const descripcion = CATALOGO_DE_TOOLS.get(NOMBRE_TOOL_PAGO)!.definition.description;
  assert.match(descripcion, /concretamente quiere pagar/);
  assert.match(descripcion, /qué métodos de pago aceptan/);
  assert.match(descripcion, /sin compartir todavía el link/);
  assert.match(descripcion, /no inventes/);
});

// ---------------------------------------------------------------------------
// create_opportunity no duplica (ítem 84) — el comportamiento necesita base
// (agentReadTools.integration-test.ts); acá, que la descripción lo diga.
// ---------------------------------------------------------------------------

test("create_opportunity: la descripción avisa que reutiliza la abierta y que para cambiarla va update_opportunity", () => {
  const descripcion = CATALOGO_DE_TOOLS.get("create_opportunity")!.definition.description;
  assert.match(descripcion, /ya tiene una oportunidad abierta/);
  assert.match(descripcion, /reused/);
  assert.match(descripcion, /update_opportunity/);
});

// ---------------------------------------------------------------------------
// Tools de lectura (ítem 85) — la forma y la validación. Lo que devuelven
// necesita base: agentReadTools.integration-test.ts.
// ---------------------------------------------------------------------------

for (const nombre of ["get_contact_info", "get_service_types", "get_contact_activities"]) {
  test(`${nombre}: sin parámetros — contacto y sucursal salen del contexto`, () => {
    const parametros = CATALOGO_DE_TOOLS.get(nombre)!.definition.parameters as {
      properties: Record<string, unknown>;
    };
    assert.deepEqual(parametros.properties, {});
  });
}

test("search_vehicles: expone solo los filtros de búsqueda, nunca status, publicación ni sucursal", () => {
  const parametros = CATALOGO_DE_TOOLS.get("search_vehicles")!.definition.parameters as {
    required: string[];
    properties: Record<string, unknown>;
  };
  assert.deepEqual(parametros.required, []);
  assert.deepEqual(Object.keys(parametros.properties).sort(), [
    "acceptsTradeIn",
    "bodyType",
    "condition",
    "exteriorColor",
    "financingAvailable",
    "fuelType",
    "make",
    "mileageMax",
    "model",
    "priceMaxUsd",
    "priceMinUsd",
    "texto",
    "transmission",
    "year",
  ]);
  // Ni q, que es la búsqueda del panel y mira patente y VIN.
  assert.ok(!("q" in parametros.properties));
});

test("search_vehicles: precios no negativos y ordenados, año entero, carrocería del enum", async () => {
  assert.match(await rechazoDe("search_vehicles", { priceMinUsd: -1 }), /priceMinUsd/);
  assert.match(await rechazoDe("search_vehicles", { priceMaxUsd: -1 }), /priceMaxUsd/);
  assert.match(
    await rechazoDe("search_vehicles", { priceMinUsd: 30_000, priceMaxUsd: 10_000 }),
    /no puede ser mayor/,
  );
  assert.match(await rechazoDe("search_vehicles", { year: 2020.5 }), /entero/);
  assert.match(await rechazoDe("search_vehicles", { bodyType: "SPACESHIP" }), /bodyType/);
  assert.match(await rechazoDe("search_vehicles", { transmission: "A PEDAL" }), /transmission/);
  assert.match(await rechazoDe("search_vehicles", { fuelType: "LEÑA" }), /fuelType/);
  assert.match(await rechazoDe("search_vehicles", { condition: "SEMINUEVO" }), /condition/);
  assert.match(await rechazoDe("search_vehicles", { mileageMax: -5 }), /mileageMax/);
});

test("get_service_types: la descripción manda a sacar los UUID de acá y no inventarlos", () => {
  const descripcion = CATALOGO_DE_TOOLS.get("get_service_types")!.definition.description;
  assert.match(descripcion, /get_availability/);
  assert.match(descripcion, /no inventes esos UUID/);
});

// ---------------------------------------------------------------------------
// Valores vacíos como "no vino" (ítem 86). Lo que se puede probar sin base es
// que un argumento vacío NO cuenta como dato: si todos vinieron vacíos, el
// rechazo es el de "no mandaste nada", no uno de formato. Que search_vehicles
// con el payload real devuelva resultados necesita base
// (agentReadTools.integration-test.ts).
// ---------------------------------------------------------------------------

for (const nombre of ["create_lead", "update_lead"]) {
  test(`${nombre}: "", "   " y null cuentan como no enviados, no como formato inválido`, async () => {
    const error = await rechazoDe(nombre, {
      intent: "",
      serviceOfInterest: "   ",
      urgency: "",
      budgetCurrency: "",
      budgetAmount: null,
      location: null,
      notes: "",
      score: null,
      aiData: null,
    });
    assert.match(error, /al menos un dato/);
    assert.doesNotMatch(error, /intent|urgency|currency/);
  });

  test(`${nombre}: un vacío no rompe el par de presupuesto ni tapa un error real`, async () => {
    // budgetCurrency "" es "no vino": el par queda incompleto y se avisa eso.
    assert.match(await rechazoDe(nombre, { budgetAmount: 100, budgetCurrency: "" }), /van juntos/);
    // Y un valor inválido de verdad sigue siendo un error de formato.
    assert.match(await rechazoDe(nombre, { intent: "", urgency: "URGENTE" }), /urgency/);
  });
}

test("update_opportunity: campos vacíos no cuentan como el campo a modificar", async () => {
  assert.match(
    await rechazoDe("update_opportunity", {
      opportunityId: UUID,
      title: "",
      currency: "",
      status: "",
      stageId: "",
      lostReason: null,
    }),
    /al menos un campo/,
  );
});

// ---------------------------------------------------------------------------
// Ítem 87: el modelo inventaba filtros que el cliente no dijo. La mitigación
// vive SOLO en el texto (no hay forma de verificar por código si el cliente
// "dijo" una transmisión), así que lo único que se puede fijar es que las
// advertencias sigan ahí. Si alguien las reescribe y se pierden, esto avisa.
// ---------------------------------------------------------------------------

test("search_vehicles: la regla de no inventar filtros va al principio de la descripción", () => {
  const descripcion = CATALOGO_DE_TOOLS.get("search_vehicles")!.definition.description;
  assert.ok(
    descripcion.indexOf("REGLA PRINCIPAL") < descripcion.indexOf("Filtros disponibles"),
    "la regla tiene que leerse antes que la lista de filtros",
  );
  assert.match(descripcion, /solo dice "algo de menos de 30 mil dólares"/);
  assert.match(descripcion, /únicamente priceMaxUsd/);
  // Ítem 89: el orden es lo que permite contestar "el más barato" sin pedir
  // datos. Y como la lista corta en 10, el último NO es siempre el más caro.
  assert.match(descripcion, /ordenados de más barato a más caro/);
  assert.match(descripcion, /cuál es el más barato/);
  assert.match(descripcion, /el más caro no está en ella/);
});

test("search_vehicles: cada filtro de riesgo abre su descripción con la advertencia", () => {
  const propiedades = (
    CATALOGO_DE_TOOLS.get("search_vehicles")!.definition.parameters as {
      properties: Record<string, { description: string }>;
    }
  ).properties;
  for (const campo of [
    "bodyType",
    "condition",
    "transmission",
    "fuelType",
    "mileageMax",
    "financingAvailable",
    "acceptsTradeIn",
  ]) {
    assert.match(propiedades[campo].description, /^NO l[oa] mandes salvo que el cliente/, campo);
  }
});

// ---------------------------------------------------------------------------
// Ítem 90: el modelo manda el nombre con prefijo de namespace
// ---------------------------------------------------------------------------

// El universo de nombres válidos que usan estos tests: el catálogo completo
// más la tool de sistema, que es exactamente lo que le pasa la orquestación.
const existeEnCatalogo = (nombre: string) =>
  CATALOGO_DE_TOOLS.has(nombre) || nombre === "request_human_handoff";

test("canonizar: el caso real de producción — default_api.get_contact_activities se resuelve", () => {
  assert.equal(
    canonizarNombreDeTool("default_api.get_contact_activities", existeEnCatalogo),
    "get_contact_activities",
  );
  assert.equal(
    canonizarNombreDeTool("default_api.search_vehicles", existeEnCatalogo),
    "search_vehicles",
  );
});

test("canonizar: un nombre ya válido pasa intacto — la igualdad exacta siempre gana", () => {
  for (const nombre of CATALOGO_DE_TOOLS.keys()) {
    assert.equal(canonizarNombreDeTool(nombre, existeEnCatalogo), nombre);
  }
  assert.equal(
    canonizarNombreDeTool("request_human_handoff", existeEnCatalogo),
    "request_human_handoff",
  );
});

test("canonizar: una tool que no existe sigue sin existir, con o sin prefijo", () => {
  // Lo importante acá es que canonizar NO inventa tools: si el último segmento
  // tampoco está en el universo válido, el nombre vuelve tal cual y el camino
  // de "no existe" de la orquestación queda intacto.
  assert.equal(canonizarNombreDeTool("borrar_todo", existeEnCatalogo), "borrar_todo");
  assert.equal(
    canonizarNombreDeTool("default_api.borrar_todo", existeEnCatalogo),
    "default_api.borrar_todo",
  );
  assert.equal(canonizarNombreDeTool("", existeEnCatalogo), "");
});

test("canonizar: canonizar NO puede habilitar una tool que el agente no tiene", () => {
  // El predicado que le pasa la orquestación son los nombres OFRECIDOS en el
  // turno, no el catálogo entero. Un agente que solo tiene search_vehicles no
  // gana get_payment_info por mandarlo prefijado.
  const soloBusqueda = (nombre: string) => nombre === "search_vehicles";
  assert.equal(
    canonizarNombreDeTool("default_api.get_payment_info", soloBusqueda),
    "default_api.get_payment_info",
  );
  assert.equal(
    canonizarNombreDeTool("default_api.search_vehicles", soloBusqueda),
    "search_vehicles",
  );
});

test("canonizar: con varios puntos toma el último segmento, no el primero", () => {
  assert.equal(
    canonizarNombreDeTool("tools.default_api.search_vehicles", existeEnCatalogo),
    "search_vehicles",
  );
});

test("canonizar: ningún nombre del catálogo tiene un punto (premisa de la regla)", () => {
  // Si algún día una tool se llamara "a.b", la regla del último segmento
  // dejaría de ser inequívoca. Este test es el que avisa.
  for (const nombre of CATALOGO_DE_TOOLS.keys()) {
    assert.ok(!nombre.includes("."), `${nombre} no puede tener un punto`);
  }
});

// ---------------------------------------------------------------------------
// Ítem 101: un error de validación es del modelo, no del negocio
// ---------------------------------------------------------------------------

test("un error de argumentos le dice al modelo que es suyo y le prohíbe la conclusión", async () => {
  // El caso real: get_availability con desde == hasta se rechazó bien, y el
  // modelo le contestó al cliente "el miércoles a las 11 ya no está
  // disponible" — un horario que estaba libre.
  // (El caso original era desde == hasta; desde el ítem 103 eso ya no es un
  // error sino "las 24 horas siguientes", así que acá se usa el orden
  // invertido, que sí sigue siendo un error del modelo.)
  const mensaje = await rechazoDe("get_availability", {
    resourceId: UUID,
    serviceTypeId: UUID,
    desde: "2026-09-29T15:00:00-03:00",
    hasta: "2026-09-29T09:00:00-03:00",
  });
  assert.match(mensaje, /posterior a desde/, "el detalle técnico sigue estando");
  assert.match(mensaje, /error TUYO/, "y ahora dice de quién es el error");
  assert.match(mensaje, /no le digas que no hay disponibilidad/);
});

test("el sufijo va en TODAS las tools, no solo en la que falló en producción", async () => {
  // Es un solo lugar (validarArgs) justamente para que no haya que acordarse
  // de repetirlo en cada description.
  for (const [nombre, args] of [
    ["create_opportunity", {}],
    ["update_opportunity", { title: "x" }],
    ["create_booking", { resourceId: UUID }],
    ["create_lead", {}],
    ["search_vehicles", { year: "no es un año" }],
  ] as const) {
    assert.ok(
      (await rechazoDe(nombre, args)).endsWith(SUFIJO_ERROR_DE_ARGUMENTOS),
      `${nombre} tiene que llevar el sufijo`,
    );
  }
});

// ---------------------------------------------------------------------------
// Ítem 103: "el miércoles a las 11" es un instante, no un rango
// ---------------------------------------------------------------------------

test("get_availability: sin hasta, o con hasta igual a desde, ya no es un error", async () => {
  // El caso real, con dos modelos distintos: el cliente dice una hora puntual
  // y el modelo manda desde == hasta. Antes se rechazaba y el turno se quemaba
  // en un error que el cliente leía como "no hay lugar".
  const base = { resourceId: UUID, serviceTypeId: UUID };
  for (const args of [
    { ...base, desde: "2026-09-29T11:00:00-03:00" },
    { ...base, desde: "2026-09-29T11:00:00-03:00", hasta: "2026-09-29T11:00:00-03:00" },
    { ...base, desde: "2026-09-29T11:00:00-03:00", hasta: "" },
  ]) {
    const resultado = await CATALOGO_DE_TOOLS.get("get_availability")!.ejecutar(args, CONTEXTO);
    // Sin base no puede tener éxito, pero el error YA NO puede ser de
    // validación de argumentos: eso es lo que se está probando.
    assert.ok(
      resultado.ok || !resultado.error.startsWith("Argumentos inválidos"),
      `no debería ser un error de args: ${JSON.stringify(resultado)}`,
    );
  }
});

test("get_availability: un hasta ANTERIOR a desde sigue siendo un error", async () => {
  // Ahí el modelo no expresó mal un instante: se equivocó de orden, y taparlo
  // escondería el bug.
  assert.match(
    await rechazoDe("get_availability", {
      resourceId: UUID,
      serviceTypeId: UUID,
      desde: "2026-09-29T15:00:00-03:00",
      hasta: "2026-09-29T09:00:00-03:00",
    }),
    /posterior a desde/,
  );
});

test("get_availability y create_booking ya no exigen resourceId (ítem 102)", () => {
  for (const nombre of ["get_availability", "create_booking"]) {
    const params = CATALOGO_DE_TOOLS.get(nombre)!.definition.parameters as {
      required: string[];
      properties: Record<string, { description: string }>;
    };
    assert.ok(!params.required.includes("resourceId"), `${nombre} no debe exigir resourceId`);
    assert.ok(params.required.includes("serviceTypeId"), `${nombre} sí exige serviceTypeId`);
    assert.match(params.properties.resourceId.description, /NO hace falta mandarlo|se deduce/);
  }
});
