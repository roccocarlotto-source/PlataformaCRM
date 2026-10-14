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
    "identidadesBorradas",
    "ingestionEventsAnonimizados",
    "mensajesBorrados",
    "pendientes",
    "seguimientosCancelados",
    "trabajosDeEntradaAnonimizados",
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
