import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import type { OrganizationEdition } from "@prisma/client";
import type { Express } from "express";
import { env } from "../config/env";
import { MODULOS, RUTAS_POR_MODULO, modulosDe, type Modulo } from "../config/ediciones";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { CAMPO_NO_INCLUIDO, MODULO_NO_INCLUIDO } from "../middlewares/moduloDeLaEdicion";
import { findRoleByName } from "../repositories/role.repository";

// ---------------------------------------------------------------------------
// Gate de módulos por edición contra LA APP REAL (docs/ediciones.md §5.4,
// punto 2), al estilo de los tests de aislamiento: dos organizaciones, una
// COMPLETA y una ESENCIAL, con usuarios reales de Supabase Auth.
//
// LOS CASOS SALEN DEL CATÁLOGO (RUTAS_POR_MODULO), no de una lista a mano:
//   - COMPLETA: TODAS las rutas del catálogo, ninguna da MODULO_NO_INCLUIDO
//     (el gate es un no-op para las organizaciones de hoy);
//   - ESENCIAL: cada ruta de un módulo excluido da 403 MODULO_NO_INCLUIDO con
//     su módulo, y cada ruta de un módulo incluido no lo da.
//
// Para no producir efectos, cada pedido usa UUIDs inventados en el path y,
// si no es GET, un body JSON que es un ARRAY: todo schema de objeto lo
// rechaza con 400 antes de tocar nada, y el gate corre antes (dentro de
// authenticate). Lo que se afirma es lo que decide el gate, no la respuesta
// del handler: un 400, 404 o 429 de después cuenta como "respondió normal".
//
// Además: el orden 401 → 403 (sin sesión sigue siendo 401), los bloqueos por
// campo, /api/me con edition y modulos, y que en ESENCIAL una oportunidad se
// marca Vendida o Perdida sin que el cliente llame a /pipelines ni /stages.
// ---------------------------------------------------------------------------

const PASSWORD = "Ediciones-test-password-123!";
// Usuarios por organización, rotando: el barrido hace más de 100 escrituras y
// businessWriteRateLimiter es por usuario.
const USUARIOS_POR_ORG = 3;

interface Org {
  id: string;
  edition: OrganizationEdition;
  tokens: string[];
  authIds: string[];
}

let completa: Org;
let esencial: Org;
let baseUrl: string;
let cerrar: () => Promise<void>;

async function crearOrg(edition: OrganizationEdition): Promise<Org> {
  const etiqueta = edition.toLowerCase();
  const org = await prisma.organization.create({
    data: {
      name: `Ediciones ${etiqueta} ${randomUUID()}`,
      slug: `ediciones-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
      edition,
    },
  });
  const rol = await findRoleByName("ADMIN");
  if (!rol) throw new Error("No está sembrado el rol ADMIN");
  const tokens: string[] = [];
  const authIds: string[] = [];
  for (let i = 0; i < USUARIOS_POR_ORG; i++) {
    const email = `ediciones-${etiqueta}-${i}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
    const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    authIds.push(data.user.id);
    await prisma.user.create({
      data: {
        id: data.user.id,
        organizationId: org.id,
        roleId: rol.id,
        email,
        fullName: `Ediciones ${etiqueta} ${i}`,
      },
    });
    const anon = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!);
    const sesion = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    if (sesion.error || !sesion.data.session) throw new Error(`signIn: ${sesion.error?.message}`);
    tokens.push(sesion.data.session.access_token);
  }
  return { id: org.id, edition, tokens, authIds };
}

before(async () => {
  process.env.LOG_LEVEL = "fatal";
  const { app }: { app: Express } = await import("../app.js");
  await new Promise<void>((resolve) => {
    const server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      cerrar = () => new Promise((r) => server.close(() => r()));
      resolve();
    });
  });
  completa = await crearOrg("COMPLETA");
  esencial = await crearOrg("ESENCIAL");
});

after(async () => {
  if (cerrar) await cerrar();
  for (const org of [completa, esencial]) {
    if (!org) continue;
    const where = { organizationId: org.id };
    await prisma.outboxEvent.deleteMany({ where });
    await prisma.activity.deleteMany({ where });
    await prisma.opportunity.deleteMany({ where });
    await prisma.stage.deleteMany({ where });
    await prisma.pipeline.deleteMany({ where });
    await prisma.contact.deleteMany({ where });
    await prisma.knowledgeBaseEntry.deleteMany({ where });
    await prisma.branch.deleteMany({ where });
    await prisma.user.deleteMany({ where });
    await prisma.organization.delete({ where: { id: org.id } });
    for (const id of org.authIds) await getSupabaseAdmin().auth.admin.deleteUser(id);
  }
});

let turno = 0;
async function pedir(
  org: Org,
  metodo: string,
  path: string,
  body?: unknown,
  token: string | null = org.tokens[turno++ % org.tokens.length],
): Promise<{
  status: number;
  json: { error?: Record<string, unknown> } & Record<string, unknown>;
}> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: metodo,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const texto = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(texto) as Record<string, unknown>;
  } catch {
    // CSV u otra respuesta que no es JSON: no es un 403 del gate.
  }
  return { status: res.status, json };
}

// "GET /api/quotes/:id" → método y path con UUIDs inventados en cada parámetro.
function concreta(ruta: string): { metodo: string; path: string } {
  const [metodo, patron] = ruta.split(" ");
  return { metodo, path: patron.replace(/:[A-Za-z]+/g, () => randomUUID()) };
}

const esDelGate = (r: { status: number; json: { error?: Record<string, unknown> } }) =>
  r.status === 403 && r.json.error?.code === MODULO_NO_INCLUIDO;

async function barrer(org: Org): Promise<{ ruta: string; modulo: Modulo; bloqueada: boolean }[]> {
  const salida: { ruta: string; modulo: Modulo; bloqueada: boolean }[] = [];
  for (const modulo of MODULOS) {
    for (const ruta of RUTAS_POR_MODULO[modulo]) {
      const { metodo, path } = concreta(ruta);
      const r = await pedir(org, metodo, path, metodo === "GET" ? undefined : []);
      if (esDelGate(r)) {
        assert.equal(r.json.error?.modulo, modulo, `${ruta}: el 403 nombra otro módulo`);
      }
      salida.push({ ruta, modulo, bloqueada: esDelGate(r) });
    }
  }
  return salida;
}

const TOTAL_DEL_CATALOGO = MODULOS.reduce((n, m) => n + RUTAS_POR_MODULO[m].length, 0);

test("COMPLETA: TODAS las rutas del catálogo, ninguna da MODULO_NO_INCLUIDO", async () => {
  const resultado = await barrer(completa);
  assert.equal(resultado.length, TOTAL_DEL_CATALOGO, "el barrido recorre el catálogo entero");
  assert.deepEqual(
    resultado.filter((r) => r.bloqueada).map((r) => r.ruta),
    [],
  );
});

test("ESENCIAL: cada ruta excluida da 403 MODULO_NO_INCLUIDO y cada incluida responde normal", async () => {
  const resultado = await barrer(esencial);
  assert.equal(resultado.length, TOTAL_DEL_CATALOGO);
  const incluidos = modulosDe("ESENCIAL");
  assert.deepEqual(
    resultado.filter((r) => incluidos.has(r.modulo) && r.bloqueada).map((r) => r.ruta),
    [],
    "rutas incluidas que el gate bloqueó",
  );
  assert.deepEqual(
    resultado.filter((r) => !incluidos.has(r.modulo) && !r.bloqueada).map((r) => r.ruta),
    [],
    "rutas excluidas que el gate dejó pasar",
  );
  // Y hay rutas excluidas de verdad: el barrido no es trivial.
  assert.ok(resultado.filter((r) => r.bloqueada).length >= 29);
});

test("el orden no cambia: sin sesión 401 (también en una ruta excluida); el 403 es para el autenticado", async () => {
  for (const org of [completa, esencial]) {
    const sinToken = await pedir(
      org,
      "GET",
      "/api/quotes?opportunityId=" + randomUUID(),
      undefined,
      null,
    );
    assert.equal(sinToken.status, 401);
    const tokenInvalido = await pedir(org, "GET", "/api/pipelines", undefined, "no-es-un-jwt");
    assert.equal(tokenInvalido.status, 401);
  }
  const autenticado = await pedir(esencial, "GET", "/api/pipelines");
  assert.equal(autenticado.status, 403);
  assert.equal(autenticado.json.error?.code, MODULO_NO_INCLUIDO);
  assert.equal(autenticado.json.error?.modulo, "procesos_de_venta");
});

test("las rutas públicas no dependen de la edición: /health responde sin sesión", async () => {
  const salud = await fetch(`${baseUrl}/health`);
  assert.notEqual(salud.status, 401);
  assert.notEqual(salud.status, 403);
});

test("/api/me devuelve la edición y los módulos, en las dos ediciones", async () => {
  const meCompleta = await pedir(completa, "GET", "/api/me");
  assert.equal(meCompleta.status, 200);
  assert.equal(meCompleta.json.edition, "COMPLETA");
  assert.deepEqual(meCompleta.json.modulos, [...MODULOS]);

  const meEsencial = await pedir(esencial, "GET", "/api/me");
  assert.equal(meEsencial.json.edition, "ESENCIAL");
  const modulos = meEsencial.json.modulos as string[];
  assert.ok(modulos.includes("oportunidades"));
  assert.ok(modulos.includes("dashboard_atencion"));
  assert.ok(!modulos.includes("cotizaciones"));
  assert.ok(!modulos.includes("procesos_de_venta"));
});

test("bloqueos por campo: 400 CAMPO_NO_INCLUIDO en ESENCIAL; COMPLETA no los ve", async () => {
  const idInventado = randomUUID();
  const casos: [string, string, Record<string, unknown>, string][] = [
    ["POST", "/api/contacts", { firstName: "Ana", companyId: idInventado }, "companyId"],
    ["PATCH", `/api/contacts/${randomUUID()}`, { companyId: idInventado }, "companyId"],
    [
      "POST",
      "/api/activities",
      { type: "NOTE", subject: "x", companyId: idInventado },
      "companyId",
    ],
    ["PATCH", `/api/opportunities/${randomUUID()}`, { financingType: "BANK" }, "financingType"],
    [
      "PATCH",
      `/api/vehicles/${randomUUID()}`,
      { tradeInOpportunityId: idInventado },
      "tradeInOpportunityId",
    ],
  ];
  for (const [metodo, path, body, campo] of casos) {
    const enEsencial = await pedir(esencial, metodo, path, body);
    assert.equal(enEsencial.status, 400, `${metodo} ${path}`);
    assert.equal(enEsencial.json.error?.code, CAMPO_NO_INCLUIDO);
    assert.equal(enEsencial.json.error?.campo, campo);

    const enCompleta = await pedir(completa, metodo, path, body);
    assert.notEqual(
      enCompleta.json.error?.code,
      CAMPO_NO_INCLUIDO,
      `${metodo} ${path} en COMPLETA`,
    );
  }
  // null es "desvincular": no se bloquea.
  const conNull = await pedir(esencial, "PATCH", `/api/contacts/${randomUUID()}`, {
    companyId: null,
  });
  assert.notEqual(conNull.json.error?.code, CAMPO_NO_INCLUIDO);
});

test("ESENCIAL: una oportunidad se marca Vendida y Perdida sin llamar a /pipelines ni /stages", async () => {
  // El proceso fijo de ESENCIAL (§2.1), armado como lo va a hacer el PR 4 al
  // dar de alta la organización. El cliente nunca ve estos ids.
  const pipeline = await prisma.pipeline.create({
    data: { organizationId: esencial.id, name: "Ventas", isDefault: true },
  });
  const [enCurso] = await Promise.all([
    prisma.stage.create({
      data: { organizationId: esencial.id, pipelineId: pipeline.id, name: "En curso", order: 1 },
    }),
    prisma.stage.create({
      data: {
        organizationId: esencial.id,
        pipelineId: pipeline.id,
        name: "Vendida",
        order: 2,
        isWon: true,
      },
    }),
    prisma.stage.create({
      data: {
        organizationId: esencial.id,
        pipelineId: pipeline.id,
        name: "Perdida",
        order: 3,
        isLost: true,
      },
    }),
  ]);
  const contacto = await prisma.contact.create({
    data: { organizationId: esencial.id, firstName: "Ana", lastName: "Pérez" },
  });
  const nueva = (titulo: string) =>
    prisma.opportunity.create({
      data: {
        organizationId: esencial.id,
        title: titulo,
        contactId: contacto.id,
        pipelineId: pipeline.id,
        stageId: enCurso.id,
        ownerId: esencial.authIds[0],
      },
    });
  const aVender = await nueva("Hilux para vender");
  const aPerder = await nueva("Hilux para perder");

  const listado = await pedir(esencial, "GET", "/api/opportunities");
  assert.equal(listado.status, 200);

  const vendida = await pedir(esencial, "PATCH", `/api/opportunities/${aVender.id}`, {
    status: "WON",
  });
  assert.equal(vendida.status, 200, JSON.stringify(vendida.json));
  const perdida = await pedir(esencial, "PATCH", `/api/opportunities/${aPerder.id}`, {
    status: "LOST",
    lostReason: "Compró en otro lado",
  });
  assert.equal(perdida.status, 200, JSON.stringify(perdida.json));

  const [v, p] = await Promise.all([
    prisma.opportunity.findUniqueOrThrow({ where: { id: aVender.id }, include: { stage: true } }),
    prisma.opportunity.findUniqueOrThrow({ where: { id: aPerder.id }, include: { stage: true } }),
  ]);
  assert.equal(v.status, "WON");
  assert.equal(v.stage.name, "Vendida");
  assert.equal(p.status, "LOST");
  assert.equal(p.stage.name, "Perdida");

  const detalle = await pedir(esencial, "GET", `/api/opportunities/${aVender.id}`);
  assert.equal(detalle.status, 200);
});

test("subir de edición (PR 4): un usuario ESENCIAL bloqueado en /quotes deja de estarlo con el mismo token", async () => {
  const aSubir = await crearOrg("ESENCIAL");
  // El platform admin: un usuario de la organización COMPLETA en la allowlist.
  await prisma.platformAdmin.create({ data: { userId: completa.authIds[0] } });
  try {
    const usuario = aSubir.tokens[0];
    const ruta = `/api/quotes?opportunityId=${randomUUID()}`;

    const antes = await pedir(aSubir, "GET", ruta, undefined, usuario);
    assert.ok(esDelGate(antes), "antes de subir, ESENCIAL no tiene cotizaciones");

    const subir = await pedir(
      completa,
      "PATCH",
      `/api/admin/organizations/${aSubir.id}/edition`,
      { edition: "COMPLETA" },
      completa.tokens[0],
    );
    assert.equal(subir.status, 200, JSON.stringify(subir.json));
    assert.equal(subir.json.edition, "COMPLETA");

    const despues = await pedir(aSubir, "GET", ruta, undefined, usuario);
    assert.equal(
      esDelGate(despues),
      false,
      "después de subir, el mismo token ya no está bloqueado",
    );
    const me = await pedir(aSubir, "GET", "/api/me", undefined, usuario);
    assert.equal(me.json.edition, "COMPLETA");

    const bajar = await pedir(
      completa,
      "PATCH",
      `/api/admin/organizations/${aSubir.id}/edition`,
      { edition: "ESENCIAL" },
      completa.tokens[0],
    );
    assert.equal(bajar.status, 409);
  } finally {
    await prisma.platformAdmin.deleteMany({ where: { userId: completa.authIds[0] } });
    await prisma.user.deleteMany({ where: { organizationId: aSubir.id } });
    await prisma.organization.delete({ where: { id: aSubir.id } });
    for (const id of aSubir.authIds) await getSupabaseAdmin().auth.admin.deleteUser(id);
  }
});
