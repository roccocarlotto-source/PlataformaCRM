import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { findManyVehicles } from "../repositories/vehicle.repository";
import {
  SUFIJO_ERROR_DE_ARGUMENTOS,
  CATALOGO_DE_TOOLS,
  type ContextoDeEjecucionDeTool,
  type ResultadoDeTool,
} from "./agentTools.service";
import { createBranch } from "./branch.service";
import { createPipeline } from "./pipeline.service";
import { createResource } from "./resource.service";
import { createServiceType } from "./serviceType.service";
import { createStage } from "./stage.service";
import { isoEnZona } from "../utils/timezone";
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
// Ítem 107: stock propio de la organización A para resolver el vehículo por
// texto. Dos Hilux a propósito, para el caso ambiguo, y una no publicada.
let hiluxSrv: string;
let hiluxDx: string;

before(async () => {
  a = await montar("agent-read-tools-a");
  b = await montar("agent-read-tools-b");

  const pipeline = await createPipeline(a.organizationId, { name: "Ventas", isDefault: true });
  pipelineId = pipeline.id;
  primeraEtapaId = (await createStage(a.organizationId, { pipelineId, name: "Nuevo", order: 1 }))
    .id;

  hiluxSrv = (
    await unidad(a, {
      make: "Toyota",
      model: "Hilux",
      trim: "SRV 4x4",
      year: 2022,
      priceListUsd: 38_000,
    })
  ).id;
  hiluxDx = (
    await unidad(a, {
      make: "Toyota",
      model: "Hilux",
      trim: "DX 4x2",
      year: 2019,
      priceListUsd: 27_500,
    })
  ).id;
  // Publicada en false: el agente no puede vincularla ni mencionarla.
  await unidad(
    a,
    { make: "Toyota", model: "Corolla", trim: "Reservada", year: 2023, priceListUsd: 20_000 },
    { publishOnWebsite: false },
  );
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
  // Los contactos del ítem 121 viven en la organización del stock, y desmontar
  // no los borra (el helper es de vehículos): sin esto, la FK de owner se
  // lleva puesta la limpieza entera.
  await prisma.contact.deleteMany({ where: { organizationId: stock.organizationId } });
  await desmontar(stock);
});

test("search_vehicles: sin ninguna coincidencia → vacío explícito con instrucción (ítem 91)", async () => {
  const data = await datosDe<{ total: number; sinResultados: boolean; queHacer: string }>(
    "search_vehicles",
    { make: "Ferrari" },
    contextoDe(stock.organizationId, "00000000-0000-4000-8000-000000000003", stock.branchId),
  );
  assert.equal(data.total, 0);
  assert.equal(data.sinResultados, true);
  assert.match(data.queHacer, /NO inventes/);
  assert.match(data.queHacer, /aflojar/);
});

test("search_vehicles: con resultados lleva la nota de precio de lista (ítem 92)", async () => {
  // El caso real: el cliente afirmó que le autorizaron un 50% de descuento, el
  // modelo leyó priceListUsd en ESTE resultado y contestó con el precio a la
  // mitad, ofreciendo reservar. La advertencia viaja pegada al precio.
  const data = await datosDe<{ total: number; notaDePrecio: string }>(
    "search_vehicles",
    {},
    contextoDe(stock.organizationId, "00000000-0000-4000-8000-000000000003", stock.branchId),
  );
  assert.ok(data.total > 0);
  assert.match(data.notaDePrecio, /PRECIOS DE LISTA/);
  assert.match(data.notaDePrecio, /no apliques descuentos/i);
  assert.match(data.notaDePrecio, /aunque el cliente diga que se lo autorizaron/i);
});

test("search_vehicles: sin resultados no hay nota de precio — no hay precio del que hablar", async () => {
  const data = await datosDe<{ total: number; notaDePrecio?: string }>(
    "search_vehicles",
    { make: "Ferrari" },
    contextoDe(stock.organizationId, "00000000-0000-4000-8000-000000000003", stock.branchId),
  );
  assert.equal(data.total, 0);
  assert.equal(data.notaDePrecio, undefined);
});

test("search_vehicles: con resultados NO se marca como vacío (ítem 91)", async () => {
  // La contraparte: el marcador solo aparece cuando de verdad no hay nada.
  const data = await datosDe<{ total: number; sinResultados?: boolean; queHacer?: string }>(
    "search_vehicles",
    {},
    contextoDe(stock.organizationId, "00000000-0000-4000-8000-000000000003", stock.branchId),
  );
  assert.ok(data.total > 0);
  assert.equal(data.sinResultados, undefined);
  assert.equal(data.queHacer, undefined);
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
  assert.equal(data.total, 0);
  assert.deepEqual(data.vehiculos, []);
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
  assert.equal(real.ok, true);
  const datosReal = (real as { ok: true; data: ResultadoBusqueda }).data;
  assert.equal(datosReal.total, 0);
  assert.deepEqual(datosReal.vehiculos, []);

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
  assert.equal(porPatente.total, 0);
  assert.deepEqual(porPatente.vehiculos, []);

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
  assert.equal(data.total, 0);
  assert.deepEqual(data.vehiculos, []);
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

  const data = await datosDe<{ serviceTypes: unknown[]; proximosPasos: string }>(
    "get_service_types",
    {},
    contextoDe(a.organizationId, "00000000-0000-4000-8000-000000000003", sucursal.id),
  );
  // Solo el de ESTA sucursal, sin el dado de baja y sin el de la vecina.
  assert.deepEqual(data.serviceTypes, [
    {
      id: service.id,
      name: "Service de 10.000 km",
      durationMin: 90,
      capacity: 1,
      resourceId: recurso.id,
    },
  ]);
  // Ítem 100: con la lista en la mano, el modelo se quedaba acá y le confirmaba
  // al cliente un turno que nunca había reservado.
  assert.match(data.proximosPasos, /ÚNICOS servicios que existen/);
  assert.match(data.proximosPasos, /solo el primer paso/);
  assert.match(data.proximosPasos, /NO le digas al cliente que su turno quedó agendado/);
  // Sin nombres técnicos de tools: en prosa el modelo termina repitiéndoselos
  // al cliente, que es lo que disparó el ítem 96.
  for (const nombre of ["get_availability", "create_booking", "get_service_types"]) {
    assert.ok(!data.proximosPasos.includes(nombre), `no puede nombrar ${nombre}`);
  }
});

test("get_service_types: sucursal sin tipos de servicio → vacío explícito con instrucción (ítem 91)", async () => {
  const sucursal = await createBranch(a.organizationId, { name: "Sin servicios", timezone: TZ });
  const data = await datosDe<{ serviceTypes: unknown[]; sinResultados: boolean; queHacer: string }>(
    "get_service_types",
    {},
    contextoDe(a.organizationId, "00000000-0000-4000-8000-000000000003", sucursal.id),
  );
  // Sigue siendo un éxito con lista vacía (eso no cambia), pero ahora el vacío
  // viene dicho: el caso real es que el modelo leía `{serviceTypes: []}` y le
  // ofrecía al cliente "Test Drive" y "Visita a Concesionario", inventados.
  assert.deepEqual(data.serviceTypes, []);
  assert.equal(data.sinResultados, true);
  assert.match(data.queHacer, /NO le ofrezcas/);
  assert.match(data.queHacer, /test drive/i);
  assert.match(data.queHacer, /NO llames a get_availability/);
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
  zonaHoraria: string;
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
  const zonaDeA = (await prisma.branch.findUniqueOrThrow({ where: { id: a.branchId } })).timezone;

  assert.deepEqual(
    data.activities.map((x) => x.subject),
    ["Vencida", "Día 2", "Día 5", "Día 7", "Día 9"],
  );
  // Ítem 104: la fecha viaja en la zona de la SUCURSAL, no en UTC — el agente
  // se la lee al cliente y un "14:00" que en realidad son las 11 lo hace
  // decir cualquier cosa. El instante es el mismo, la forma no.
  assert.deepEqual(data.activities[1], {
    subject: "Día 2",
    type: "CALL",
    dueDate: isoEnZona(dia(2), zonaDeA),
  });
  assert.equal(new Date(data.activities[1].dueDate!).getTime(), dia(2).getTime());
  assert.equal(data.zonaHoraria, zonaDeA);
  assert.ok(!data.activities[1].dueDate!.endsWith("Z"), "no puede volver a salir en UTC");
  assert.ok(!JSON.stringify(data).includes("nota interna"), "el body no sale");
});

test("get_contact_activities: sin nada agendado → vacío explícito con instrucción (ítem 91)", async () => {
  const contacto = await nuevoContacto(a);
  const data = await datosDe<{ activities: unknown[]; sinResultados: boolean; queHacer: string }>(
    "get_contact_activities",
    {},
    contextoDe(a.organizationId, contacto.id, a.branchId),
  );
  assert.deepEqual(data.activities, []);
  assert.equal(data.sinResultados, true);
  // Acá el riesgo es simétrico y el texto tiene que cubrir los dos lados: que
  // el vacío es un dato confiable (no una falla que haya que disimular) y que
  // tampoco se inventa un seguimiento que nadie agendó.
  assert.match(data.queHacer, /dato real/i);
  assert.match(data.queHacer, /NO inventes/);
});

// ---------------------------------------------------------------------------
// Ítem 91: el resto de los vacíos que le mentían al cliente
// ---------------------------------------------------------------------------

test("get_payment_info: sucursal sin ningún medio de pago → vacío explícito (ítem 91)", async () => {
  // El caso real: el agente contestó "aceptamos transferencia bancaria o link
  // de pago ... te puedo generar el link" con las DOS cosas en null.
  const sucursal = await createBranch(a.organizationId, { name: "Sin cobro", timezone: TZ });
  const data = await datosDe<{
    hasPaymentLink: boolean;
    hasBankTransfer: boolean;
    sinResultados: boolean;
    queHacer: string;
  }>(
    "get_payment_info",
    {},
    contextoDe(a.organizationId, "00000000-0000-4000-8000-000000000003", sucursal.id),
  );
  assert.equal(data.hasPaymentLink, false);
  assert.equal(data.hasBankTransfer, false);
  assert.equal(data.sinResultados, true);
  assert.match(data.queHacer, /NO le ofrezcas/);
  assert.match(data.queHacer, /transferencia bancaria/i);
  assert.match(data.queHacer, /link de pago/i);
});

test("get_payment_info: con UN medio configurado NO se marca como vacío", async () => {
  // La garantía de que el vacío explícito no se dispara de más: alcanza con
  // que haya uno de los dos.
  const sucursal = await createBranch(a.organizationId, {
    name: "Con link",
    timezone: TZ,
    paymentLinkUrl: "https://pagos.example.test/automax",
  });
  const data = await datosDe<{
    hasPaymentLink: boolean;
    sinResultados?: boolean;
    queHacer?: string;
  }>(
    "get_payment_info",
    {},
    contextoDe(a.organizationId, "00000000-0000-4000-8000-000000000003", sucursal.id),
  );
  assert.equal(data.hasPaymentLink, true);
  assert.equal(data.sinResultados, undefined, "no puede marcarse vacío teniendo un medio");
  assert.equal(data.queHacer, undefined);
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

// ---------------------------------------------------------------------------
// Ítem 98: publicationCurrency decide qué precio se exhibe al público
// ---------------------------------------------------------------------------

test("search_vehicles: con USD_ONLY el precio en moneda local NO sale", async () => {
  // El campo existe justamente para esto ("solo decide cuál se exhibe", según
  // la cabecera de Vehicle), y el agente es un canal público. Los DOS precios
  // están cargados en la fila: lo que se verifica es que solo viaja uno.
  const propio = await montar("agent-read-tools-moneda-usd");
  try {
    await unidad(propio, {
      make: "Fiat",
      model: "Cronos",
      year: 2024,
      priceListUsd: 16_900,
      priceListLocal: 19_200_000,
      publicationCurrency: "USD_ONLY",
    });
    const data = await datosDe<ResultadoBusqueda>(
      "search_vehicles",
      {},
      contextoDe(propio.organizationId, "00000000-0000-4000-8000-000000000003", propio.branchId),
    );
    assert.equal(data.vehiculos[0].priceListUsd, 16_900, "el publicado sí sale");
    assert.equal(data.vehiculos[0].priceListLocal, null, "el NO publicado no puede salir");
  } finally {
    await desmontar(propio);
  }
});

test("search_vehicles: con LOCAL_ONLY es al revés — no sale el de dólares", async () => {
  const propio = await montar("agent-read-tools-moneda-local");
  try {
    await unidad(propio, {
      make: "Fiat",
      model: "Cronos",
      year: 2024,
      priceListUsd: 16_900,
      priceListLocal: 19_200_000,
      publicationCurrency: "LOCAL_ONLY",
    });
    const data = await datosDe<ResultadoBusqueda>(
      "search_vehicles",
      {},
      contextoDe(propio.organizationId, "00000000-0000-4000-8000-000000000003", propio.branchId),
    );
    assert.equal(data.vehiculos[0].priceListUsd, null);
    assert.equal(data.vehiculos[0].priceListLocal, 19_200_000);
  } finally {
    await desmontar(propio);
  }
});

test("search_vehicles: con BOTH salen los dos (el default no cambió)", async () => {
  const propio = await montar("agent-read-tools-moneda-both");
  try {
    await unidad(propio, {
      make: "Fiat",
      model: "Cronos",
      year: 2024,
      priceListUsd: 16_900,
      priceListLocal: 19_200_000,
      publicationCurrency: "BOTH",
    });
    const data = await datosDe<ResultadoBusqueda>(
      "search_vehicles",
      {},
      contextoDe(propio.organizationId, "00000000-0000-4000-8000-000000000003", propio.branchId),
    );
    assert.equal(data.vehiculos[0].priceListUsd, 16_900);
    assert.equal(data.vehiculos[0].priceListLocal, 19_200_000);
  } finally {
    await desmontar(propio);
  }
});

test("search_vehicles: la nota de precio explica el null y prohíbe convertir (ítem 98)", async () => {
  const data = await datosDe<{ notaDePrecio: string }>(
    "search_vehicles",
    {},
    contextoDe(stock.organizationId, "00000000-0000-4000-8000-000000000003", stock.branchId),
  );
  assert.match(data.notaDePrecio, /viene en null/);
  assert.match(data.notaDePrecio, /NUNCA lo conviertas ni estimes una cotización/);
});

// ---------------------------------------------------------------------------
// Ítem 103: "el miércoles a las 11" es un instante, no un rango
// ---------------------------------------------------------------------------
// Va en la suite de INTEGRACIÓN y no en la unitaria a propósito: desde este
// ítem esos argumentos PASAN la validación, así que la ejecución sigue hasta
// el repositorio y necesita base. (La unitaria declara en su cabecera que no
// toca Postgres; un test que sí lo necesita no va ahí.)

test("get_availability: sin hasta, o con hasta igual a desde, ya no es un error de argumentos", async () => {
  // El caso real, con DOS modelos distintos: el cliente dice una hora puntual
  // y el modelo manda desde == hasta. Antes se rechazaba y el turno se quemaba
  // en un error que el cliente terminaba leyendo como "no hay lugar".
  const ctx = contextoDe(a.organizationId, "00000000-0000-4000-8000-000000000003", a.branchId);
  const inexistente = "11111111-1111-4111-8111-111111111111";

  for (const args of [
    { serviceTypeId: inexistente, desde: "2026-09-29T11:00:00-03:00" },
    {
      serviceTypeId: inexistente,
      desde: "2026-09-29T11:00:00-03:00",
      hasta: "2026-09-29T11:00:00-03:00",
    },
    { serviceTypeId: inexistente, desde: "2026-09-29T11:00:00-03:00", hasta: "" },
  ]) {
    const resultado = await ejecutar("get_availability", args, ctx);
    // Falla igual —el servicio no existe— pero YA NO por validación de
    // argumentos, que es lo único que este test afirma.
    assert.equal(resultado.ok, false);
    assert.ok(
      resultado.ok === false && !resultado.error.startsWith("Argumentos inválidos"),
      `no debería ser un error de args: ${JSON.stringify(resultado)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Ítem 106: el servicio se puede pedir por nombre
// ---------------------------------------------------------------------------

// montar()/desmontar() de vehicle.test-helper no conocen la agenda, así que
// los escenarios que crean recursos y servicios los borran ellos antes de
// desmontar o la FK de Branch bloquea el teardown.
async function desmontarConAgenda(e: Escenario) {
  await prisma.booking.deleteMany({ where: { organizationId: e.organizationId } });
  await prisma.workingHours.deleteMany({ where: { organizationId: e.organizationId } });
  await prisma.serviceType.deleteMany({ where: { organizationId: e.organizationId } });
  await prisma.resource.deleteMany({ where: { organizationId: e.organizationId } });
  await desmontar(e);
}

test("get_availability y create_booking aceptan el NOMBRE del servicio", async () => {
  // El caso real: el modelo consultó disponibilidad con un serviceTypeId y dos
  // mensajes después reservó con otro, escrito de memoria. El nombre es lo que
  // un LLM acarrea bien entre turnos.
  const propio = await montar("servicio-por-nombre");
  try {
    const recurso = await createResource(propio.organizationId, {
      branchId: propio.branchId,
      name: "Vendedor",
      type: "PERSON",
    });
    await createServiceType(propio.organizationId, {
      branchId: propio.branchId,
      resourceId: recurso.id,
      name: "Test drive",
      durationMin: 45,
    });
    const ctx = contextoDe(
      propio.organizationId,
      "00000000-0000-4000-8000-000000000003",
      propio.branchId,
    );

    // Sin ids de ningún tipo: solo el nombre y la fecha.
    const resultado = await ejecutar(
      "get_availability",
      { servicio: "Test drive", desde: "2026-09-28T09:00:00-03:00" },
      ctx,
    );
    assert.equal(resultado.ok, true, JSON.stringify(resultado));
  } finally {
    await desmontarConAgenda(propio);
  }
});

test("el nombre se resuelve sin importar acentos ni mayúsculas", async () => {
  const propio = await montar("servicio-normalizado");
  try {
    const recurso = await createResource(propio.organizationId, {
      branchId: propio.branchId,
      name: "Box",
      type: "ROOM",
    });
    await createServiceType(propio.organizationId, {
      branchId: propio.branchId,
      resourceId: recurso.id,
      name: "Tasación de usado",
      durationMin: 45,
    });
    const ctx = contextoDe(
      propio.organizationId,
      "00000000-0000-4000-8000-000000000003",
      propio.branchId,
    );
    for (const escrito of ["Tasación de usado", "tasacion de usado", "  TASACIÓN DE USADO  "]) {
      const r = await ejecutar(
        "get_availability",
        { servicio: escrito, desde: "2026-09-28T09:00:00-03:00" },
        ctx,
      );
      assert.equal(r.ok, true, `${escrito}: ${JSON.stringify(r)}`);
    }
  } finally {
    await desmontarConAgenda(propio);
  }
});

test("un servicio que no existe devuelve la lista de los que sí, para corregirse", async () => {
  const propio = await montar("servicio-inexistente");
  try {
    const recurso = await createResource(propio.organizationId, {
      branchId: propio.branchId,
      name: "Vendedor",
      type: "PERSON",
    });
    await createServiceType(propio.organizationId, {
      branchId: propio.branchId,
      resourceId: recurso.id,
      name: "Test drive",
      durationMin: 45,
    });
    const ctx = contextoDe(
      propio.organizationId,
      "00000000-0000-4000-8000-000000000003",
      propio.branchId,
    );
    const r = await ejecutar(
      "create_booking",
      { servicio: "Lavado premium", startsAt: "2026-09-28T10:00:00-03:00" },
      ctx,
    );
    assert.equal(r.ok, false);
    const error = r.ok === false ? r.error : "";
    assert.match(error, /No existe ningún servicio llamado "Lavado premium"/);
    assert.match(error, /"Test drive"/, "tiene que listar los reales para que se corrija");
  } finally {
    await desmontarConAgenda(propio);
  }
});

test("sin nombre ni id, el error dice las dos formas de indicarlo", async () => {
  // Ítem 122: este caso ahora depende del catálogo de la sucursal —con un solo
  // servicio se resuelve solo—, así que hace falta una con varios para que
  // "indicá el servicio" siga siendo la respuesta correcta.
  const sucursal = await sucursalConServicios(["Test drive", "Tasación"]);
  const r = await ejecutar(
    "create_booking",
    { startsAt: "2026-09-28T10:00:00-03:00" },
    contextoDe(a.organizationId, "00000000-0000-4000-8000-000000000003", sucursal.id),
  );
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /servicio.*serviceTypeId/s);
});

// ---------------------------------------------------------------------------
// Ítem 107: la oportunidad se vincula al vehículo y toma su precio
// ---------------------------------------------------------------------------

test("create_opportunity con `vehiculo` vincula la unidad y completa el monto", async () => {
  // El caso real: 4 de 6 oportunidades que creó el agente en producción
  // quedaron en amount 0, después de conversaciones enteras sobre un auto
  // concreto de 38.000 dólares.
  const contacto = await nuevoContacto(a);
  const ctx = contextoDe(a.organizationId, contacto.id, a.branchId);

  const data = await datosDe<{ opportunityId: string; unidad?: string }>(
    "create_opportunity",
    { title: "Interés en Hilux", vehiculo: "Hilux SRV" },
    ctx,
  );

  const guardada = await prisma.opportunity.findUniqueOrThrow({
    where: { id: data.opportunityId },
  });
  assert.equal(Number(guardada.amount), 38_000, "el monto sale del precio de lista");
  assert.equal(guardada.currency, "USD");

  // LA UNIDAD NO SE RESERVA. Vincularla (Opportunity.vehicleId) la pondría en
  // RESERVED y la sacaría del stock para todos los demás; que un agente de IA
  // haga eso porque alguien escribió "me interesa la Hilux" es una decisión
  // del negocio, no del modelo. Este test es el que lo fija.
  assert.equal(guardada.vehicleId, null, "el agente no vincula, y por lo tanto no reserva");
  const unidad = await prisma.vehicle.findUniqueOrThrow({ where: { id: hiluxSrv } });
  assert.equal(unidad.status, "AVAILABLE", "la unidad tiene que seguir disponible");

  // Pero el modelo sí se entera de qué unidad se entendió, para poder
  // mencionarla en su respuesta.
  assert.match(data.unidad ?? "", /Hilux/);
});

test("un monto explícito del modelo GANA sobre el precio de lista", async () => {
  // Ítem 92: registrar lo que el cliente ofreció es correcto; lo que no se
  // puede es presentárselo como aceptado. Acá se verifica que se registre.
  const contacto = await nuevoContacto(a);
  const data = await datosDe<{ opportunityId: string }>(
    "create_opportunity",
    { title: "Contraoferta", vehiculo: "Hilux SRV", amount: 30_000 },
    contextoDe(a.organizationId, contacto.id, a.branchId),
  );
  const guardada = await prisma.opportunity.findUniqueOrThrow({
    where: { id: data.opportunityId },
  });
  assert.equal(Number(guardada.amount), 30_000);
  assert.equal(guardada.vehicleId, null);
});

test("un texto ambiguo pide desambiguar en vez de elegir una unidad", async () => {
  // Hay dos Hilux publicadas: "Hilux" solo no alcanza, y el error dice cuáles
  // son para que el agente le pregunte al cliente.
  const contacto = await nuevoContacto(a);
  const r = await ejecutar(
    "create_opportunity",
    { title: "x", vehiculo: "Hilux" },
    contextoDe(a.organizationId, contacto.id, a.branchId),
  );
  assert.equal(r.ok, false);
  const error = r.ok === false ? r.error : "";
  assert.match(error, /coincide con más de una unidad/);
  assert.match(error, /SRV/);
  assert.match(error, /DX/);
  assert.equal(await prisma.opportunity.count({ where: { contactId: contacto.id } }), 0);
});

test("NO se puede vincular una unidad que el agente no tiene derecho a mencionar", async () => {
  // La garantía: solo se busca entre publicadas y disponibles, el mismo
  // recorte de search_vehicles. Una oportunidad no puede apuntar a una unidad
  // reservada o no publicada.
  const contacto = await nuevoContacto(a);
  const r = await ejecutar(
    "create_opportunity",
    { title: "x", vehiculo: "Corolla Reservada" },
    contextoDe(a.organizationId, contacto.id, a.branchId),
  );
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /No hay ninguna unidad publicada que coincida/);
});

test("update_opportunity con `vehiculo` cambia la unidad y reajusta el monto", async () => {
  const contacto = await nuevoContacto(a);
  const ctx = contextoDe(a.organizationId, contacto.id, a.branchId);
  const creada = await datosDe<{ opportunityId: string }>(
    "create_opportunity",
    { title: "Interés", vehiculo: "Hilux SRV" },
    ctx,
  );

  await datosDe(
    "update_opportunity",
    { opportunityId: creada.opportunityId, vehiculo: "Hilux DX" },
    ctx,
  );

  const guardada = await prisma.opportunity.findUniqueOrThrow({
    where: { id: creada.opportunityId },
  });
  assert.equal(Number(guardada.amount), 27_500, "el monto sigue a la unidad nueva");
  assert.equal(guardada.vehicleId, null);
  // Tampoco al actualizar se reserva nada: las dos unidades siguen libres.
  for (const id of [hiluxSrv, hiluxDx]) {
    const v = await prisma.vehicle.findUniqueOrThrow({ where: { id } });
    assert.equal(v.status, "AVAILABLE", `${id} tiene que seguir disponible`);
  }
});

// ---------------------------------------------------------------------------
// Ítem 112: no hace falta acarrear el opportunityId
// ---------------------------------------------------------------------------

test("update_opportunity SIN opportunityId toma la oportunidad abierta del contacto", async () => {
  // El caso real de producción: el modelo creó la oportunidad, recibió su id y
  // en el turno siguiente mandó otro que se inventó. Ahora no tiene que
  // acarrearlo.
  const contacto = await nuevoContacto(a);
  const ctx = contextoDe(a.organizationId, contacto.id, a.branchId);
  const creada = await datosDe<{ opportunityId: string }>(
    "create_opportunity",
    { title: "Interés en Hilux", vehiculo: "Hilux SRV" },
    ctx,
  );

  const actualizada = await datosDe<{ opportunityId: string }>(
    "update_opportunity",
    { vehiculo: "Hilux DX" },
    ctx,
  );

  assert.equal(actualizada.opportunityId, creada.opportunityId);
  const guardada = await prisma.opportunity.findUniqueOrThrow({
    where: { id: creada.opportunityId },
  });
  assert.equal(Number(guardada.amount), 27_500);
});

test("update_opportunity: un opportunityId inventado dice que se vuelva a llamar sin él", async () => {
  // Antes contestaba "La oportunidad indicada no existe" a secas y el agente
  // le pedía al cliente la marca y el modelo del auto, un dato que ya tenía y
  // que no tenía nada que ver con el error.
  const contacto = await nuevoContacto(a);
  const ctx = contextoDe(a.organizationId, contacto.id, a.branchId);
  await datosDe("create_opportunity", { title: "Interés", vehiculo: "Hilux SRV" }, ctx);

  const r = await ejecutar(
    "update_opportunity",
    { opportunityId: "60155209-679e-4e3e-9097-4b2a65824982", title: "Otro" },
    ctx,
  );

  assert.equal(r.ok, false);
  const error = r.ok === false ? r.error : "";
  assert.match(error, /SIN opportunityId/);
  // Y se marca como error del modelo, para que no se lo cuente al cliente.
  assert.ok(error.endsWith(SUFIJO_ERROR_DE_ARGUMENTOS));
});

test("update_opportunity: el id de OTRO contacto tampoco se toca", async () => {
  // El aislamiento del ítem original sigue firme: que la organización coincida
  // no alcanza.
  const unoCtx = contextoDe(a.organizationId, (await nuevoContacto(a)).id, a.branchId);
  const otro = await nuevoContacto(a);
  const otroCtx = contextoDe(a.organizationId, otro.id, a.branchId);
  const delOtro = await datosDe<{ opportunityId: string }>(
    "create_opportunity",
    { title: "Del otro contacto" },
    otroCtx,
  );

  const r = await ejecutar(
    "update_opportunity",
    { opportunityId: delOtro.opportunityId, title: "Robada" },
    unoCtx,
  );

  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /no pertenece al contacto/);
  const intacta = await prisma.opportunity.findUniqueOrThrow({
    where: { id: delOtro.opportunityId },
  });
  assert.equal(intacta.title, "Del otro contacto");
});

test("create_opportunity que reusa APLICA el auto nuevo en vez de descartarlo", async () => {
  // El caso real: el cliente pasó de la Amarok a la Hilux SRV, el modelo
  // volvió a llamar a create_opportunity y la tool devolvía ok con la
  // oportunidad de la Amarok intacta. El agente le dijo al cliente "ya
  // registré tu interés por la Hilux" y no había registrado nada.
  const contacto = await nuevoContacto(a);
  const ctx = contextoDe(a.organizationId, contacto.id, a.branchId);
  const primera = await datosDe<{ opportunityId: string }>(
    "create_opportunity",
    { title: "Interés en Hilux SRV", vehiculo: "Hilux SRV" },
    ctx,
  );

  const segunda = await datosDe<{
    opportunityId: string;
    title: string;
    amount: string;
    reused: boolean;
    actualizada: boolean;
    unidad: string;
  }>("create_opportunity", { title: "Interés en Hilux DX", vehiculo: "Hilux DX" }, ctx);

  // Sigue siendo una sola oportunidad abierta (ítem 84)...
  assert.equal(segunda.opportunityId, primera.opportunityId);
  assert.equal(segunda.reused, true);
  // ...pero ahora refleja lo que el cliente pidió, y el resultado lo dice.
  assert.equal(segunda.actualizada, true);
  assert.equal(segunda.title, "Interés en Hilux DX");
  assert.equal(Number(segunda.amount), 27_500);
  assert.match(segunda.unidad, /Hilux DX/);

  const guardada = await prisma.opportunity.findUniqueOrThrow({
    where: { id: primera.opportunityId },
  });
  assert.equal(Number(guardada.amount), 27_500);
  // Y el ítem 107 sigue firme: leer el precio no reserva la unidad.
  assert.equal(guardada.vehicleId, null);
});

test("create_opportunity que reusa SIN vehículo no toca nada, y lo dice", async () => {
  // El reuso de siempre no cambia: devuelve lo que hay. Lo que cambia es que
  // ahora el resultado distingue los dos casos con `actualizada`, para que el
  // modelo no le anuncie al cliente algo que no pasó.
  const contacto = await nuevoContacto(a);
  const ctx = contextoDe(a.organizationId, contacto.id, a.branchId);
  await datosDe(
    "create_opportunity",
    { title: "Interés en Hilux SRV", vehiculo: "Hilux SRV" },
    ctx,
  );

  const segunda = await datosDe<{ title: string; amount: string; actualizada: boolean }>(
    "create_opportunity",
    { title: "Otra consulta" },
    ctx,
  );

  assert.equal(segunda.actualizada, false);
  assert.equal(segunda.title, "Interés en Hilux SRV", "el título viejo no se pisa");
  assert.equal(Number(segunda.amount), 38_000);
});

test("update_opportunity sin ninguna oportunidad abierta guía a create_opportunity", async () => {
  // No es un error de argumentos: es un estado legítimo del negocio, y el
  // modelo tiene que saber qué hacer con él en vez de improvisar.
  const contacto = await nuevoContacto(a);
  const ctx = contextoDe(a.organizationId, contacto.id, a.branchId);

  const r = await datosDe<{
    opportunityId: string | null;
    sinResultados: boolean;
    queHacer: string;
  }>("update_opportunity", { title: "Algo" }, ctx);

  assert.equal(r.opportunityId, null);
  assert.equal(r.sinResultados, true);
  assert.match(r.queHacer, /create_opportunity/);
});

// ---------------------------------------------------------------------------
// Ítem 121: el aviso de presupuesto que viaja en el resultado de la búsqueda.
//
// Medido contra el modelo real antes de existir: 0 de 12 presupuestos dichos
// sueltos («tengo hasta 20 mil») quedaban guardados, porque el número entraba
// en priceMaxUsd, contestaba la consulta y se iba. Con el aviso: 12 de 12.
//
// Lo que se prueba acá es CUÁNDO aparece y cuándo no, que es lo que decide si
// el modelo aprende a mirarlo o a ignorarlo: un aviso que salta cuando no
// corresponde se vuelve ruido, y el ruido se ignora.
// ---------------------------------------------------------------------------

test("search_vehicles con tope de precio y contacto SIN presupuesto: avisa que lo guarde (ítem 121)", async () => {
  const contacto = await nuevoContacto(stock);
  const data = await datosDe<{ total: number; recordatorioDePresupuesto?: string }>(
    "search_vehicles",
    { priceMaxUsd: 30_000 },
    contextoDe(stock.organizationId, contacto.id, stock.branchId),
  );

  assert.ok(data.total > 0);
  assert.match(data.recordatorioDePresupuesto ?? "", /NO tiene presupuesto guardado/);
  assert.match(data.recordatorioDePresupuesto ?? "", /update_lead/);
  // Que el cliente no se entere: el aviso es entre el backend y el modelo.
  assert.match(data.recordatorioDePresupuesto ?? "", /no le preguntes ni le avises/);
});

test("search_vehicles con tope de precio y contacto CON presupuesto: no avisa nada (ítem 121)", async () => {
  // El aviso se apaga solo. Si siguiera saltando con el dato ya cargado, el
  // modelo llamaría a update_lead de gusto en cada búsqueda de la charla.
  const contacto = await nuevoContacto(stock);
  await prisma.contact.update({
    where: { id: contacto.id },
    data: { leadBudgetAmount: 30_000, leadBudgetCurrency: "USD" },
  });

  const data = await datosDe<{ recordatorioDePresupuesto?: string }>(
    "search_vehicles",
    { priceMaxUsd: 30_000 },
    contextoDe(stock.organizationId, contacto.id, stock.branchId),
  );

  assert.equal(data.recordatorioDePresupuesto, undefined);
});

test("search_vehicles SIN tope de precio: no avisa aunque falte el presupuesto (ítem 121)", async () => {
  // priceMinUsd es el piso de lo que quiere mirar, no el techo de lo que puede
  // gastar: «algo de más de 20 mil» no es un presupuesto y no se guarda.
  const contacto = await nuevoContacto(stock);
  const data = await datosDe<{ recordatorioDePresupuesto?: string }>(
    "search_vehicles",
    { priceMinUsd: 20_000, make: "Toyota" },
    contextoDe(stock.organizationId, contacto.id, stock.branchId),
  );

  assert.equal(data.recordatorioDePresupuesto, undefined);
});

test("search_vehicles sin resultados igual avisa: es el lead al que hay que llamar (ítem 121)", async () => {
  // El caso que más importa. El cliente dijo cuánto tenía, no hay nada en ese
  // rango, y es exactamente el lead que el vendedor tiene que poder buscar
  // cuando entre una unidad que le sirva — si el número no quedó, no existe.
  const contacto = await nuevoContacto(stock);
  const data = await datosDe<{
    total: number;
    sinResultados: boolean;
    queHacer: string;
    recordatorioDePresupuesto?: string;
  }>(
    "search_vehicles",
    { priceMaxUsd: 1, make: "Ferrari" },
    contextoDe(stock.organizationId, contacto.id, stock.branchId),
  );

  assert.equal(data.total, 0);
  assert.equal(data.sinResultados, true);
  assert.match(data.queHacer, /NO inventes/, "el vacío explícito del ítem 91 sigue estando");
  assert.match(data.recordatorioDePresupuesto ?? "", /NO tiene presupuesto guardado/);
});

// ---------------------------------------------------------------------------
// Ítem 122: sin servicio indicado, la falla tiene que dejar al modelo en
// condiciones de seguir solo. Antes decía "hay que indicar el servicio" y
// nada más: el modelo no tenía entre qué elegir y le trasladaba la pregunta
// al cliente, que había venido a preguntar cuándo podía ir.
//
//   👤 ¿Tenés lugar el viernes para ver un auto?
//   🤖 Para poder ver los horarios, ¿a qué servicio te referís?
// ---------------------------------------------------------------------------

async function sucursalConServicios(nombres: string[]) {
  const sucursal = await createBranch(a.organizationId, {
    name: `Agenda ${nombres.length} (${Date.now()})`,
    timezone: TZ,
  });
  const recurso = await createResource(a.organizationId, {
    branchId: sucursal.id,
    name: "Box",
    type: "ROOM",
  });
  for (const name of nombres) {
    await createServiceType(a.organizationId, {
      branchId: sucursal.id,
      resourceId: recurso.id,
      name,
      durationMin: 45,
    });
  }
  return sucursal;
}

test("get_availability sin servicio y con UNO solo configurado: lo resuelve solo (ítem 122)", async () => {
  // No hay nada que elegir, así que no hay nada que preguntar. El modelo no
  // tiene que acarrear un nombre ni un id para mirar la agenda.
  const sucursal = await sucursalConServicios(["Test drive"]);
  const r = await ejecutar(
    "get_availability",
    { desde: "2026-09-28T09:00:00-03:00" },
    contextoDe(a.organizationId, "00000000-0000-4000-8000-000000000003", sucursal.id),
  );

  assert.equal(r.ok, true, JSON.stringify(r));
});

test("get_availability sin servicio y con VARIOS: la falla lleva los nombres reales (ítem 122)", async () => {
  const sucursal = await sucursalConServicios(["Test drive", "Visita al salón", "Tasación"]);
  const r = await ejecutar(
    "get_availability",
    { desde: "2026-09-28T09:00:00-03:00" },
    contextoDe(a.organizationId, "00000000-0000-4000-8000-000000000003", sucursal.id),
  );

  assert.equal(r.ok, false);
  const error = (r as { ok: false; error: string }).error;
  // Los tres, para que el modelo elija sin adivinar.
  assert.match(error, /Test drive/);
  assert.match(error, /Visita al salón/);
  assert.match(error, /Tasación/);
  // Y la instrucción puntual: si tiene que preguntar, que los nombre.
  assert.match(error, /NOMBRÁNDOLE/);
});

test("create_booking sin servicio y con UNO solo: tampoco hace falta nombrarlo (ítem 122)", async () => {
  // Misma resolución para las dos tools de agenda: si hubiera quedado solo en
  // get_availability, el modelo miraría la agenda sin problema y se trabaría
  // justo al reservar, que es el turno que cuesta plata.
  const sucursal = await sucursalConServicios(["Test drive"]);
  const contacto = await nuevoContacto(a);
  const r = await ejecutar(
    "create_booking",
    { startsAt: "2026-09-28T10:00:00-03:00" },
    contextoDe(a.organizationId, contacto.id, sucursal.id),
  );

  // Puede fallar por la agenda (fuera de horario, ocupado), pero NUNCA por no
  // saber qué servicio es.
  if (!r.ok) {
    assert.doesNotMatch(r.error, /Hay que indicar el servicio/);
  }
});

test("sucursal sin ningún servicio configurado: lo dice, no pide que se lo indiquen (ítem 122)", async () => {
  const sucursal = await sucursalConServicios([]);
  const r = await ejecutar(
    "get_availability",
    { desde: "2026-09-28T09:00:00-03:00" },
    contextoDe(a.organizationId, "00000000-0000-4000-8000-000000000003", sucursal.id),
  );

  assert.equal(r.ok, false);
  assert.match((r as { ok: false; error: string }).error, /no tiene ningún servicio configurado/);
});

// ---------------------------------------------------------------------------
// Ítem 123: el precio de una unidad "a consultar" no sale por el canal público
//
// La fila tiene el precio cargado; el negocio decidió no publicarlo. Había
// tres formas de que se escapara igual, y las tres se cierran acá:
//
//   1. El resultado lo mandaba tal cual, junto con `priceOnRequest: true`.
//   2. El rango de precio se le aplicaba, así que preguntando por rangos se
//      acotaba el número hasta dar con él.
//   3. El orden por precio la ubicaba entre las demás, y su POSICIÓN en la
//      lista decía casi lo mismo que el número.
// ---------------------------------------------------------------------------

test("search_vehicles no manda el precio de una unidad a consultar (ítem 123)", async () => {
  const propio = await montar("agent-123-precio-oculto");
  try {
    const oculta = await unidad(propio, { priceOnRequest: true, priceListUsd: 25_000 });
    const data = await datosDe<ResultadoBusqueda>(
      "search_vehicles",
      {},
      contextoDe(propio.organizationId, "00000000-0000-4000-8000-000000000003", propio.branchId),
    );

    const fila = data.vehiculos.find((v) => v.id === oculta.id);
    assert.ok(fila, "la unidad tiene que seguir apareciendo: lo que no sale es el precio");
    assert.equal(fila.priceListUsd, null);
    assert.equal(fila.priceListLocal, null);
    assert.equal(fila.priceOnRequest, true, "y el modelo tiene que saber POR QUÉ no hay precio");
  } finally {
    await desmontar(propio);
  }
});

test("el rango de precio no sirve para averiguar cuánto sale una a consultar (ítem 123)", async () => {
  // El oráculo concreto que midió la sonda de la matriz: con priceMaxUsd 24000
  // no aparecía y con 26000 sí, para una unidad de 25.000. Ahora aparece en
  // los dos, así que su presencia no dice nada.
  const propio = await montar("agent-123-oraculo");
  try {
    const oculta = await unidad(propio, { priceOnRequest: true, priceListUsd: 25_000 });
    const ctx = contextoDe(
      propio.organizationId,
      "00000000-0000-4000-8000-000000000003",
      propio.branchId,
    );

    for (const tope of [24_000, 26_000, 1]) {
      const data = await datosDe<ResultadoBusqueda>("search_vehicles", { priceMaxUsd: tope }, ctx);
      assert.ok(
        data.vehiculos.some((v) => v.id === oculta.id),
        `con priceMaxUsd ${tope} tendría que seguir apareciendo`,
      );
    }
    // Y por abajo, lo mismo.
    const data = await datosDe<ResultadoBusqueda>("search_vehicles", { priceMinUsd: 999_999 }, ctx);
    assert.ok(data.vehiculos.some((v) => v.id === oculta.id));
  } finally {
    await desmontar(propio);
  }
});

test("las unidades a consultar van al final, no intercaladas por su precio (ítem 123)", async () => {
  // Si quedaran en el medio, la posición delata el precio igual que el rango.
  const propio = await montar("agent-123-orden");
  try {
    const barata = await unidad(propio, { priceListUsd: 9_000 });
    const oculta = await unidad(propio, { priceOnRequest: true, priceListUsd: 10_000 });
    const cara = await unidad(propio, { priceListUsd: 40_000 });

    const data = await datosDe<ResultadoBusqueda>(
      "search_vehicles",
      {},
      contextoDe(propio.organizationId, "00000000-0000-4000-8000-000000000003", propio.branchId),
    );

    // Por precio real iría segunda (10.000 entre 9.000 y 40.000). Va última.
    assert.deepEqual(
      data.vehiculos.map((v) => v.id),
      [barata.id, cara.id, oculta.id],
    );
  } finally {
    await desmontar(propio);
  }
});

test("en el panel el rango SÍ alcanza a las unidades a consultar (ítem 123)", async () => {
  // La contraparte, y la razón de que la bandera sea opcional: el vendedor que
  // filtra por precio en el listado interno tiene que ver esa unidad, porque
  // para él el precio no es un secreto. El resguardo es del canal público.
  const propio = await montar("agent-123-panel");
  try {
    const oculta = await unidad(propio, { priceOnRequest: true, priceListUsd: 25_000 });

    const dentro = await findManyVehicles(
      propio.organizationId,
      { maxPriceUsd: 26_000 },
      { skip: 0, take: 10 },
      { sortBy: "priceListUsd", sortOrder: "asc" },
    );
    assert.ok(dentro.some((v) => v.id === oculta.id));

    const fuera = await findManyVehicles(
      propio.organizationId,
      { maxPriceUsd: 24_000 },
      { skip: 0, take: 10 },
      { sortBy: "priceListUsd", sortOrder: "asc" },
    );
    assert.ok(!fuera.some((v) => v.id === oculta.id), "sin la bandera, el rango filtra como antes");
  } finally {
    await desmontar(propio);
  }
});

// ---------------------------------------------------------------------------
// Ítem 124: lo que el agente heredó de las reglas nuevas del CRM (matriz, 154)
// ---------------------------------------------------------------------------

test("create_opportunity se para en la primera etapa ABIERTA, no en la primera (ítem 124)", async () => {
  // Un pipeline cuyo negocio puso "Ganado" arriba de todo. Antes nacía una
  // oportunidad OPEN parada en una etapa de cierre —incoherente— y desde el
  // ítem 154 de la matriz eso da 400 que se le termina notando al cliente.
  const propio = await montar("agent-124-etapa");
  try {
    const pipeline = await createPipeline(propio.organizationId, {
      name: "Al revés",
      isDefault: true,
    });
    const ganado = await createStage(propio.organizationId, {
      pipelineId: pipeline.id,
      name: "Ganado",
      order: 1,
      isWon: true,
    });
    const nuevo = await createStage(propio.organizationId, {
      pipelineId: pipeline.id,
      name: "Nuevo",
      order: 2,
    });
    const contacto = await prisma.contact.create({
      data: {
        organizationId: propio.organizationId,
        firstName: "Ana",
        lastName: "Etapa",
        ownerId: propio.userId,
      },
    });

    const data = await datosDe<{ opportunityId: string; stage: string }>(
      "create_opportunity",
      { title: "Interés en Hilux" },
      contextoDe(propio.organizationId, contacto.id, propio.branchId),
    );

    assert.equal(data.stage, "Nuevo", "tiene que saltear la etapa de cierre");
    const guardada = await prisma.opportunity.findUniqueOrThrow({
      where: { id: data.opportunityId },
    });
    assert.equal(guardada.stageId, nuevo.id);
    assert.notEqual(guardada.stageId, ganado.id);
    assert.equal(guardada.status, "OPEN", "y nacer abierta, que es lo que de verdad es");
  } finally {
    await prisma.opportunity.deleteMany({ where: { organizationId: propio.organizationId } });
    await prisma.contact.deleteMany({ where: { organizationId: propio.organizationId } });
    await prisma.stage.deleteMany({ where: { organizationId: propio.organizationId } });
    await prisma.pipeline.deleteMany({ where: { organizationId: propio.organizationId } });
    await desmontar(propio);
  }
});

test("update_opportunity: ganar descarta el motivo de pérdida y lo avisa (ítem 124)", async () => {
  // El modelo manda WON y de paso arrastra un lostReason —porque lo leyó del
  // estado anterior, o porque se lo inventó—. Las reglas del CRM ya dicen que
  // una ganada no lleva motivo, así que esto no es una contradicción que haya
  // que rechazar con un 400 en la cara del cliente: se descarta el campo, se
  // aplica el resto, y se le avisa al modelo que se descartó para que no le
  // diga al cliente que quedó anotado algo que no quedó (ítem 100).
  const contacto = await nuevoContacto(a);
  const ctx = contextoDe(a.organizationId, contacto.id, a.branchId);

  await datosDe<{ opportunityId: string }>("create_opportunity", { title: "Hilux" }, ctx);

  const r = await datosDe<{
    status: string;
    lostReason: string | null;
    noSeAplico?: string[];
    queHacer?: string;
  }>("update_opportunity", { status: "WON", lostReason: "Se fue a la competencia" }, ctx);

  assert.equal(r.status, "WON", "el cambio que importaba se aplicó igual");
  assert.equal(r.lostReason, null);
  assert.deepEqual(r.noSeAplico, ["lostReason"]);
  assert.match(r.queHacer ?? "", /No le digas al cliente que anotaste un motivo/);
});

test("una oportunidad PERDIDA ya no la ve update_opportunity (ítem 124)", async () => {
  // Fija el límite real, que es más grande que el 400 que veníamos a arreglar:
  // resolverOportunidad busca solo ABIERTAS, así que el cliente que dijo que no
  // y después vuelve a comprar NO puede reabrir la suya — el agente va a crear
  // una segunda. Si eso está bien o no es decisión de producto (muchos CRMs
  // abren una oportunidad nueva a propósito), y por eso acá se documenta en vez
  // de decidirse.
  const contacto = await nuevoContacto(a);
  const ctx = contextoDe(a.organizationId, contacto.id, a.branchId);

  await datosDe("create_opportunity", { title: "Ranger" }, ctx);
  await datosDe("update_opportunity", { status: "LOST", lostReason: "Precio" }, ctx);

  const r = await datosDe<{ opportunityId: string | null; sinResultados: boolean }>(
    "update_opportunity",
    { status: "WON" },
    ctx,
  );
  assert.equal(r.opportunityId, null);
  assert.equal(r.sinResultados, true);
});

test("update_opportunity: perder SÍ guarda el motivo (ítem 124)", async () => {
  // La contraparte, para que el descarte no se coma el caso legítimo.
  const contacto = await nuevoContacto(a);
  const ctx = contextoDe(a.organizationId, contacto.id, a.branchId);

  await datosDe("create_opportunity", { title: "Amarok" }, ctx);
  const r = await datosDe<{ status: string; lostReason: string | null; noSeAplico?: string[] }>(
    "update_opportunity",
    { status: "LOST", lostReason: "Precio" },
    ctx,
  );

  assert.equal(r.status, "LOST");
  assert.equal(r.lostReason, "Precio");
  assert.equal(r.noSeAplico, undefined);
});
