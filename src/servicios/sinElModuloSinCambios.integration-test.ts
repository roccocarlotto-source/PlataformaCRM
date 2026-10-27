import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";

// ---------------------------------------------------------------------------
// Suite "sin el módulo, sin cambios" (docs/servicios.md §13.1), contra la app
// real. Par de sinElModuloSinCambios.test.ts. Compara contra valores fijos del
// comportamiento de antes del módulo, no contra el catálogo.
// ---------------------------------------------------------------------------

let automotora: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);

before(async () => {
  ({ baseUrl, cerrar } = await levantarApp());
  automotora = await crearOrgDePrueba("servicios-sin-modulo", "COMPLETA", "AUTOMOTORA", 1);
});

after(async () => {
  if (cerrar) await cerrar();
  await borrarOrgDePrueba(automotora);
});

test("S3: borrar los datos de un contacto sin vehículos responde lo mismo que antes del módulo", async () => {
  const c = await prisma.contact.create({
    data: { organizationId: automotora.id, firstName: "Sin", lastName: "Vehiculos" },
  });
  const r = await pedir(automotora, "POST", `/api/contacts/${c.id}/erase-personal-data`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(Object.keys(r.json).sort(), [
    "actividadesBorradas",
    "contactId",
    "contactosUnidosAnonimizados",
    "conversacionesCerradas",
    "eventosDeGoogleLimpiados",
    "eventosNoPromovidosAnonimizados",
    "identidadesBorradas",
    "ingestionEventsAnonimizados",
    "mensajesBorrados",
    "mensajesDelAgenteInternoBorrados",
    "oportunidadesAnonimizadas",
    "pendientes",
    "preguntasDeAyudaAnonimizadas",
    "seguimientosCancelados",
    "trabajosDeEntradaBorrados",
  ]);
});

test("S3: la ficha del contacto no gana campos del taller", async () => {
  const c = await prisma.contact.create({
    data: { organizationId: automotora.id, firstName: "Ficha", lastName: "Igual" },
  });
  const r = await pedir(automotora, "GET", `/api/contacts/${c.id}`);
  assert.equal(r.status, 200);
  for (const clave of Object.keys(r.json)) {
    assert.doesNotMatch(clave, /vehicul|customerVehicle|serviceOrder|taller/i, clave);
  }
});

// S4b (§4.4): el turno y la orden viven bajo /api/servicios. El detalle de un
// turno de una automotora sin el módulo responde EXACTAMENTE lo de antes: las
// mismas claves y los mismos valores, sin nada del taller.
test("S4b: el detalle de un turno responde lo mismo que antes del módulo, y la orden del turno da 403", async () => {
  const sucursal = await prisma.branch.create({
    data: { organizationId: automotora.id, name: "Centro", timezone: "America/Montevideo" },
  });
  const recurso = await prisma.resource.create({
    data: { organizationId: automotora.id, branchId: sucursal.id, name: "Box", type: "ROOM" },
  });
  const servicio = await prisma.serviceType.create({
    data: {
      organizationId: automotora.id,
      branchId: sucursal.id,
      resourceId: recurso.id,
      name: "Prueba de manejo",
      durationMin: 30,
    },
  });
  const contacto = await prisma.contact.create({
    data: { organizationId: automotora.id, firstName: "Turno", lastName: "Igual" },
  });
  const startsAt = new Date("2030-01-10T13:00:00.000Z");
  const endsAt = new Date("2030-01-10T13:30:00.000Z");
  const turno = await prisma.booking.create({
    data: {
      organizationId: automotora.id,
      branchId: sucursal.id,
      serviceTypeId: servicio.id,
      resourceId: recurso.id,
      contactId: contacto.id,
      startsAt,
      endsAt,
    },
  });

  const r = await pedir(automotora, "GET", `/api/bookings/${turno.id}`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const { createdAt, updatedAt, ...resto } = r.json as Record<string, unknown>;
  assert.equal(typeof createdAt, "string");
  assert.equal(typeof updatedAt, "string");
  // El cuerpo de antes de S4b (el controlador de turnos no cambia): ni un
  // campo de más, ni uno de menos.
  assert.deepEqual(resto, {
    id: turno.id,
    organizationId: automotora.id,
    branchId: sucursal.id,
    serviceTypeId: servicio.id,
    resourceId: recurso.id,
    contactId: contacto.id,
    opportunityId: null,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    status: "CONFIRMED",
    googleEventId: null,
  });

  const orden = await pedir(automotora, "GET", `/api/servicios/ordenes?bookingId=${turno.id}`);
  assert.equal(orden.status, 403);
  const turnos = await pedir(automotora, "GET", `/api/servicios/turnos?contactId=${contacto.id}`);
  assert.equal(turnos.status, 403);
});

// S6 (§6.3): activities suma source_notice_id y source_service_order_id. Una
// organización sin el módulo recibe la tarea con las claves de antes.
test("S6: la tarea de una automotora sin el módulo no gana las columnas del taller", async () => {
  const c = await prisma.contact.create({
    data: { organizationId: automotora.id, firstName: "Tarea", lastName: "Igual" },
  });
  const r = await pedir(automotora, "POST", "/api/activities", {
    type: "TASK",
    subject: "Llamar",
    contactId: c.id,
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const claves = Object.keys(r.json);
  assert.ok(!claves.includes("sourceNoticeId"), claves.join(","));
  assert.ok(!claves.includes("sourceServiceOrderId"), claves.join(","));
  const listado = await pedir(automotora, "GET", `/api/activities?contactId=${c.id}`);
  assert.equal(listado.status, 200);
  for (const fila of (listado.json as { data: Record<string, unknown>[] }).data) {
    assert.ok(!("sourceNoticeId" in fila) && !("sourceServiceOrderId" in fila));
  }
});
