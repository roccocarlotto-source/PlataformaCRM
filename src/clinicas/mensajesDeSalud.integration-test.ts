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
import { MENSAJE_DE_URGENCIA_POR_DEFECTO } from "./config/mensajesDeSalud";
import { leerSaludDeLaClinica } from "./repositories/clinicSettings.repository";
import { URGENCIA_SIN_TELEFONO } from "./services/mensajesDeSalud.service";

// ---------------------------------------------------------------------------
// Los mensajes de salud que edita el ADMIN de una clínica (docs/rubros.md
// §5.3, D11 revisada el 2026-10-12), contra la app real y Postgres: el 400 sin
// teléfono, los términos del código que no se sacan, el historial (quién y
// cuándo), solo ADMIN, y una automotora sin cambios (403 por el rubro).
// ---------------------------------------------------------------------------

const ADMIN = 0;
const RECEPCION = 1;
const RUTA = "/api/clinica/mensajes-de-salud";

let clinica: OrgDePrueba;
let otraClinica: OrgDePrueba;
let automotora: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);

interface CuerpoDeMensajes {
  urgencyMessageText: string | null;
  clinicalMessageText: string | null;
  extraUrgencyTerms: string[];
  extraClinicalTerms: string[];
  porDefecto: { urgencyMessageText: string; urgencyTerms: string[]; clinicalTerms: string[] };
  ultimoCambio: { changedBy: { id: string }; createdAt: string } | null;
  error?: { message: string };
}

interface CuerpoDelHistorial {
  data: { changedBy: { id: string } }[];
  pagination: { total: number };
}

const m = (r: { json: unknown }) => r.json as CuerpoDeMensajes;
const h = (r: { json: unknown }) => r.json as CuerpoDelHistorial;

const SIN_CAMBIOS = {
  urgencyMessageText: null,
  clinicalMessageText: null,
  extraUrgencyTerms: [],
  extraClinicalTerms: [],
};

before(async () => {
  ({ baseUrl, cerrar } = await levantarApp());
  clinica = await crearOrgDePrueba("mensajes-de-salud", "COMPLETA", "CLINICA", 2);
  otraClinica = await crearOrgDePrueba("mensajes-de-salud", "ESENCIAL", "CLINICA", 1);
  automotora = await crearOrgDePrueba("mensajes-de-salud", "COMPLETA", "AUTOMOTORA", 1);
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

test("sin configurar: los textos y términos por defecto, sin agregados ni último cambio", async () => {
  const r = await pedir(clinica, "GET", RUTA, undefined, clinica.tokens[ADMIN]);
  assert.equal(r.status, 200);
  assert.equal(m(r).urgencyMessageText, null);
  assert.deepEqual(m(r).extraUrgencyTerms, []);
  assert.equal(m(r).porDefecto.urgencyMessageText, MENSAJE_DE_URGENCIA_POR_DEFECTO);
  assert.ok(m(r).porDefecto.urgencyTerms.includes("no puedo respirar"));
  assert.ok(m(r).porDefecto.clinicalTerms.length > 0);
  assert.equal(m(r).ultimoCambio, null);
});

test("el ADMIN guarda; queda registrado quién y cuándo, con el antes y el después", async () => {
  const token = clinica.tokens[ADMIN];
  const antes = Date.now();
  const r = await pedir(
    clinica,
    "PUT",
    RUTA,
    {
      urgencyMessageText: "Llamá ya al 105 o al 911. Ya avisamos a {clinica}.",
      clinicalMessageText: null,
      extraUrgencyTerms: ["Código Rojo"],
      extraClinicalTerms: ["botox", "no puedo respirar"],
    },
    token,
  );
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(m(r).urgencyMessageText, "Llamá ya al 105 o al 911. Ya avisamos a {clinica}.");
  assert.deepEqual(m(r).extraUrgencyTerms, ["codigo rojo"]);
  assert.deepEqual(m(r).extraClinicalTerms, ["botox", "no puedo respirar"]);
  assert.equal(m(r).ultimoCambio?.changedBy.id, clinica.authIds[ADMIN]);
  assert.ok(new Date(m(r).ultimoCambio?.createdAt ?? 0).getTime() >= antes - 1000);

  const guardado = await leerSaludDeLaClinica(clinica.id);
  assert.deepEqual(guardado.extraUrgencyTerms, ["codigo rojo"]);

  const [cambio] = await prisma.clinicHealthSettingsChange.findMany({
    where: { organizationId: clinica.id },
  });
  assert.equal(cambio.changedById, clinica.authIds[ADMIN]);
  assert.deepEqual(cambio.changes, {
    urgencyMessageText: {
      antes: null,
      despues: "Llamá ya al 105 o al 911. Ya avisamos a {clinica}.",
    },
    extraUrgencyTerms: { antes: [], despues: ["codigo rojo"] },
    extraClinicalTerms: { antes: [], despues: ["botox", "no puedo respirar"] },
  });

  // Guardar lo mismo no es un cambio: no deja otra fila.
  await pedir(
    clinica,
    "PUT",
    RUTA,
    {
      urgencyMessageText: "Llamá ya al 105 o al 911. Ya avisamos a {clinica}.",
      clinicalMessageText: null,
      extraUrgencyTerms: ["codigo rojo"],
      extraClinicalTerms: ["botox", "no puedo respirar"],
    },
    token,
  );
  const historial = await pedir(clinica, "GET", `${RUTA}/historial`, undefined, token);
  assert.equal(historial.status, 200);
  assert.equal(h(historial).pagination.total, 1);
  assert.equal(h(historial).data[0].changedBy.id, clinica.authIds[ADMIN]);
});

test("los términos del código no se sacan: mandar la lista vacía deja el detector con los suyos", async () => {
  const token = clinica.tokens[ADMIN];
  const r = await pedir(clinica, "PUT", RUTA, SIN_CAMBIOS, token);
  assert.equal(r.status, 200);
  assert.deepEqual(m(r).extraUrgencyTerms, []);
  assert.ok(m(r).porDefecto.urgencyTerms.includes("no puedo respirar"));
  assert.equal(m(r).urgencyMessageText, null, "null vuelve al texto por defecto");
});

test("el mensaje de urgencia sin teléfono es un 400 y no se guarda nada", async () => {
  const token = clinica.tokens[ADMIN];
  const r = await pedir(
    clinica,
    "PUT",
    RUTA,
    { ...SIN_CAMBIOS, urgencyMessageText: "Si es una urgencia, andá a la guardia más cercana." },
    token,
  );
  assert.equal(r.status, 400);
  assert.equal(m(r).error?.message, URGENCIA_SIN_TELEFONO);
  assert.equal((await leerSaludDeLaClinica(clinica.id)).urgencyMessageText, null);
});

test("validación del body: todas las claves, sin otras", async () => {
  const token = clinica.tokens[ADMIN];
  for (const cuerpo of [
    {},
    { ...SIN_CAMBIOS, extraUrgencyTerms: "botox" },
    { ...SIN_CAMBIOS, otra: 1 },
    { ...SIN_CAMBIOS, extraClinicalTerms: ["ojo"] },
  ]) {
    const r = await pedir(clinica, "PUT", RUTA, cuerpo, token);
    assert.equal(r.status, 400, JSON.stringify(cuerpo));
  }
});

test("solo el ADMIN: la Recepción recibe 403", async () => {
  const token = clinica.tokens[RECEPCION];
  assert.equal((await pedir(clinica, "GET", RUTA, undefined, token)).status, 403);
  assert.equal((await pedir(clinica, "PUT", RUTA, SIN_CAMBIOS, token)).status, 403);
  assert.equal((await pedir(clinica, "GET", `${RUTA}/historial`, undefined, token)).status, 403);
});

test("aislamiento: otra clínica no ve la configuración ni el historial de esta", async () => {
  const token = otraClinica.tokens[0];
  const r = await pedir(otraClinica, "GET", RUTA, undefined, token);
  assert.equal(r.status, 200);
  assert.deepEqual(m(r).extraClinicalTerms, []);
  assert.equal(m(r).ultimoCambio, null);
  const historial = await pedir(otraClinica, "GET", `${RUTA}/historial`, undefined, token);
  assert.equal(h(historial).pagination.total, 0);
});

test("automotora sin cambios: las tres rutas dan 403 por el rubro y no se crea ninguna fila", async () => {
  const token = automotora.tokens[0];
  for (const [metodo, path, body] of [
    ["GET", RUTA, undefined],
    ["PUT", RUTA, SIN_CAMBIOS],
    ["GET", `${RUTA}/historial`, undefined],
  ] as const) {
    const r = await pedir(automotora, metodo, path, body, token);
    assert.equal(r.status, 403, `${metodo} ${path}`);
  }
  assert.equal(await prisma.clinicSettings.count({ where: { organizationId: automotora.id } }), 0);
  assert.equal(
    await prisma.clinicHealthSettingsChange.count({ where: { organizationId: automotora.id } }),
    0,
  );
});
