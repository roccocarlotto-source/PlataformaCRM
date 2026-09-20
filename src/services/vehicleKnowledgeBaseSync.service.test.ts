import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma, type Vehicle } from "@prisma/client";
import {
  construirContenidoDeVehiculo,
  construirTituloDeVehiculo,
} from "./vehicleKnowledgeBaseSync.service";

// ---------------------------------------------------------------------------
// El texto que la sincronización de stock (§70) escribe en una entrada de la
// base de conocimiento. Unitario y sin base: construirContenidoDeVehiculo y
// construirTituloDeVehiculo son funciones puras sobre una fila de Vehicle, y
// ESO ES LO QUE LAS HACE PROBABLES ASÍ — el test de la allowlist puede armar
// una unidad con todos los campos internos cargados sin pelearse con ningún
// CHECK de la base.
//
// Lo que corre contra Postgres de verdad —qué se crea, qué se actualiza, qué
// se da de baja— está en vehicleKnowledgeBaseSync.integration-test.ts.
// ---------------------------------------------------------------------------

// Una fila de Vehicle completa, con TODOS los campos en su valor "vacío"
// salvo los cinco NOT NULL sin default. Cada caso enciende solo lo que mira.
function vehiculo(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    organizationId: "org-1",
    internalCode: "STK-000123",
    condition: "USED",
    licensePlate: null,
    vin: null,
    engineNumber: null,
    bodyType: null,
    make: "Toyota",
    model: "Corolla",
    trim: null,
    year: 2022,
    priceListUsd: null,
    priceListLocal: null,
    minAcceptablePriceUsd: null,
    acquisitionCostUsd: null,
    status: "AVAILABLE",
    visibleInListing: true,
    origin: null,
    stockEnteredAt: null,
    publicationCurrency: "BOTH",
    acceptsTradeIn: false,
    financingAvailable: false,
    priceOnRequest: false,
    tradeInOpportunityId: null,
    consignorName: null,
    consignorDocument: null,
    consignorPhone: null,
    consignorEmail: null,
    consignmentAgreedPriceUsd: null,
    consignmentCommissionPercent: null,
    consignmentAgreementExpiresAt: null,
    consignmentContractNumber: null,
    mileage: null,
    transmission: null,
    fuelType: null,
    exteriorColor: null,
    colorFinish: null,
    cylinderCapacityLiters: null,
    drivetrain: null,
    doors: null,
    upholstery: null,
    powerHp: null,
    seats: null,
    declaredConsumptionKmL: null,
    equipment: [],
    warranty: null,
    warrantyOther: null,
    licensePlateDebtLocal: null,
    lastTechnicalInspectionAt: null,
    titleHolder: null,
    singleOwner: false,
    officialServiceUpToDate: false,
    hasManualAndSpareKey: false,
    titleReportRequested: false,
    branchId: "22222222-2222-2222-2222-222222222222",
    assignedSalespersonId: null,
    physicalLocation: null,
    availableSince: null,
    videoUrl: null,
    tour360Url: null,
    publishOnWebsite: true,
    publishOnPortals: false,
    featuredOnHomepage: false,
    publicDescription: null,
    internalNotes: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// EL TEST QUE NO SE NEGOCIA: la allowlist.
//
// Arma una unidad con TODOS los campos que nunca pueden salir cargados con
// valores reconocibles, y afirma que ninguno aparece como substring del
// contenido generado. No mira rótulos —un rótulo se puede renombrar— sino los
// VALORES: si alguien vuelca un campo nuevo "por costumbre", el valor aparece
// y esto falla.
// ---------------------------------------------------------------------------
test("el contenido NUNCA incluye ningún campo interno, por más cargado que esté", () => {
  const prohibidos = {
    licensePlate: "SAB1234",
    vin: "9BRZZZTIPOVIN0001",
    engineNumber: "MOTOR-XYZ-99",
    minAcceptablePriceUsd: new Prisma.Decimal("19500.00"),
    acquisitionCostUsd: new Prisma.Decimal("17250.00"),
    consignorName: "Marta Rodríguez",
    consignorDocument: "4.567.890-1",
    consignorPhone: "+59899123456",
    consignorEmail: "marta.rodriguez@example.test",
    consignmentAgreedPriceUsd: new Prisma.Decimal("23400.00"),
    consignmentCommissionPercent: new Prisma.Decimal("7.50"),
    consignmentContractNumber: "CONS-2026-0042",
    licensePlateDebtLocal: new Prisma.Decimal("18300.00"),
    titleHolder: "Marta Rodríguez",
    internalNotes: "Tiene un golpe en el paragolpes, bajarlo 800 si insisten.",
    assignedSalespersonId: "33333333-3333-3333-3333-333333333333",
    tradeInOpportunityId: "44444444-4444-4444-4444-444444444444",
    origin: "CONSIGNMENT" as const,
    titleReportRequested: true,
    consignmentAgreementExpiresAt: new Date("2026-12-31T00:00:00.000Z"),
    lastTechnicalInspectionAt: new Date("2026-03-15T00:00:00.000Z"),
  };

  const contenido = construirContenidoDeVehiculo(
    vehiculo({
      ...prohibidos,
      // Con datos permitidos cargados además, para que el contenido no sea
      // trivialmente corto y el test no pase "porque no hay texto".
      priceListUsd: new Prisma.Decimal("24900.00"),
      mileage: 45_000,
      publicDescription: "Impecable, service al día, único dueño.",
    }),
  );

  const valores = [
    prohibidos.licensePlate,
    prohibidos.vin,
    prohibidos.engineNumber,
    "19500",
    "19.500",
    "17250",
    "17.250",
    prohibidos.consignorName,
    prohibidos.consignorDocument,
    prohibidos.consignorPhone,
    prohibidos.consignorEmail,
    "23400",
    "23.400",
    "7,5",
    prohibidos.consignmentContractNumber,
    "18300",
    "18.300",
    prohibidos.internalNotes,
    prohibidos.assignedSalespersonId,
    prohibidos.tradeInOpportunityId,
    "Consignación",
    "CONSIGNMENT",
    "2026-12-31",
    "2026-03-15",
  ];

  for (const valor of valores) {
    assert.ok(
      !contenido.includes(valor),
      `el contenido generado no puede contener "${valor}". Contenido:\n${contenido}`,
    );
  }

  // Y no es que no haya salido nada: lo permitido sí está.
  assert.match(contenido, /STK-000123/);
  assert.match(contenido, /45\.000 km/);
});

test("escribe los campos permitidos con los enums en castellano", () => {
  const contenido = construirContenidoDeVehiculo(
    vehiculo({
      condition: "USED",
      bodyType: "WAGON",
      trim: "XEI",
      mileage: 45_000,
      transmission: "AUTOMATIC_SEQUENTIAL",
      fuelType: "GASOLINE_CNG",
      exteriorColor: "Gris plata",
      colorFinish: "METALLIC",
      cylinderCapacityLiters: new Prisma.Decimal("1.60"),
      drivetrain: "AWD",
      doors: 5,
      upholstery: "Cuero",
      powerHp: 140,
      seats: 5,
      declaredConsumptionKmL: new Prisma.Decimal("15.50"),
      warranty: "DEALER_12M",
      physicalLocation: "Playa 2",
    }),
  );

  // Los mismos textos que muestra la pantalla
  // (frontend/src/features/vehicle/labels.ts), no unos inventados acá.
  assert.match(contenido, /^Código interno: STK-000123$/m);
  assert.match(contenido, /^Condición: Usado$/m);
  assert.match(contenido, /^Marca: Toyota$/m);
  assert.match(contenido, /^Modelo: Corolla$/m);
  assert.match(contenido, /^Versión: XEI$/m);
  assert.match(contenido, /^Año: 2022$/m);
  assert.match(contenido, /^Carrocería: Rural$/m);
  assert.match(contenido, /^Kilometraje: 45\.000 km$/m);
  assert.match(contenido, /^Transmisión: Automática secuencial$/m);
  assert.match(contenido, /^Combustible: Nafta \/ GNC$/m);
  assert.match(contenido, /^Cilindrada: 1,6 L$/m);
  assert.match(contenido, /^Tracción: Integral \(AWD\)$/m);
  assert.match(contenido, /^Potencia: 140 HP$/m);
  assert.match(contenido, /^Puertas: 5$/m);
  assert.match(contenido, /^Plazas: 5$/m);
  assert.match(contenido, /^Consumo declarado: 15,5 km\/L$/m);
  assert.match(contenido, /^Color exterior: Gris plata$/m);
  assert.match(contenido, /^Terminación del color: Metalizado$/m);
  assert.match(contenido, /^Tapizado: Cuero$/m);
  assert.match(contenido, /^Garantía: Del concesionario, 12 meses$/m);
  assert.match(contenido, /^Ubicación: Playa 2$/m);
});

test("el kilometraje solo sale en un usado: un 0 km no lo publica", () => {
  const usado = construirContenidoDeVehiculo(vehiculo({ condition: "USED", mileage: 12 }));
  assert.match(usado, /^Kilometraje: 12 km$/m);

  // Un 0 km con kilometraje cargado (traslados entre sucursales) no lo
  // publica: "0 km" leído como dato confunde más de lo que informa.
  const nuevo = construirContenidoDeVehiculo(vehiculo({ condition: "NEW", mileage: 12 }));
  assert.ok(!nuevo.includes("Kilometraje"));
  assert.match(nuevo, /^Condición: Nuevo$/m);
});

test("el detalle de la garantía solo sale con OTHER", () => {
  const otra = construirContenidoDeVehiculo(
    vehiculo({ warranty: "OTHER", warrantyOther: "Del importador, 90 días" }),
  );
  assert.match(otra, /^Garantía: Otra$/m);
  assert.match(otra, /^Detalle de la garantía: Del importador, 90 días$/m);

  // Un resto de dato viejo en warrantyOther con otro enum no se publica.
  const fabrica = construirContenidoDeVehiculo(
    vehiculo({ warranty: "FACTORY", warrantyOther: "Del importador, 90 días" }),
  );
  assert.match(fabrica, /^Garantía: De fábrica$/m);
  assert.ok(!fabrica.includes("Del importador"));
});

test("los booleanos solo se escriben cuando son true", () => {
  const sin = construirContenidoDeVehiculo(vehiculo());
  for (const rotulo of [
    "Único dueño",
    "Service oficial al día",
    "Manual y llave de repuesto",
    "Acepta permuta",
    "Financiación disponible",
  ]) {
    assert.ok(!sin.includes(rotulo), `"${rotulo}" no debería aparecer con el booleano en false`);
  }
  // Y en particular NO aparece la negación: "no marcada" es "no se afirma".
  assert.ok(!sin.includes(": No"));

  const con = construirContenidoDeVehiculo(
    vehiculo({
      singleOwner: true,
      officialServiceUpToDate: true,
      hasManualAndSpareKey: true,
      acceptsTradeIn: true,
      financingAvailable: true,
    }),
  );
  assert.match(con, /^Único dueño: Sí$/m);
  assert.match(con, /^Service oficial al día: Sí$/m);
  assert.match(con, /^Manual y llave de repuesto: Sí$/m);
  assert.match(con, /^Acepta permuta: Sí$/m);
  assert.match(con, /^Financiación disponible: Sí$/m);
});

test("'consultar precio' gana sobre cualquier número cargado", () => {
  const contenido = construirContenidoDeVehiculo(
    vehiculo({
      priceOnRequest: true,
      priceListUsd: new Prisma.Decimal("24900.00"),
      priceListLocal: new Prisma.Decimal("980000.00"),
    }),
  );

  assert.match(contenido, /^Precio: a consultar/m);
  assert.ok(!contenido.includes("24.900"));
  assert.ok(!contenido.includes("980.000"));
});

test("la moneda de publicación decide qué precio se publica", () => {
  const precios = {
    priceListUsd: new Prisma.Decimal("24900.00"),
    priceListLocal: new Prisma.Decimal("980000.00"),
  };

  const ambas = construirContenidoDeVehiculo(vehiculo({ ...precios, publicationCurrency: "BOTH" }));
  assert.match(ambas, /^Precio de lista en USD: 24\.900$/m);
  assert.match(ambas, /^Precio de lista en moneda local: 980\.000$/m);
  assert.match(ambas, /^Se publica en: USD y moneda local$/m);

  const soloUsd = construirContenidoDeVehiculo(
    vehiculo({ ...precios, publicationCurrency: "USD_ONLY" }),
  );
  assert.match(soloUsd, /^Precio de lista en USD: 24\.900$/m);
  assert.ok(!soloUsd.includes("980.000"));

  const soloLocal = construirContenidoDeVehiculo(
    vehiculo({ ...precios, publicationCurrency: "LOCAL_ONLY" }),
  );
  assert.match(soloLocal, /^Precio de lista en moneda local: 980\.000$/m);
  assert.ok(!soloLocal.includes("24.900"));
});

test("el equipamiento se publica sin la normalización con la que se guarda", () => {
  const contenido = construirContenidoDeVehiculo(
    vehiculo({ equipment: ["AIRE_ACONDICIONADO", "ABS", "CAMARA_DE_RETROCESO"] }),
  );
  assert.match(contenido, /^Equipamiento: AIRE ACONDICIONADO, ABS, CAMARA DE RETROCESO$/m);

  // Sin equipamiento el rótulo no aparece, como cualquier otro campo vacío.
  assert.ok(!construirContenidoDeVehiculo(vehiculo()).includes("Equipamiento"));
});

test("la descripción pública va al final, separada de la ficha", () => {
  const contenido = construirContenidoDeVehiculo(
    vehiculo({ publicDescription: "  Impecable, service al día.  " }),
  );
  assert.ok(contenido.endsWith("Descripción:\nImpecable, service al día."));
  // Trimeada, y por delante la ficha.
  assert.ok(contenido.startsWith("Código interno: STK-000123"));
});

test("el contenido se recorta al tope de 10.000 caracteres de una entrada", () => {
  const contenido = construirContenidoDeVehiculo(
    vehiculo({ publicDescription: "x".repeat(10_000) }),
  );

  assert.equal(contenido.length, 10_000);
  assert.ok(contenido.endsWith("…"));
  // Lo que se pierde es la cola de la descripción, no la ficha técnica: por
  // eso la descripción va última.
  assert.match(contenido, /^Código interno: STK-000123$/m);
});

test("el título lleva el prefijo, la unidad y el código interno", () => {
  assert.equal(construirTituloDeVehiculo(vehiculo()), "Stock: Toyota Corolla 2022 — STK-000123");
});

test("un título larguísimo se recorta al VarChar(200) de la columna", () => {
  const titulo = construirTituloDeVehiculo(
    vehiculo({ make: "M".repeat(100), model: "O".repeat(100) }),
  );
  assert.equal(titulo.length, 200);
  assert.ok(titulo.startsWith("Stock: MMM"));
});
