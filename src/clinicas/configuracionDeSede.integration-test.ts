import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { findRoleByName } from "../repositories/role.repository";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { createBranch } from "../services/branch.service";
import { leerConfiguracionDeSede } from "./repositories/clinicSettings.repository";

// ---------------------------------------------------------------------------
// La configuración de clínica de una sede (R11, docs/rubros.md §5.1 y D10):
// el plazo mínimo para que el asistente reprograme o cancele un turno. Contra
// la app real y Postgres. Lo edita solo el ADMIN; sin valor por defecto.
// ---------------------------------------------------------------------------

const ADMIN = 0;
const RECEPCION = 1;

let clinica: OrgDePrueba;
let otraClinica: OrgDePrueba;
let automotora: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);
const ids = {} as { sede: string; sedeSinFila: string; sedeDeOtra: string; sucursal: string };

const ruta = (branchId: string) => `/api/clinica/sedes/${branchId}/configuracion`;

before(async () => {
  ({ baseUrl, cerrar } = await levantarApp());
  clinica = await crearOrgDePrueba("configuracion-de-sede", "COMPLETA", "CLINICA", 2);
  otraClinica = await crearOrgDePrueba("configuracion-de-sede", "ESENCIAL", "CLINICA", 1);
  automotora = await crearOrgDePrueba("configuracion-de-sede", "COMPLETA", "AUTOMOTORA", 1);
  ids.sede = (await createBranch(clinica.id, { name: "Centro", timezone: "UTC" }, "CLINICA")).id;
  // Una sede sin su fila de ClinicBranchSettings (creada como automotora).
  ids.sedeSinFila = (await createBranch(clinica.id, { name: "Norte", timezone: "UTC" })).id;
  ids.sedeDeOtra = (
    await createBranch(otraClinica.id, { name: "Otra", timezone: "UTC" }, "CLINICA")
  ).id;
  ids.sucursal = (await createBranch(automotora.id, { name: "Sucursal", timezone: "UTC" })).id;
  const recepcion = await findRoleByName("RECEPCION");
  if (!recepcion) throw new Error("Falta el rol RECEPCION");
  await prisma.user.update({
    where: { id: clinica.authIds[RECEPCION] },
    data: { roleId: recepcion.id },
  });
});

after(async () => {
  if (cerrar) await cerrar();
  for (const org of [clinica, otraClinica, automotora]) {
    if (org) await borrarOrgDePrueba(org);
  }
});

test("sin valor por defecto: una sede nueva no tiene plazo", async () => {
  const r = await pedir(clinica, "GET", ruta(ids.sede), undefined, clinica.tokens[ADMIN]);
  assert.equal(r.status, 200);
  assert.equal(r.json.minHoursToChangeBooking, null);
});

test("el ADMIN lo guarda, lo vuelve a sacar con null, y también en una sede sin fila", async () => {
  const token = clinica.tokens[ADMIN];
  const guardado = await pedir(
    clinica,
    "PUT",
    ruta(ids.sede),
    { minHoursToChangeBooking: 24 },
    token,
  );
  assert.equal(guardado.status, 200);
  assert.equal(guardado.json.minHoursToChangeBooking, 24);
  assert.equal((await leerConfiguracionDeSede(clinica.id, ids.sede)).minHoursToChangeBooking, 24);

  const cero = await pedir(clinica, "PUT", ruta(ids.sede), { minHoursToChangeBooking: 0 }, token);
  assert.equal(cero.json.minHoursToChangeBooking, 0);

  const sinPlazo = await pedir(
    clinica,
    "PUT",
    ruta(ids.sede),
    { minHoursToChangeBooking: null },
    token,
  );
  assert.equal(sinPlazo.json.minHoursToChangeBooking, null);

  const sinFila = await pedir(
    clinica,
    "PUT",
    ruta(ids.sedeSinFila),
    { minHoursToChangeBooking: 6 },
    token,
  );
  assert.equal(sinFila.status, 200);
  assert.equal(
    (await leerConfiguracionDeSede(clinica.id, ids.sedeSinFila)).minHoursToChangeBooking,
    6,
  );
});

test("validación: entero ≥ 0, sin otras claves", async () => {
  const token = clinica.tokens[ADMIN];
  for (const cuerpo of [
    { minHoursToChangeBooking: -1 },
    { minHoursToChangeBooking: 1.5 },
    { minHoursToChangeBooking: "24" },
    { minHoursToChangeBooking: 100000 },
    {},
    { minHoursToChangeBooking: 2, noResponseTaskHours: 3 },
  ]) {
    const r = await pedir(clinica, "PUT", ruta(ids.sede), cuerpo, token);
    assert.equal(r.status, 400, JSON.stringify(cuerpo));
  }
});

test("solo el ADMIN: la Recepción recibe 403", async () => {
  const token = clinica.tokens[RECEPCION];
  assert.equal((await pedir(clinica, "GET", ruta(ids.sede), undefined, token)).status, 403);
  assert.equal(
    (await pedir(clinica, "PUT", ruta(ids.sede), { minHoursToChangeBooking: 1 }, token)).status,
    403,
  );
});

test("aislamiento: la sede de otra organización da 404 y no se toca", async () => {
  const r = await pedir(
    clinica,
    "PUT",
    ruta(ids.sedeDeOtra),
    { minHoursToChangeBooking: 12 },
    clinica.tokens[ADMIN],
  );
  assert.equal(r.status, 404);
  assert.equal(
    (await leerConfiguracionDeSede(otraClinica.id, ids.sedeDeOtra)).minHoursToChangeBooking,
    null,
  );
});

test("una automotora recibe 403 con motivo RUBRO", async () => {
  for (const [metodo, cuerpo] of [
    ["GET", undefined],
    ["PUT", { minHoursToChangeBooking: 1 }],
  ] as const) {
    const r = await pedir(automotora, metodo, ruta(ids.sucursal), cuerpo, automotora.tokens[0]);
    assert.equal(r.status, 403);
    assert.equal((r.json.error as { motivo?: string } | undefined)?.motivo, "RUBRO");
  }
});
