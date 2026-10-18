// Primero: el contador tiene que quedar como singleton antes de lib/prisma.
import { contarConsultas } from "../lib/contarConsultas.test-helper";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { cargarDatosDeEjemplo } from "../automotora/demo/datosDeEjemplo";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { prisma } from "../lib/prisma";
import { registroDeAcciones } from "../services/automationActions";
import { ACCIONES_INCORPORADAS } from "../services/automationRegistrations";
import { activarModulo } from "../services/organizationModules.service";
import { ejecutarPurga } from "../services/testOrganizationsPurge.service";
import {
  resumenDelTaller,
  resumenDelTallerConPrisma,
} from "../servicios/services/dashboard.service";
import {
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "./gateDeModulos.test-helper";

// ---------------------------------------------------------------------------
// El Dashboard, pedido por pedido, sobre los datos del Taller Demo: cuántos
// pedidos hace el navegador al entrar y cuántas consultas SQL cuesta cada uno
// (autenticación incluida). En producción cada consulta es una ida y vuelta
// de ~100-350 ms y los pedidos compiten por el pool: el ensayo del 2026-10-17
// midió 9-11 s para la pantalla, con 31 pedidos y 157 consultas (medidas con
// este mismo test sobre master). Los topes son el presupuesto: si una mejora
// los baja, se bajan; si un cambio los sube, que sea a conciencia.
//
// El segundo test comprueba que los pedidos nuevos dan lo mismo que los de
// antes (que siguen existiendo: el listado de stock, el de oportunidades y
// las fichas los usan).
// ---------------------------------------------------------------------------

let org: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);
const medidas: { pedido: string; consultas: number; tope: number }[] = [];

async function get(pedido: string): Promise<Record<string, unknown>> {
  const r = await pedir(org, "GET", pedido, undefined, org.tokens[0]);
  assert.equal(r.status, 200, `${pedido}: ${JSON.stringify(r.json)}`);
  return r.json as Record<string, unknown>;
}

async function medir(pedido: string, tope: number): Promise<Record<string, unknown>> {
  const { resultado, consultas } = await contarConsultas(() => get(pedido));
  medidas.push({ pedido, consultas: consultas.length, tope });
  const detalle = process.env.CONSULTAS_DETALLE;
  if (detalle && pedido.includes(detalle)) console.log(consultas.join("\n"));
  assert.ok(
    consultas.length <= tope,
    `${pedido}: ${consultas.length} consultas, el presupuesto es ${tope}`,
  );
  return resultado;
}

before(async () => {
  ({ baseUrl, cerrar } = await levantarApp());
  for (const accion of ACCIONES_INCORPORADAS) registroDeAcciones.registrar(accion);
  org = await crearOrgDePrueba("dashboard-consultas", "COMPLETA", "AUTOMOTORA", 1);
  await prisma.organization.update({
    where: { id: org.id },
    data: { isDemo: true, timezone: "America/Montevideo", preferredCurrency: "USD" },
  });
  await activarModulo(org.id, "servicios", org.authIds[0]);
  const u = org.authIds[0];
  await cargarDatosDeEjemplo(org.id, { admin: u, vendedor: u, taller: u });
});

after(async () => {
  if (medidas.length > 0) {
    console.log("\nDashboard: consultas SQL por pedido (tope)");
    for (const m of medidas) {
      console.log(
        `  ${String(m.consultas).padStart(3)} (${String(m.tope).padStart(2)})  ${m.pedido}`,
      );
    }
    const total = medidas.reduce((n, m) => n + m.consultas, 0);
    console.log(`  ${String(total).padStart(3)}       TOTAL en ${medidas.length} pedidos`);
  }
  if (cerrar) await cerrar();
  if (org) {
    const { resultados } = await ejecutarPurga(prisma, {
      protegidas: [],
      alcance: { organizaciones: [org.id], identidades: [] },
    });
    assert.deepEqual(
      resultados.filter((r) => !r.ok),
      [],
      "la limpieza de la organización de test falló",
    );
    for (const id of org.authIds) await getSupabaseAdmin().auth.admin.deleteUser(id);
  }
});

test("el Dashboard entero, pedido por pedido (como lo pide el navegador)", async () => {
  await medir("/api/me", 3);
  await medir("/api/vehicles/summary", 2);
  await medir("/api/servicios/dashboard", 8);
  await medir("/api/dashboard/atencion?granularity=month", 8);
  const resumen = await medir("/api/opportunities/dashboard-summary?granularity=month", 14);
  await medir("/api/opportunities/revenue-series?granularity=month", 8);
  await medir("/api/opportunities/stage-counts", 4);
  await medir("/api/opportunities?sortBy=createdAt&sortOrder=desc&pageSize=5", 6);
  await medir(
    `/api/opportunities?status=OPEN&currency=${String(resumen.currency)}&sortBy=amount&sortOrder=desc&pageSize=5`,
    6,
  );
  await medir("/api/activities?sortBy=occurredAt&sortOrder=desc&pageSize=8", 5);
  await medir("/api/users?pageSize=100&isActive=true&sortBy=fullName&sortOrder=asc", 4);

  assert.equal(medidas.length, 11, "pedidos del Dashboard (eran 31)");
  const total = medidas.reduce((n, m) => n + m.consultas, 0);
  assert.ok(total <= 68, `${total} consultas en total (eran 157)`);
});

test("los pedidos nuevos dan lo mismo que los de antes", async () => {
  // Stock: los dos totales de GET /vehicles con pageSize=1.
  const total = async (pedido: string) =>
    ((await get(pedido)) as { pagination: { total: number } }).pagination.total;
  assert.deepEqual(await get("/api/vehicles/summary"), {
    inStock: await total("/api/vehicles?pageSize=1"),
    available: await total("/api/vehicles?pageSize=1&status=AVAILABLE"),
  });

  // Proceso de venta: procesos → etapas del de por defecto → un conteo por etapa.
  const conteos = (await get("/api/opportunities/stage-counts")) as {
    pipeline: { id: string; name: string };
    stages: { id: string; name: string; order: number; total: number }[];
  };
  const procesos = (await get("/api/pipelines?pageSize=100")) as {
    data: { id: string; name: string; isDefault: boolean }[];
  };
  const porDefecto = procesos.data.find((p) => p.isDefault);
  assert.ok(porDefecto);
  assert.deepEqual(conteos.pipeline, { id: porDefecto.id, name: porDefecto.name });
  const etapas = (await get(
    `/api/stages?pipelineId=${porDefecto.id}&pageSize=100&sortBy=order&sortOrder=asc`,
  )) as { data: { id: string; name: string; order: number }[] };
  const antes: { id: string; name: string; order: number; total: number }[] = [];
  for (const e of etapas.data) {
    antes.push({
      id: e.id,
      name: e.name,
      order: e.order,
      total: await total(
        `/api/opportunities?pipelineId=${porDefecto.id}&stageId=${e.id}&pageSize=1`,
      ),
    });
  }
  assert.deepEqual(conteos.stages, antes);
  assert.ok(
    antes.some((e) => e.total > 0),
    "el Taller Demo tiene oportunidades en el embudo",
  );

  // Actividad reciente: los nombres de la fila son los del GET por id.
  const actividades = (await get(
    "/api/activities?sortBy=occurredAt&sortOrder=desc&pageSize=8",
  )) as {
    data: {
      contactId: string | null;
      opportunityId: string | null;
      contact: { id: string; firstName: string; lastName: string } | null;
      opportunity: { id: string; title: string } | null;
    }[];
  };
  let conNombres = 0;
  for (const a of actividades.data) {
    if (a.contactId) {
      const c = (await get(`/api/contacts/${a.contactId}`)) as {
        firstName: string;
        lastName: string;
      };
      assert.deepEqual(a.contact, {
        id: a.contactId,
        firstName: c.firstName,
        lastName: c.lastName,
      });
      conNombres++;
    } else {
      assert.equal(a.contact, null);
    }
    if (a.opportunityId) {
      const o = (await get(`/api/opportunities/${a.opportunityId}`)) as { title: string };
      assert.deepEqual(a.opportunity, { id: a.opportunityId, title: o.title });
      conNombres++;
    } else {
      assert.equal(a.opportunity, null);
    }
  }
  assert.ok(
    conNombres > 0,
    "la actividad reciente del Taller Demo tiene contactos y oportunidades",
  );

  // Resumen del taller: la lectura nueva y la de Prisma, campo por campo.
  const actor = { role: "ADMIN" as const, industry: "AUTOMOTORA" as const };
  assert.deepStrictEqual(
    await resumenDelTaller(org.id, actor),
    await resumenDelTallerConPrisma(org.id, actor),
  );
});
