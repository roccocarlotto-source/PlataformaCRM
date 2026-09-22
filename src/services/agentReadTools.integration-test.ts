import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import {
  CATALOGO_DE_TOOLS,
  type ContextoDeEjecucionDeTool,
  type ResultadoDeTool,
} from "./agentTools.service";
import { createBranch } from "./branch.service";
import { createPipeline } from "./pipeline.service";
import { createResource } from "./resource.service";
import { createServiceType } from "./serviceType.service";
import { createStage } from "./stage.service";
import { borrador, desmontar, montar, type Escenario } from "./vehicle.test-helper";

// ---------------------------------------------------------------------------
// Ítems 84 y 85 de docs/frontend-cambios-pendientes.md contra Postgres real,
// llamando a las tools directo (mismo molde que branchPaymentInfo
// .integration-test.ts). El loop completo —permisos, auditoría en
// Message.toolCalls— ya lo cubre agentOrchestration.integration-test.ts y no
// cambió: estas tools pasan por el mismo camino que cualquier otra.
//
//   A. create_opportunity NO DUPLICA (ítem 84): con una OPEN del contacto,
//      devuelve esa en vez de crear otra.
//   B. LAS CUATRO TOOLS DE LECTURA (ítem 85): qué devuelven, que el contacto y
//      la sucursal salen del contexto, y que search_vehicles nunca muestra
//      una unidad no publicada ni un campo interno.
//
// DOS ORGANIZACIONES (vehicle.test-helper): B solo existe para los casos
// cross-tenant.
// ---------------------------------------------------------------------------

const TZ = "America/Montevideo";

let a: Escenario;
let b: Escenario;
let pipelineId: string;
let primeraEtapaId: string;

before(async () => {
  a = await montar("agent-read-tools-a");
  b = await montar("agent-read-tools-b");

  const pipeline = await createPipeline(a.organizationId, { name: "Ventas", isDefault: true });
  pipelineId = pipeline.id;
  primeraEtapaId = (await createStage(a.organizationId, { pipelineId, name: "Nuevo", order: 1 }))
    .id;
});

after(async () => {
  for (const e of [a, b]) {
    if (!e) continue;
    const organizationId = e.organizationId;
    // Orden de las FK: lo que cuelga del contacto/oportunidad primero.
    await prisma.activity.deleteMany({ where: { organizationId } });
    await prisma.opportunity.deleteMany({ where: { organizationId } });
    await prisma.contact.deleteMany({ where: { organizationId } });
    await prisma.stage.deleteMany({ where: { organizationId } });
    await prisma.pipeline.deleteMany({ where: { organizationId } });
    await prisma.serviceType.deleteMany({ where: { organizationId } });
    await prisma.resource.deleteMany({ where: { organizationId } });
  }
  await desmontar(a, b);
});

// Un contacto nuevo por test: cada caso arranca sin oportunidades ni
// actividades de otro.
async function nuevoContacto(e: Escenario, extra: { email?: string; phone?: string } = {}) {
  return prisma.contact.create({
    data: {
      organizationId: e.organizationId,
      firstName: "Ana",
      lastName: "Pérez",
      ownerId: e.userId,
      ...extra,
    },
  });
}

function contextoDe(
  organizationId: string,
  contactId: string,
  branchId: string,
): ContextoDeEjecucionDeTool {
  return {
    organizationId,
    conversation: {
      id: "00000000-0000-4000-8000-000000000002",
      contactId,
      branchId,
      agentId: "00000000-0000-4000-8000-000000000005",
    },
  };
}

async function ejecutar(
  nombre: string,
  args: Record<string, unknown>,
  contexto: ContextoDeEjecucionDeTool,
): Promise<ResultadoDeTool> {
  return CATALOGO_DE_TOOLS.get(nombre)!.ejecutar(args, contexto);
}

async function datosDe<T>(
  nombre: string,
  args: Record<string, unknown>,
  contexto: ContextoDeEjecucionDeTool,
): Promise<T> {
  const resultado = await ejecutar(nombre, args, contexto);
  assert.equal(resultado.ok, true, JSON.stringify(resultado));
  return (resultado as { ok: true; data: T }).data;
}

function oportunidadAbierta(e: Escenario, contactId: string, title: string, createdAt: Date) {
  return prisma.opportunity.create({
    data: {
      organizationId: e.organizationId,
      contactId,
      ownerId: e.userId,
      pipelineId,
      stageId: primeraEtapaId,
      title,
      createdAt,
    },
  });
}

// ---------------------------------------------------------------------------
// A. create_opportunity no duplica (ítem 84)
// ---------------------------------------------------------------------------

type ResultadoOportunidad = {
  opportunityId: string;
  title: string;
  stage: string;
  reused: boolean;
};

test("create_opportunity: sin ninguna abierta crea una, con reused en false", async () => {
  const contacto = await nuevoContacto(a);
  const ctx = contextoDe(a.organizationId, contacto.id, a.branchId);

  const data = await datosDe<ResultadoOportunidad>("create_opportunity", { title: "Corolla" }, ctx);

  assert.equal(data.reused, false);
  assert.equal(data.stage, "Nuevo");
  assert.equal(await prisma.opportunity.count({ where: { contactId: contacto.id } }), 1);
});

test("create_opportunity: con una OPEN del contacto devuelve esa y no crea ninguna fila", async () => {
  const contacto = await nuevoContacto(a);
  const ctx = contextoDe(a.organizationId, contacto.id, a.branchId);

  const primera = await datosDe<ResultadoOportunidad>(
    "create_opportunity",
    { title: "Consulta sobre vehículo de menos de 30 mil dólares" },
    ctx,
  );
  const antes = await prisma.opportunity.count({ where: { organizationId: a.organizationId } });

  // El caso real del ítem: el mismo pedido otra vez, con un título casi igual.
  const segunda = await datosDe<ResultadoOportunidad>(
    "create_opportunity",
    { title: "Consulta por vehículo de menos de 30 mil dólares", amount: 30_000, currency: "USD" },
    ctx,
  );

  assert.equal(segunda.reused, true);
  assert.equal(segunda.opportunityId, primera.opportunityId);
  // Devuelve la existente TAL CUAL: no le pisa el título ni el monto que
  // mandó el modelo (para eso está update_opportunity).
  assert.equal(segunda.title, "Consulta sobre vehículo de menos de 30 mil dólares");
  assert.equal(segunda.stage, "Nuevo");
  assert.equal(
    await prisma.opportunity.count({ where: { organizationId: a.organizationId } }),
    antes,
  );
});

test("create_opportunity: con dos OPEN preexistentes devuelve la más reciente", async () => {
  const contacto = await nuevoContacto(a);
  const vieja = await oportunidadAbierta(a, contacto.id, "Vieja", new Date("2026-09-01T12:00:00Z"));
  const nueva = await oportunidadAbierta(a, contacto.id, "Nueva", new Date("2026-09-20T12:00:00Z"));

  const data = await datosDe<ResultadoOportunidad>(
    "create_opportunity",
    { title: "Otra más" },
    contextoDe(a.organizationId, contacto.id, a.branchId),
  );

  assert.equal(data.reused, true);
  assert.equal(data.opportunityId, nueva.id);
  assert.notEqual(data.opportunityId, vieja.id);
  assert.equal(await prisma.opportunity.count({ where: { contactId: contacto.id } }), 2);
});

test("create_opportunity: una WON o LOST del contacto no cuenta — crea una nueva", async () => {
  const contacto = await nuevoContacto(a);
  const cerrada = await oportunidadAbierta(a, contacto.id, "Ya comprada", new Date());
  await prisma.opportunity.update({ where: { id: cerrada.id }, data: { status: "WON" } });

  const data = await datosDe<ResultadoOportunidad>(
    "create_opportunity",
    { title: "Segunda compra" },
    contextoDe(a.organizationId, contacto.id, a.branchId),
  );

  assert.equal(data.reused, false);
  assert.notEqual(data.opportunityId, cerrada.id);
  assert.equal(await prisma.opportunity.count({ where: { contactId: contacto.id } }), 2);
});

test("create_opportunity: reutilizar no toca el vendedor del contacto aunque no tenga uno", async () => {
  // Contacto sin vendedor, sucursal CON vendedor por defecto: crear le
  // asignaría el vendedor (ítem 69). Reutilizar una existente no crea nada,
  // así que tampoco tiene por qué escribir en el Contact.
  const sucursal = await createBranch(a.organizationId, {
    name: "Con vendedor por defecto",
    timezone: TZ,
    defaultOwnerId: a.userId,
  });
  const contacto = await prisma.contact.create({
    data: { organizationId: a.organizationId, firstName: "Sin", lastName: "Vendedor" },
  });
  await oportunidadAbierta(a, contacto.id, "Previa", new Date());

  const data = await datosDe<ResultadoOportunidad>(
    "create_opportunity",
    { title: "x" },
    contextoDe(a.organizationId, contacto.id, sucursal.id),
  );

  assert.equal(data.reused, true);
  const releido = await prisma.contact.findUniqueOrThrow({ where: { id: contacto.id } });
  assert.equal(releido.ownerId, null);
});

// ---------------------------------------------------------------------------
// B.1 get_contact_info
// ---------------------------------------------------------------------------

test("get_contact_info: devuelve los datos del contacto de la conversación", async () => {
  const contacto = await nuevoContacto(a, { email: "ana@example.test", phone: "+59899123456" });

  const data = await datosDe(
    "get_contact_info",
    {},
    contextoDe(a.organizationId, contacto.id, a.branchId),
  );

  assert.deepEqual(data, {
    firstName: "Ana",
    lastName: "Pérez",
    email: "ana@example.test",
    phone: "+59899123456",
    companyId: null,
  });
});

test("get_contact_info: contacto borrado o de otra organización → fallo claro, sin datos", async () => {
  const borrado = await nuevoContacto(a);
  await prisma.contact.update({ where: { id: borrado.id }, data: { deletedAt: new Date() } });
  const deB = await nuevoContacto(b);

  for (const contactId of [borrado.id, deB.id]) {
    const resultado = await ejecutar(
      "get_contact_info",
      {},
      contextoDe(a.organizationId, contactId, a.branchId),
    );
    assert.deepEqual(resultado, {
      ok: false,
      error: "El contacto de esta conversación ya no existe",
    });
  }
});

// ---------------------------------------------------------------------------
// B.2 search_vehicles
// ---------------------------------------------------------------------------

type Vehiculo = Record<string, unknown> & { id: string; priceListUsd: number | null };
type ResultadoBusqueda = { total: number; vehiculos: Vehiculo[] };

const CAMPOS_PUBLICOS = [
  "acceptsTradeIn",
  "bodyType",
  "exteriorColor",
  "financingAvailable",
  "fuelType",
  "id",
  "internalCode",
  "make",
  "mileage",
  "model",
  "priceListLocal",
  "priceListUsd",
  "priceOnRequest",
  "transmission",
  "trim",
  "year",
];

// Una unidad publicada y disponible. publishOnWebsite se prende directo en la
// base: la regla de completitud (foto, etc.) es del alta desde el panel y no
// es lo que se prueba acá.
async function unidad(
  e: Escenario,
  datos: Parameters<typeof borrador>[1],
  estado: { publishOnWebsite?: boolean; status?: "AVAILABLE" | "RESERVED" | "SOLD" } = {},
) {
  const v = await borrador(e, datos);
  return prisma.vehicle.update({
    where: { id: v.id },
    data: {
      publishOnWebsite: estado.publishOnWebsite ?? true,
      status: estado.status ?? "AVAILABLE",
    },
  });
}

// Una organización propia para el stock: search_vehicles no filtra por
// sucursal, así que las unidades de otros tests de A se mezclarían.
let stock: Escenario;
let publicadaBarata: string;
let publicadaCara: string;

before(async () => {
  stock = await montar("agent-read-tools-stock");
  // Datos internos cargados a propósito, para poder afirmar que no salen.
  publicadaCara = (
    await unidad(stock, {
      make: "Toyota",
      model: "Hilux",
      year: 2023,
      bodyType: "PICKUP",
      priceListUsd: 45_000,
      // Ítem 86: un valor distinto del de la Corolla en cada filtro nuevo.
      condition: "NEW",
      trim: "SRX",
      transmission: "AUTOMATIC",
      fuelType: "DIESEL",
      exteriorColor: "Gris plata",
      mileage: 10,
      acceptsTradeIn: true,
      equipment: ["TECHO_SOLAR", "CAMARA_DE_RETROCESO"],
      minAcceptablePriceUsd: 41_000,
      acquisitionCostUsd: 38_000,
      internalNotes: "El dueño acepta bajar",
    })
  ).id;
  publicadaBarata = (
    await unidad(stock, {
      make: "Toyota",
      model: "Corolla",
      year: 2020,
      bodyType: "SEDAN",
      priceListUsd: 18_000,
      priceListLocal: 750_000,
      mileage: 60_000,
      financingAvailable: true,
      transmission: "CVT",
      fuelType: "GASOLINE",
      exteriorColor: "Blanco perla",
      publicDescription: "Único dueño, service oficial al día.",
      // Para probar que el texto libre NO busca en la patente (q sí lo hace).
      licensePlate: "SBX1234",
    })
  ).id;
  // Disponible pero NO publicada, y publicada pero reservada: ninguna sale.
  await unidad(stock, { make: "Toyota", priceListUsd: 10_000 }, { publishOnWebsite: false });
  await unidad(stock, { make: "Toyota", priceListUsd: 12_000 }, { status: "RESERVED" });
});

after(async () => {
  await desmontar(stock);
});

test("search_vehicles: solo publicadas y disponibles, ordenadas por precio, con total", async () => {
  const data = await datosDe<ResultadoBusqueda>(
    "search_vehicles",
    {},
    contextoDe(stock.organizationId, "00000000-0000-4000-8000-000000000003", stock.branchId),
  );
  assert.equal(data.total, 2);
  assert.deepEqual(
    data.vehiculos.map((v) => v.id),
    [publicadaBarata, publicadaCara],
  );
  // Decimal → number, no string.
  assert.equal(data.vehiculos[0].priceListUsd, 18_000);
  assert.equal(data.vehiculos[0].priceListLocal, 750_000);
});

test("search_vehicles: una unidad AVAILABLE pero con publishOnWebsite false no aparece nunca", async () => {
  // Ni siquiera pidiéndola por su precio exacto, ni mandando los flags
  // internos como argumentos (Zod los descarta).
  const data = await datosDe<ResultadoBusqueda>(
    "search_vehicles",
    { priceMinUsd: 9_000, priceMaxUsd: 13_000, publishOnWebsite: false, status: ["RESERVED"] },
    contextoDe(stock.organizationId, "00000000-0000-4000-8000-000000000003", stock.branchId),
  );
  assert.deepEqual(data, { total: 0, vehiculos: [] });
});

test("search_vehicles: los campos internos nunca están en la respuesta", async () => {
  const data = await datosDe<ResultadoBusqueda>(
    "search_vehicles",
    {},
    contextoDe(stock.organizationId, "00000000-0000-4000-8000-000000000003", stock.branchId),
  );
  for (const v of data.vehiculos) {
    assert.deepEqual(Object.keys(v).sort(), CAMPOS_PUBLICOS);
  }
  const serializado = JSON.stringify(data);
  for (const interno of ["41000", "38000", "El dueño acepta bajar"]) {
    assert.ok(!serializado.includes(interno), `se filtró "${interno}"`);
  }
});

test("search_vehicles: filtra por precio, marca, modelo, año y carrocería", async () => {
  const ctx = contextoDe(
    stock.organizationId,
    "00000000-0000-4000-8000-000000000003",
    stock.branchId,
  );
  const ids = async (args: Record<string, unknown>) =>
    (await datosDe<ResultadoBusqueda>("search_vehicles", args, ctx)).vehiculos.map((v) => v.id);

  assert.deepEqual(await ids({ priceMaxUsd: 30_000 }), [publicadaBarata]);
  assert.deepEqual(await ids({ priceMinUsd: 30_000 }), [publicadaCara]);
  assert.deepEqual(await ids({ make: "Toyota", model: "Hilux" }), [publicadaCara]);
  assert.deepEqual(await ids({ year: 2020 }), [publicadaBarata]);
  assert.deepEqual(await ids({ bodyType: "PICKUP" }), [publicadaCara]);
  assert.deepEqual(await ids({ make: "Ford" }), []);
});

// ---------------------------------------------------------------------------
// Ítem 86: el payload real, y los filtros nuevos
// ---------------------------------------------------------------------------

test("search_vehicles: el payload real de gpt-4.1-nano ya no es un error — los vacíos no filtran", async () => {
  const ctx = contextoDe(
    stock.organizationId,
    "00000000-0000-4000-8000-000000000003",
    stock.branchId,
  );
  // Tal cual llegó en producción (22/09/2026). bodyType VAN sí es un filtro
  // que el modelo mandó, así que se aplica: cero resultados, pero ok.
  const real = await ejecutar(
    "search_vehicles",
    { make: "", model: "", year: 0, bodyType: "VAN", priceMinUsd: 0, priceMaxUsd: 30_000 },
    ctx,
  );
  assert.deepEqual(real, { ok: true, data: { total: 0, vehiculos: [] } });

  // Lo mismo sin la carrocería inventada: aparece la de menos de USD 30.000.
  const sinVan = await datosDe<ResultadoBusqueda>(
    "search_vehicles",
    { make: "", model: "", year: 0, priceMinUsd: 0, priceMaxUsd: 30_000 },
    ctx,
  );
  assert.deepEqual(
    sinVan.vehiculos.map((v) => v.id),
    [publicadaBarata],
  );
});

test("search_vehicles: null, espacios, año fuera de rango y false también cuentan como no enviados", async () => {
  const data = await datosDe<ResultadoBusqueda>(
    "search_vehicles",
    {
      make: "   ",
      model: null,
      year: 1900,
      bodyType: "",
      condition: "",
      transmission: null,
      fuelType: "",
      exteriorColor: "",
      mileageMax: 0,
      priceMaxUsd: 0,
      financingAvailable: false,
      acceptsTradeIn: false,
      texto: "",
    },
    contextoDe(stock.organizationId, "00000000-0000-4000-8000-000000000003", stock.branchId),
  );
  assert.equal(data.total, 2, "sin ningún filtro aplicado salen las dos publicadas");
});

test("search_vehicles: cada filtro nuevo filtra de verdad", async () => {
  const ctx = contextoDe(
    stock.organizationId,
    "00000000-0000-4000-8000-000000000003",
    stock.branchId,
  );
  const ids = async (args: Record<string, unknown>) =>
    (await datosDe<ResultadoBusqueda>("search_vehicles", args, ctx)).vehiculos.map((v) => v.id);

  assert.deepEqual(await ids({ condition: "NEW" }), [publicadaCara]);
  assert.deepEqual(await ids({ condition: "USED" }), [publicadaBarata]);
  assert.deepEqual(await ids({ transmission: "CVT" }), [publicadaBarata]);
  assert.deepEqual(await ids({ fuelType: "DIESEL" }), [publicadaCara]);
  // contains sin mayúsculas: "blanco" encuentra "Blanco perla".
  assert.deepEqual(await ids({ exteriorColor: "blanco" }), [publicadaBarata]);
  assert.deepEqual(await ids({ mileageMax: 50_000 }), [publicadaCara]);
  assert.deepEqual(await ids({ financingAvailable: true }), [publicadaBarata]);
  assert.deepEqual(await ids({ acceptsTradeIn: true }), [publicadaCara]);
  // Combinados: AND.
  assert.deepEqual(await ids({ condition: "NEW", fuelType: "GASOLINE" }), []);
});

test("search_vehicles: texto busca en equipamiento, versión y descripción pública", async () => {
  const ctx = contextoDe(
    stock.organizationId,
    "00000000-0000-4000-8000-000000000003",
    stock.branchId,
  );
  const ids = async (texto: string) =>
    (await datosDe<ResultadoBusqueda>("search_vehicles", { texto }, ctx)).vehiculos.map(
      (v) => v.id,
    );

  // Equipamiento: el texto se lleva al formato del código (TECHO_SOLAR).
  assert.deepEqual(await ids("techo solar"), [publicadaCara]);
  assert.deepEqual(await ids("Cámara de retroceso"), [publicadaCara]);
  assert.deepEqual(await ids("srx"), [publicadaCara]);
  assert.deepEqual(await ids("service oficial"), [publicadaBarata]);
  assert.deepEqual(await ids("hilux"), [publicadaCara]);
});

test("search_vehicles: texto NO busca en patente ni VIN, y combina con los filtros", async () => {
  const ctx = contextoDe(
    stock.organizationId,
    "00000000-0000-4000-8000-000000000003",
    stock.branchId,
  );
  // La Corolla tiene patente SBX1234: el q del panel la encontraría; desde un
  // canal público no se puede averiguar si una patente está en stock.
  const porPatente = await datosDe<ResultadoBusqueda>("search_vehicles", { texto: "SBX1234" }, ctx);
  assert.deepEqual(porPatente, { total: 0, vehiculos: [] });

  const combinado = await datosDe<ResultadoBusqueda>(
    "search_vehicles",
    { texto: "toyota", priceMaxUsd: 30_000 },
    ctx,
  );
  assert.deepEqual(
    combinado.vehiculos.map((v) => v.id),
    [publicadaBarata],
  );
});

test("search_vehicles: priceMinUsd 0 no esconde las unidades sin precio de lista", async () => {
  // Un gte 0 sobre priceListUsd dejaría afuera las de "precio a consultar"
  // (priceListUsd null). 0 como mínimo es "sin mínimo".
  const propio = await montar("agent-read-tools-sin-precio");
  try {
    const sinPrecio = await unidad(propio, { priceOnRequest: true });
    const data = await datosDe<ResultadoBusqueda>(
      "search_vehicles",
      { priceMinUsd: 0 },
      contextoDe(propio.organizationId, "00000000-0000-4000-8000-000000000003", propio.branchId),
    );
    assert.deepEqual(
      data.vehiculos.map((v) => v.id),
      [sinPrecio.id],
    );
  } finally {
    await desmontar(propio);
  }
});

test("search_vehicles: el stock de otra organización no se ve", async () => {
  const data = await datosDe<ResultadoBusqueda>(
    "search_vehicles",
    {},
    contextoDe(b.organizationId, "00000000-0000-4000-8000-000000000003", b.branchId),
  );
  assert.deepEqual(data, { total: 0, vehiculos: [] });
});

test("search_vehicles: devuelve como máximo 10, con el total real", async () => {
  const lleno = await montar("agent-read-tools-lleno");
  try {
    for (let i = 0; i < 12; i++) {
      await unidad(lleno, { priceListUsd: 10_000 + i });
    }
    const data = await datosDe<ResultadoBusqueda>(
      "search_vehicles",
      {},
      contextoDe(lleno.organizationId, "00000000-0000-4000-8000-000000000003", lleno.branchId),
    );
    assert.equal(data.vehiculos.length, 10);
    assert.equal(data.total, 12);
  } finally {
    await desmontar(lleno);
  }
});

// ---------------------------------------------------------------------------
// B.3 get_service_types
// ---------------------------------------------------------------------------

test("get_service_types: los de la sucursal de la conversación, con su resourceId", async () => {
  const sucursal = await createBranch(a.organizationId, { name: "Taller", timezone: TZ });
  const vecina = await createBranch(a.organizationId, { name: "Taller vecino", timezone: TZ });

  const recurso = await createResource(a.organizationId, {
    branchId: sucursal.id,
    name: "Box 1",
    type: "ROOM",
  });
  const service = await createServiceType(a.organizationId, {
    branchId: sucursal.id,
    resourceId: recurso.id,
    name: "Service de 10.000 km",
    durationMin: 90,
  });
  const borrado = await createServiceType(a.organizationId, {
    branchId: sucursal.id,
    resourceId: recurso.id,
    name: "Lavado (dado de baja)",
    durationMin: 30,
  });
  await prisma.serviceType.update({ where: { id: borrado.id }, data: { deletedAt: new Date() } });

  const recursoVecino = await createResource(a.organizationId, {
    branchId: vecina.id,
    name: "Box vecino",
    type: "ROOM",
  });
  await createServiceType(a.organizationId, {
    branchId: vecina.id,
    resourceId: recursoVecino.id,
    name: "De la otra sucursal",
    durationMin: 60,
  });

  const data = await datosDe(
    "get_service_types",
    {},
    contextoDe(a.organizationId, "00000000-0000-4000-8000-000000000003", sucursal.id),
  );
  assert.deepEqual(data, {
    serviceTypes: [
      {
        id: service.id,
        name: "Service de 10.000 km",
        durationMin: 90,
        capacity: 1,
        resourceId: recurso.id,
      },
    ],
  });
});

test("get_service_types: sucursal sin tipos de servicio → lista vacía, no un error", async () => {
  const sucursal = await createBranch(a.organizationId, { name: "Sin servicios", timezone: TZ });
  const data = await datosDe(
    "get_service_types",
    {},
    contextoDe(a.organizationId, "00000000-0000-4000-8000-000000000003", sucursal.id),
  );
  assert.deepEqual(data, { serviceTypes: [] });
});

// ---------------------------------------------------------------------------
// B.4 get_contact_activities
// ---------------------------------------------------------------------------

function actividad(
  e: Escenario,
  contactId: string,
  subject: string,
  extra: { dueDate?: Date; completedAt?: Date; deletedAt?: Date; body?: string } = {},
) {
  return prisma.activity.create({
    data: {
      organizationId: e.organizationId,
      authorId: e.userId,
      contactId,
      type: "CALL",
      subject,
      ...extra,
    },
  });
}

type ResultadoActividades = {
  activities: { subject: string; type: string; dueDate: string | null }[];
};

test("get_contact_activities: las pendientes del contacto, por dueDate, máximo 5, sin body", async () => {
  const contacto = await nuevoContacto(a);
  const otro = await nuevoContacto(a);
  const dia = (d: number) => new Date(`2026-10-${String(d).padStart(2, "0")}T15:00:00Z`);

  // Seis pendientes, creadas desordenadas; la vencida también cuenta.
  await actividad(a, contacto.id, "Día 5", { dueDate: dia(5), body: "nota interna" });
  await actividad(a, contacto.id, "Sin fecha");
  await actividad(a, contacto.id, "Día 2", { dueDate: dia(2) });
  await actividad(a, contacto.id, "Vencida", { dueDate: new Date("2026-01-01T12:00:00Z") });
  await actividad(a, contacto.id, "Día 9", { dueDate: dia(9) });
  await actividad(a, contacto.id, "Día 7", { dueDate: dia(7) });
  // Las que NO salen: completada, borrada, y de otro contacto.
  await actividad(a, contacto.id, "Completada", { dueDate: dia(1), completedAt: new Date() });
  await actividad(a, contacto.id, "Borrada", { dueDate: dia(1), deletedAt: new Date() });
  await actividad(a, otro.id, "De otro contacto", { dueDate: dia(1) });

  const data = await datosDe<ResultadoActividades>(
    "get_contact_activities",
    {},
    contextoDe(a.organizationId, contacto.id, a.branchId),
  );

  assert.deepEqual(
    data.activities.map((x) => x.subject),
    ["Vencida", "Día 2", "Día 5", "Día 7", "Día 9"],
  );
  assert.deepEqual(data.activities[1], {
    subject: "Día 2",
    type: "CALL",
    dueDate: dia(2).toISOString(),
  });
  assert.ok(!JSON.stringify(data).includes("nota interna"), "el body no sale");
});

test("get_contact_activities: sin nada agendado → lista vacía", async () => {
  const contacto = await nuevoContacto(a);
  const data = await datosDe(
    "get_contact_activities",
    {},
    contextoDe(a.organizationId, contacto.id, a.branchId),
  );
  assert.deepEqual(data, { activities: [] });
});

// ---------------------------------------------------------------------------
// Ninguna de las cuatro escribe
// ---------------------------------------------------------------------------

test("las tools de lectura no escriben: el contacto queda igual después de ejecutarlas", async () => {
  const contacto = await nuevoContacto(a);
  const antes = await prisma.contact.findUniqueOrThrow({ where: { id: contacto.id } });
  const ctx = contextoDe(a.organizationId, contacto.id, a.branchId);
  for (const nombre of [
    "get_contact_info",
    "search_vehicles",
    "get_service_types",
    "get_contact_activities",
  ]) {
    assert.equal((await ejecutar(nombre, {}, ctx)).ok, true, nombre);
  }
  const despues = await prisma.contact.findUniqueOrThrow({ where: { id: contacto.id } });
  assert.equal(despues.updatedAt.getTime(), antes.updatedAt.getTime());
});
