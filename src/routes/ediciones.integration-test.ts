import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import {
  MODULOS,
  PROCESO_DE_VENTA_FIJO,
  RUTAS_POR_MODULO,
  modulosDe,
  motivoDeExclusion,
  type Modulo,
} from "../config/ediciones";
import { prisma } from "../lib/prisma";
import { createProcesoDeVentaFijo } from "../repositories/organization.repository";
import { CAMPO_NO_INCLUIDO, MODULO_NO_INCLUIDO } from "../middlewares/moduloDeLaEdicion";
import {
  borrarOrgDePrueba,
  concreta,
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "./gateDeModulos.test-helper";

// ---------------------------------------------------------------------------
// Gate de módulos por edición y por rubro contra LA APP REAL
// (docs/ediciones.md §5.4 punto 2, docs/rubros.md §14.2 punto 2), al estilo de
// los tests de aislamiento: cuatro organizaciones (COMPLETA y ESENCIAL,
// AUTOMOTORA y CLINICA) con usuarios reales de Supabase Auth. Las CLINICA se
// crean directo con Prisma: hasta R3 no hay ruta que las cree.
//
// LOS CASOS SALEN DEL CATÁLOGO (RUTAS_POR_MODULO y modulosDe), no de una
// lista a mano:
//   - COMPLETA + AUTOMOTORA: TODAS las rutas del catálogo, ninguna da
//     MODULO_NO_INCLUIDO (el gate es un no-op para las organizaciones de hoy);
//   - cualquier otra combinación: cada ruta de un módulo excluido da 403
//     MODULO_NO_INCLUIDO con su módulo y el motivo de motivoDeExclusion, y
//     cada ruta de un módulo incluido no lo da.
//
// Para no producir efectos, cada pedido usa UUIDs inventados en el path y,
// si no es GET, un body JSON que es un ARRAY: todo schema de objeto lo
// rechaza con 400 antes de tocar nada, y el gate corre antes (dentro de
// authenticate). Lo que se afirma es lo que decide el gate, no la respuesta
// del handler: un 400, 404 o 429 de después cuenta como "respondió normal".
//
// Además: el orden 401 → 403 (sin sesión sigue siendo 401), los bloqueos por
// campo, /api/me con edition, industry y modulos, y que en ESENCIAL una
// oportunidad se marca Vendida o Perdida sin que el cliente llame a
// /pipelines ni /stages.
// ---------------------------------------------------------------------------

// Usuarios por organización, rotando: el barrido hace más de 100 escrituras y
// businessWriteRateLimiter es por usuario.
const USUARIOS_POR_ORG = 3;

let completa: OrgDePrueba;
let esencial: OrgDePrueba;
let clinicaCompleta: OrgDePrueba;
let clinicaEsencial: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);

before(async () => {
  ({ baseUrl, cerrar } = await levantarApp());
  completa = await crearOrgDePrueba("ediciones", "COMPLETA", "AUTOMOTORA", USUARIOS_POR_ORG);
  esencial = await crearOrgDePrueba("ediciones", "ESENCIAL", "AUTOMOTORA", USUARIOS_POR_ORG);
  clinicaCompleta = await crearOrgDePrueba("ediciones", "COMPLETA", "CLINICA", USUARIOS_POR_ORG);
  clinicaEsencial = await crearOrgDePrueba("ediciones", "ESENCIAL", "CLINICA", USUARIOS_POR_ORG);
});

after(async () => {
  if (cerrar) await cerrar();
  for (const org of [completa, esencial, clinicaCompleta, clinicaEsencial]) {
    await borrarOrgDePrueba(org);
  }
});

const esDelGate = (r: { status: number; json: { error?: Record<string, unknown> } }) =>
  r.status === 403 && r.json.error?.code === MODULO_NO_INCLUIDO;

async function barrer(
  org: OrgDePrueba,
): Promise<{ ruta: string; modulo: Modulo; bloqueada: boolean }[]> {
  const salida: { ruta: string; modulo: Modulo; bloqueada: boolean }[] = [];
  for (const modulo of MODULOS) {
    for (const ruta of RUTAS_POR_MODULO[modulo]) {
      const { metodo, path } = concreta(ruta);
      const r = await pedir(org, metodo, path, metodo === "GET" ? undefined : []);
      if (esDelGate(r)) {
        assert.equal(r.json.error?.modulo, modulo, `${ruta}: el 403 nombra otro módulo`);
        assert.equal(
          r.json.error?.motivo,
          motivoDeExclusion(modulo, org.industry),
          `${ruta}: el 403 da otro motivo`,
        );
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
  const incluidos = modulosDe("ESENCIAL", "AUTOMOTORA");
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

// Edición × rubro: las dos clínicas, con los casos generados de modulosDe.
for (const [nombre, org] of [
  ["COMPLETA + CLINICA", () => clinicaCompleta],
  ["ESENCIAL + CLINICA", () => clinicaEsencial],
] as const) {
  test(`${nombre}: cada ruta da 403 exactamente si su módulo no está en modulosDe, con su motivo`, async () => {
    const laOrg = org();
    const resultado = await barrer(laOrg);
    assert.equal(resultado.length, TOTAL_DEL_CATALOGO);
    const incluidos = modulosDe(laOrg.edition, laOrg.industry);
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
    // El stock y sync-vehicles quedan afuera por el rubro, en las dos
    // ediciones (docs/rubros.md §2).
    const stock = await pedir(laOrg, "GET", "/api/vehicles");
    assert.equal(stock.status, 403);
    assert.equal(stock.json.error?.motivo, "RUBRO");
    const sync = await pedir(laOrg, "POST", "/api/knowledge-base/sync-vehicles", []);
    assert.equal(sync.json.error?.modulo, "stock");
  });
}

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
  assert.equal(meCompleta.json.industry, "AUTOMOTORA");
  assert.deepEqual(meCompleta.json.modulos, [...MODULOS]);

  const meEsencial = await pedir(esencial, "GET", "/api/me");
  assert.equal(meEsencial.json.edition, "ESENCIAL");
  const modulos = meEsencial.json.modulos as string[];
  assert.ok(modulos.includes("oportunidades"));
  assert.ok(modulos.includes("dashboard_atencion"));
  assert.ok(!modulos.includes("cotizaciones"));
  assert.ok(!modulos.includes("procesos_de_venta"));

  // Las clínicas: los módulos de la combinación, en el orden del catálogo.
  for (const org of [clinicaCompleta, clinicaEsencial]) {
    const me = await pedir(org, "GET", "/api/me");
    assert.equal(me.status, 200);
    assert.equal(me.json.edition, org.edition);
    assert.equal(me.json.industry, "CLINICA");
    assert.deepEqual(
      me.json.modulos,
      MODULOS.filter((m) => modulosDe(org.edition, "CLINICA").has(m)),
    );
    assert.ok(!(me.json.modulos as string[]).includes("stock"));
  }
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

test("bloqueos por campo del rubro: 400 CAMPO_NO_INCLUIDO con motivo RUBRO en CLINICA; una automotora no los ve", async () => {
  const idInventado = randomUUID();
  const casos: [string, string, Record<string, unknown>, string][] = [
    [
      "PATCH",
      `/api/contacts/${randomUUID()}`,
      { vehicleOfInterestId: idInventado },
      "vehicleOfInterestId",
    ],
    [
      "POST",
      "/api/activities",
      { type: "NOTE", subject: "x", opportunityId: idInventado },
      "opportunityId",
    ],
    ["PATCH", `/api/activities/${randomUUID()}`, { opportunityId: idInventado }, "opportunityId"],
    [
      "POST",
      "/api/bookings",
      {
        resourceId: idInventado,
        serviceTypeId: idInventado,
        contactId: idInventado,
        opportunityId: idInventado,
        startsAt: "2030-01-01T10:00:00.000Z",
      },
      "opportunityId",
    ],
  ];
  for (const [metodo, path, body, campo] of casos) {
    for (const org of [clinicaCompleta, clinicaEsencial]) {
      const enClinica = await pedir(org, metodo, path, body);
      assert.equal(enClinica.status, 400, `${metodo} ${path} en ${org.edition}`);
      assert.equal(enClinica.json.error?.code, CAMPO_NO_INCLUIDO);
      assert.equal(enClinica.json.error?.campo, campo);
      assert.equal(enClinica.json.error?.motivo, "RUBRO");
    }
    for (const org of [completa, esencial]) {
      const enAutomotora = await pedir(org, metodo, path, body);
      assert.notEqual(
        enAutomotora.json.error?.code,
        CAMPO_NO_INCLUIDO,
        `${metodo} ${path} en ${org.edition} + AUTOMOTORA`,
      );
    }
  }
  // null es "desvincular": no se bloquea.
  const conNull = await pedir(clinicaEsencial, "PATCH", `/api/contacts/${randomUUID()}`, {
    vehicleOfInterestId: null,
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
  const aSubir = await crearOrgDePrueba("ediciones", "ESENCIAL", "AUTOMOTORA", USUARIOS_POR_ORG);
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
    await borrarOrgDePrueba(aSubir);
  }
});

// ---------------------------------------------------------------------------
// Paso B (docs/ediciones.md §10): crear oportunidades sin proceso de venta.
// Obligatorio por §5.4: en ESENCIAL se crea sin pipelineId ni stageId y nace
// en "En curso" del proceso fijo; esos dos campos dan 400 CAMPO_NO_INCLUIDO.
// COMPLETA no cambia: sin pipelineId sigue siendo 400 de validación.
// ---------------------------------------------------------------------------

test("ESENCIAL crea una oportunidad sin pipelineId ni stageId: nace en «En curso» del proceso fijo", async () => {
  const org = await crearOrgDePrueba("ediciones", "ESENCIAL", "AUTOMOTORA", 1);
  try {
    await createProcesoDeVentaFijo(org.id, prisma);
    const contacto = await prisma.contact.create({
      data: { organizationId: org.id, firstName: "Ana", lastName: "Pérez" },
    });

    const creada = await pedir(org, "POST", "/api/opportunities", {
      title: "Hilux SRV 2021",
      contactId: contacto.id,
    });
    assert.equal(creada.status, 201, JSON.stringify(creada.json));
    const fila = await prisma.opportunity.findUniqueOrThrow({
      where: { id: creada.json.id as string },
      include: { stage: true, pipeline: true },
    });
    assert.equal(fila.status, "OPEN");
    assert.equal(fila.stage.name, "En curso");
    assert.equal(fila.pipeline.name, PROCESO_DE_VENTA_FIJO.name);

    // Nace vendida si el cuerpo lo pide (ítem 154): la etapa ganada del fijo.
    const vendida = await pedir(org, "POST", "/api/opportunities", {
      title: "Corolla 2020",
      contactId: contacto.id,
      status: "WON",
    });
    assert.equal(vendida.status, 201, JSON.stringify(vendida.json));
    const filaVendida = await prisma.opportunity.findUniqueOrThrow({
      where: { id: vendida.json.id as string },
      include: { stage: true },
    });
    assert.equal(filaVendida.stage.name, "Vendida");

    const perdida = await pedir(org, "POST", "/api/opportunities", {
      title: "Etios 2019",
      contactId: contacto.id,
      status: "LOST",
      lostReason: "Compró en otro lado",
    });
    assert.equal(perdida.status, 201, JSON.stringify(perdida.json));
    const filaPerdida = await prisma.opportunity.findUniqueOrThrow({
      where: { id: perdida.json.id as string },
      include: { stage: true },
    });
    assert.equal(filaPerdida.stage.name, "Perdida");

    // pipelineId y stageId son de procesos_de_venta: 400 CAMPO_NO_INCLUIDO.
    for (const [metodo, path, campo] of [
      ["POST", "/api/opportunities", "pipelineId"],
      ["POST", "/api/opportunities", "stageId"],
      ["PATCH", `/api/opportunities/${fila.id}`, "stageId"],
    ] as const) {
      const r = await pedir(org, metodo, path, {
        title: "x",
        contactId: contacto.id,
        [campo]: fila.stageId,
      });
      assert.equal(r.status, 400, `${metodo} ${path} con ${campo}`);
      assert.equal(r.json.error?.code, CAMPO_NO_INCLUIDO);
      assert.equal(r.json.error?.campo, campo);
    }
  } finally {
    await borrarOrgDePrueba(org);
  }
});

test("ESENCIAL sin su proceso de venta: 409 claro, sin crear nada", async () => {
  const org = await crearOrgDePrueba("ediciones", "ESENCIAL", "AUTOMOTORA", 1);
  try {
    const contacto = await prisma.contact.create({
      data: { organizationId: org.id, firstName: "Ana", lastName: "Pérez" },
    });
    const r = await pedir(org, "POST", "/api/opportunities", {
      title: "Hilux",
      contactId: contacto.id,
    });
    assert.equal(r.status, 409);
    assert.match(String(r.json.error?.message), /no tiene su proceso de venta/);
    assert.equal(await prisma.opportunity.count({ where: { organizationId: org.id } }), 0);
  } finally {
    await borrarOrgDePrueba(org);
  }
});

test("COMPLETA no cambia: sin pipelineId es 400 de validación; con pipelineId y stageId crea como siempre", async () => {
  const contacto = await prisma.contact.create({
    data: { organizationId: completa.id, firstName: "Ana", lastName: "Pérez" },
  });
  const sinProceso = await pedir(completa, "POST", "/api/opportunities", {
    title: "Hilux",
    contactId: contacto.id,
  });
  assert.equal(sinProceso.status, 400);
  assert.notEqual(sinProceso.json.error?.code, CAMPO_NO_INCLUIDO);

  const pipeline = await prisma.pipeline.create({
    data: { organizationId: completa.id, name: `Propio ${randomUUID().slice(0, 8)}` },
  });
  const etapa = await prisma.stage.create({
    data: { organizationId: completa.id, pipelineId: pipeline.id, name: "Nuevo", order: 1 },
  });
  const conProceso = await pedir(completa, "POST", "/api/opportunities", {
    title: "Hilux",
    contactId: contacto.id,
    pipelineId: pipeline.id,
    stageId: etapa.id,
  });
  assert.equal(conProceso.status, 201, JSON.stringify(conProceso.json));
});
