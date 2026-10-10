import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { vocabularioDe } from "../config/vocabulario";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";

// ---------------------------------------------------------------------------
// Suite "automotora sin cambios" (docs/rubros.md §0.3 y §14.1), contra la app
// real. El par unitario es automotoraSinCambios.test.ts; cada PR del plan de
// clínicas que toca el núcleo le agrega su caso a uno de los dos.
//
// Dos automotoras, una COMPLETA y una ESENCIAL, con ADMIN reales. Los valores
// esperados son FIJOS, los de antes de R2.
//
// Casos de R2: /api/me (las claves de antes más `industry`, y los mismos
// módulos) y el 403 y el 400 del gate por HTTP (el cuerpo de antes más
// `motivo`). El barrido de todas las rutas está en
// src/routes/ediciones.integration-test.ts.
// ---------------------------------------------------------------------------

let completa: OrgDePrueba;
let esencial: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);

before(async () => {
  ({ baseUrl, cerrar } = await levantarApp());
  completa = await crearOrgDePrueba("automotora-sin-cambios", "COMPLETA", "AUTOMOTORA", 1);
  esencial = await crearOrgDePrueba("automotora-sin-cambios", "ESENCIAL", "AUTOMOTORA", 1);
});

after(async () => {
  if (cerrar) await cerrar();
  await borrarOrgDePrueba(completa);
  await borrarOrgDePrueba(esencial);
});

// Las claves de /api/me antes de R2. R2 suma `industry`; R3, `vocabulario`
// (una automotora no tiene `contactTerm`); R12, `rolesAsignables`.
const CLAVES_DE_ME_DE_HOY = [
  "canUseInternalAgent",
  "edition",
  "email",
  "fullName",
  "id",
  "internalAgentConfigured",
  "isPlatformAdmin",
  "modulos",
  "organizationId",
  "role",
];

const SOLO_COMPLETA = [
  "procesos_de_venta",
  "cotizaciones",
  "pagos",
  "entregas",
  "empresas",
  "dashboard_comercial",
  "financiacion",
  "permutas",
];

const MODULOS_DE_HOY_COMPLETA = [
  "comun",
  "plataforma",
  "usuarios",
  "contactos",
  "conversaciones",
  "agentes",
  "canales",
  "base_de_conocimiento",
  "sucursales",
  "agenda",
  "stock",
  "tareas",
  "cupones_y_qr",
  "automatizaciones",
  "oportunidades",
  "campos_personalizados",
  "agente_interno",
  "ingesta",
  "dashboard_atencion",
  ...SOLO_COMPLETA,
];

test("/api/me de una automotora: las claves de antes más industry, vocabulario y rolesAsignables, y los mismos módulos", async () => {
  for (const org of [completa, esencial]) {
    const me = await pedir(org, "GET", "/api/me");
    assert.equal(me.status, 200);
    assert.deepEqual(
      Object.keys(me.json).sort(),
      [...CLAVES_DE_ME_DE_HOY, "industry", "vocabulario", "rolesAsignables"].sort(),
    );
    // R12: los dos roles de siempre; Recepción no es de una automotora.
    assert.deepEqual(me.json.rolesAsignables, ["ADMIN", "USER"]);
    // Los textos de hoy (fijados uno por uno en automotoraSinCambios.test.ts).
    assert.deepEqual(me.json.vocabulario, vocabularioDe("AUTOMOTORA", null));
    assert.equal(
      (me.json.vocabulario as { contacto: { pluralTitulo: string } }).contacto.pluralTitulo,
      "Clientes",
    );
    assert.equal(me.json.edition, org.edition);
    assert.equal(me.json.industry, "AUTOMOTORA");
    assert.deepEqual(
      me.json.modulos,
      org.edition === "COMPLETA"
        ? MODULOS_DE_HOY_COMPLETA
        : MODULOS_DE_HOY_COMPLETA.filter((m) => !SOLO_COMPLETA.includes(m)),
      org.edition,
    );
  }
});

test("el 403 por HTTP de una automotora ESENCIAL: el cuerpo de antes más motivo EDICION; COMPLETA no lo ve", async () => {
  const bloqueada = await pedir(esencial, "GET", "/api/quotes");
  assert.equal(bloqueada.status, 403);
  const { code, modulo, motivo, ...resto } = bloqueada.json.error ?? {};
  assert.equal(code, "MODULO_NO_INCLUIDO");
  assert.equal(modulo, "cotizaciones");
  assert.equal(motivo, "EDICION");
  assert.deepEqual(resto, { message: "Esta función no está incluida en tu edición." });

  const enCompleta = await pedir(completa, "GET", "/api/quotes");
  assert.notEqual(enCompleta.json.error?.code, "MODULO_NO_INCLUIDO");

  // Lo que una clínica no tiene, una automotora lo sigue teniendo.
  for (const org of [completa, esencial]) {
    const stock = await pedir(org, "GET", "/api/vehicles");
    assert.equal(stock.status, 200, `${org.edition}: /api/vehicles`);
  }
});
