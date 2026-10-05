import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import {
  CATALOGO_DE_TOOLS,
  NOTA_VEHICULO_DE_INTERES,
  NOTA_VEHICULO_DE_UNA_PERSONA,
  type ContextoDeEjecucionDeTool,
  type ResultadoDeTool,
} from "./agentTools.service";
import { VEHICULO_DE_INTERES_INVALIDO, getContactById, updateContact } from "./contact.service";
import { borrador, capturar, desmontar, montar, type Escenario } from "./vehicle.test-helper";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// Vehículo de interés en el contacto (F2), contra Postgres real:
//   1. El agente lo anota con create_lead/update_lead (por texto, entre las
//      unidades publicadas y disponibles), sin reservar la unidad.
//   2. La regla con las personas: el agente cambia el que cargó él, nunca el
//      de una persona; guardar el contacto sin tocar el campo no cambia quién
//      lo cargó.
//   3. Una persona lo carga, lo cambia y lo quita; solo unidades del stock de
//      su organización.
//   4. La ficha lo sigue mostrando aunque la unidad se venda o se dé de baja.
// ---------------------------------------------------------------------------

let a: Escenario;
let b: Escenario;
let hiluxSrv: string;
let hiluxDx: string;
let deOtraOrg: string;

async function unidad(e: Escenario, datos: Parameters<typeof borrador>[1]) {
  const v = await borrador(e, datos);
  return prisma.vehicle.update({
    where: { id: v.id },
    data: { publishOnWebsite: true, status: "AVAILABLE" },
  });
}

before(async () => {
  a = await montar("interes");
  b = await montar("interes-b");
  hiluxSrv = (await unidad(a, { make: "Toyota", model: "Hilux", trim: "SRV", year: 2022 })).id;
  hiluxDx = (await unidad(a, { make: "Toyota", model: "Hilux", trim: "DX", year: 2019 })).id;
  deOtraOrg = (await unidad(b, { make: "Ford", model: "Ranger", year: 2021 })).id;
});

after(async () => {
  for (const e of [a, b]) {
    if (!e) continue;
    await prisma.contact.deleteMany({ where: { organizationId: e.organizationId } });
  }
  await desmontar(a, b);
});

function nuevoContacto() {
  return prisma.contact.create({
    data: {
      organizationId: a.organizationId,
      firstName: "Ana",
      lastName: "Pérez",
      ownerId: a.userId,
    },
  });
}

function contextoDe(contactId: string): ContextoDeEjecucionDeTool {
  return {
    organizationId: a.organizationId,
    conversation: {
      id: "00000000-0000-4000-8000-000000000002",
      contactId,
      branchId: a.branchId,
      agentId: "00000000-0000-4000-8000-000000000005",
    },
  };
}

async function updateLead(contactId: string, args: Record<string, unknown>) {
  const resultado: ResultadoDeTool = await CATALOGO_DE_TOOLS.get("update_lead")!.ejecutar(
    args,
    contextoDe(contactId),
  );
  assert.equal(resultado.ok, true, JSON.stringify(resultado));
  return (resultado as { ok: true; data: { vehiculoDeInteres?: Record<string, unknown> } }).data;
}

function filaDe(contactId: string) {
  return prisma.contact.findUniqueOrThrow({ where: { id: contactId } });
}

test("el agente anota la unidad de interés: queda en el contacto como AGENT y la unidad sigue disponible", async () => {
  const c = await nuevoContacto();
  const data = await updateLead(c.id, { vehiculoDeInteres: "Hilux SRV" });

  assert.deepEqual(data.vehiculoDeInteres, {
    guardado: true,
    unidad: "Toyota Hilux SRV 2022",
    nota: NOTA_VEHICULO_DE_INTERES,
  });
  const fila = await filaDe(c.id);
  assert.equal(fila.vehicleOfInterestId, hiluxSrv);
  assert.equal(fila.vehicleOfInterestSetBy, "AGENT");
  const v = await prisma.vehicle.findUniqueOrThrow({ where: { id: hiluxSrv } });
  assert.equal(v.status, "AVAILABLE", "anotarla no la reserva");
});

test("el agente cambia la que cargó él cuando el interés del cliente se mueve a otra unidad", async () => {
  const c = await nuevoContacto();
  await updateLead(c.id, { vehiculoDeInteres: "Hilux SRV" });
  const data = await updateLead(c.id, { vehiculoDeInteres: "Hilux DX" });
  assert.equal(data.vehiculoDeInteres?.guardado, true);
  assert.equal((await filaDe(c.id)).vehicleOfInterestId, hiluxDx);
});

test("el agente NO pisa la que cargó una persona, y el resto de la llamada se guarda igual", async () => {
  const c = await nuevoContacto();
  await updateContact(a.organizationId, a.userId, c.id, { vehicleOfInterestId: hiluxSrv });

  const data = await updateLead(c.id, {
    vehiculoDeInteres: "Hilux DX",
    intent: "Cambiar la camioneta",
  });

  assert.deepEqual(data.vehiculoDeInteres, {
    guardado: false,
    motivo: NOTA_VEHICULO_DE_UNA_PERSONA,
  });
  const fila = await filaDe(c.id);
  assert.equal(fila.vehicleOfInterestId, hiluxSrv);
  assert.equal(fila.vehicleOfInterestSetBy, "HUMAN");
  assert.equal(fila.leadIntent, "Cambiar la camioneta", "la calificación sí se guardó");
});

test("un texto que coincide con más de una unidad, o con ninguna, no guarda nada y dice por qué", async () => {
  const c = await nuevoContacto();
  const ambiguo = await updateLead(c.id, { vehiculoDeInteres: "Hilux" });
  assert.equal(ambiguo.vehiculoDeInteres?.guardado, false);
  assert.match(String(ambiguo.vehiculoDeInteres?.motivo), /más de una unidad/);

  const ninguna = await updateLead(c.id, { vehiculoDeInteres: "Ranger" });
  assert.equal(ninguna.vehiculoDeInteres?.guardado, false, "la de otra organización no existe");
  assert.equal((await filaDe(c.id)).vehicleOfInterestId, null);
});

test("una persona: guardar sin tocar el campo no cambia quién lo cargó; cambiarlo lo hace suyo; null lo libera", async () => {
  const c = await nuevoContacto();
  await updateLead(c.id, { vehiculoDeInteres: "Hilux SRV" });

  // El formulario manda el mismo valor que ya tenía: sigue siendo del agente.
  await updateContact(a.organizationId, a.userId, c.id, {
    firstName: "Ana María",
    vehicleOfInterestId: hiluxSrv,
  });
  assert.equal((await filaDe(c.id)).vehicleOfInterestSetBy, "AGENT");

  await updateContact(a.organizationId, a.userId, c.id, { vehicleOfInterestId: hiluxDx });
  let fila = await filaDe(c.id);
  assert.equal(fila.vehicleOfInterestId, hiluxDx);
  assert.equal(fila.vehicleOfInterestSetBy, "HUMAN");

  await updateContact(a.organizationId, a.userId, c.id, { vehicleOfInterestId: null });
  fila = await filaDe(c.id);
  assert.equal(fila.vehicleOfInterestId, null);
  assert.equal(fila.vehicleOfInterestSetBy, null);

  // Libre otra vez: el agente puede volver a anotar.
  assert.equal(
    (await updateLead(c.id, { vehiculoDeInteres: "Hilux SRV" })).vehiculoDeInteres?.guardado,
    true,
  );
});

test("una persona solo puede elegir unidades del stock de su organización, no dadas de baja", async () => {
  const c = await nuevoContacto();
  const otraOrg = await capturar(() =>
    updateContact(a.organizationId, a.userId, c.id, { vehicleOfInterestId: deOtraOrg }),
  );
  assert.ok(otraOrg instanceof AppError && otraOrg.statusCode === 400);
  assert.equal((otraOrg as AppError).message, VEHICULO_DE_INTERES_INVALIDO);

  const baja = await unidad(a, { make: "Fiat", model: "Cronos", year: 2020 });
  await prisma.vehicle.update({ where: { id: baja.id }, data: { deletedAt: new Date() } });
  const dadaDeBaja = await capturar(() =>
    updateContact(a.organizationId, a.userId, c.id, { vehicleOfInterestId: baja.id }),
  );
  assert.ok(dadaDeBaja instanceof AppError && dadaDeBaja.statusCode === 400);
});

test("la ficha sigue mostrando la unidad aunque se venda o se dé de baja, con su estado", async () => {
  const c = await nuevoContacto();
  const v = await unidad(a, { make: "Renault", model: "Duster", year: 2021 });
  await updateContact(a.organizationId, a.userId, c.id, { vehicleOfInterestId: v.id });

  await prisma.vehicle.update({ where: { id: v.id }, data: { status: "SOLD" } });
  let ficha = await getContactById(a.organizationId, c.id);
  assert.equal(ficha.vehicleOfInterest?.id, v.id);
  assert.equal(ficha.vehicleOfInterest?.status, "SOLD");

  await prisma.vehicle.update({ where: { id: v.id }, data: { deletedAt: new Date() } });
  ficha = await getContactById(a.organizationId, c.id);
  assert.equal(ficha.vehicleOfInterest?.id, v.id);
  assert.ok(ficha.vehicleOfInterest?.deletedAt, "con la marca de baja");

  // Y guardar la ficha con esa misma unidad no falla aunque ya no esté en el stock.
  await updateContact(a.organizationId, a.userId, c.id, {
    firstName: "Ana",
    vehicleOfInterestId: v.id,
  });
});
