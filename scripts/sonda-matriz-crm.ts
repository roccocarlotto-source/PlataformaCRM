import "dotenv/config";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { app } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { getSupabaseAdmin } from "../src/lib/supabaseAdmin";
import { findRoleByName } from "../src/repositories/role.repository";
import { CATALOGO_DE_TOOLS } from "../src/services/agentTools.service";
import { createBranch } from "../src/services/branch.service";

// ---------------------------------------------------------------------------
// Sonda de la matriz de estados del CRM — paso 1 de docs/matriz-de-datos-crm.md.
//
// NO ES UN TEST y no afirma nada: siembra cada combinación candidata a
// contradictoria por los dos caminos (SQL directo contra la base y HTTP contra
// la API real, con un JWT real del GoTrue local) y ANOTA qué pasó y qué muestra
// el sistema después. La tabla del documento sale de esta salida, no de leer el
// código. Decidir cuáles son bugs es trabajo de quien lee la tabla.
//
// SOLO CONTRA UNA BASE LOCAL: crea organizaciones, usuarios de Supabase Auth y
// filas de todo tipo, y las borra al final. Se niega a correr si DATABASE_URL
// no apunta a 127.0.0.1/localhost.
//
// Lo único que lee del agente es la SALIDA de search_vehicles (qué ve el
// modelo de una unidad), invocando la tool tal cual. No modifica nada de esa
// capa.
//
//   npx tsx scripts/sonda-matriz-crm.ts            → tabla en markdown
//   npx tsx scripts/sonda-matriz-crm.ts --json     → las celdas en JSON
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env.DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DATABASE_URL)) {
  console.error(
    "sonda-matriz-crm: DATABASE_URL no es local. Esta sonda solo corre contra Supabase local.",
  );
  process.exit(1);
}

const TZ = "America/Montevideo";

interface Celda {
  id: string;
  entidad: string;
  combinacion: string;
  base: string;
  api: string;
  despues: string;
}

const celdas: Celda[] = [];
function anotar(celda: Celda) {
  celdas.push(celda);
  if (!process.argv.includes("--json")) {
    process.stderr.write(`· ${celda.id} listo\n`);
  }
}

// ---------------------------------------------------------------------------
// Escenario: organización + sucursal + ADMIN con usuario real de GoTrue y su
// access token. Uno por grupo de celdas, para no chocar con el limiter de
// escrituras (100/min por usuario) ni mezclar estados entre celdas.
// ---------------------------------------------------------------------------

interface Escenario {
  organizationId: string;
  branchId: string;
  userId: string;
  token: string;
}

const escenarios: Escenario[] = [];
let baseUrl = "";

async function montar(etiqueta: string): Promise<Escenario> {
  const adminRole = await findRoleByName("ADMIN");
  if (!adminRole) throw new Error("Falta el rol ADMIN: correr npm run prisma:seed");
  const org = await prisma.organization.create({
    data: {
      name: `Matriz ${etiqueta}`,
      slug: `matriz-${etiqueta}-${randomUUID().slice(0, 8)}`,
      preferredCurrency: "UYU",
    },
  });
  const branch = await createBranch(org.id, { name: "Casa central", timezone: TZ });
  const email = `matriz-${etiqueta}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `Pw-${randomUUID()}`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  await prisma.user.create({
    data: {
      id: data.user.id,
      organizationId: org.id,
      roleId: adminRole.id,
      email,
      fullName: `Admin ${etiqueta}`,
    },
  });
  const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const sesion = await anon.auth.signInWithPassword({ email, password });
  if (sesion.error || !sesion.data.session) throw new Error(`signIn: ${sesion.error?.message}`);
  const e = {
    organizationId: org.id,
    branchId: branch.id,
    userId: data.user.id,
    token: sesion.data.session.access_token,
  };
  escenarios.push(e);
  return e;
}

async function desmontar(e: Escenario) {
  const org = { organizationId: e.organizationId };
  await prisma.knowledgeBaseEntry.deleteMany({ where: org });
  await prisma.delivery.deleteMany({ where: org });
  await prisma.vehiclePhoto.deleteMany({ where: org });
  await prisma.vehicleChangeLog.deleteMany({ where: org });
  await prisma.$executeRawUnsafe(
    `update vehicles set trade_in_opportunity_id = null where organization_id = $1::uuid`,
    e.organizationId,
  );
  await prisma.opportunity.deleteMany({ where: org });
  await prisma.vehicle.deleteMany({ where: org });
  await prisma.stage.deleteMany({ where: org });
  await prisma.pipeline.deleteMany({ where: org });
  await prisma.contact.deleteMany({ where: org });
  await prisma.company.deleteMany({ where: org });
  await prisma.outboxEvent.deleteMany({ where: org });
  await prisma.branch.deleteMany({ where: org });
  await prisma.user.deleteMany({ where: org });
  await prisma.organization.delete({ where: { id: e.organizationId } });
  await getSupabaseAdmin().auth.admin.deleteUser(e.userId);
}

// ---------------------------------------------------------------------------
// Los dos caminos
// ---------------------------------------------------------------------------

interface Respuesta {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

async function api(e: Escenario, method: string, path: string, body?: unknown): Promise<Respuesta> {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      authorization: `Bearer ${e.token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // texto plano
  }
  return { status: res.status, body: parsed };
}

async function ok(e: Escenario, method: string, path: string, body?: unknown) {
  const r = await api(e, method, path, body);
  if (r.status >= 300) {
    throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  }
  return r.body;
}

// "201" / "422 (faltan priceListUsd)" — lo que la API contestó, corto.
function codigo(r: Respuesta): string {
  if (r.status < 300) return String(r.status);
  const msg =
    (r.body && typeof r.body === "object" && (r.body.error?.message ?? r.body.message)) ||
    JSON.stringify(r.body);
  return `${r.status} (${String(msg).slice(0, 110)})`;
}

// SQL directo: ¿la base la acepta? Devuelve "acepta" o "rechaza (<constraint>)".
async function sql(query: string, ...params: unknown[]): Promise<string> {
  try {
    await prisma.$executeRawUnsafe(query, ...params);
    return "acepta";
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    const constraint = /constraint "([^"]+)"/.exec(msg)?.[1] ?? /Key \(([^)]+)\)/.exec(msg)?.[1];
    if (/Code: `23505`/.test(msg)) return `rechaza (UNIQUE sobre ${constraint ?? "?"})`;
    return `rechaza (${constraint ?? msg.split("\n").find((l) => l.includes("ERROR")) ?? msg.slice(0, 80)})`;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const COMPLETO_USADO = {
  condition: "USED",
  make: "Toyota",
  model: "Corolla",
  year: 2022,
  bodyType: "SEDAN",
  priceListUsd: 25000,
  priceListLocal: 1000000,
  transmission: "CVT",
  fuelType: "GASOLINE",
  exteriorColor: "Blanco",
  mileage: 45000,
  titleHolder: "Juan Pérez",
};

let vinSeq = 0;
function identificadores() {
  vinSeq++;
  return {
    vin: `9BR53ZEC2P${String(vinSeq).padStart(7, "0")}`,
    licensePlate: `SND${String(vinSeq).padStart(4, "0")}`,
  };
}

async function vehiculo(e: Escenario, extra: Record<string, unknown> = {}) {
  return ok(e, "POST", "/vehicles", {
    ...COMPLETO_USADO,
    ...identificadores(),
    branchId: e.branchId,
    ...extra,
  });
}

// Una foto sin Storage (la regla de publicar cuenta filas, no bytes).
async function foto(e: Escenario, vehicleId: string) {
  await prisma.vehiclePhoto.create({
    data: {
      organizationId: e.organizationId,
      vehicleId,
      storagePath: `${e.organizationId}/${vehicleId}/${randomUUID()}.jpg`,
      position: 0,
      isCover: true,
    },
  });
}

async function publicado(e: Escenario, extra: Record<string, unknown> = {}) {
  const v = await vehiculo(e, extra);
  await foto(e, v.id);
  await ok(e, "PATCH", `/vehicles/${v.id}`, { publishOnWebsite: true });
  return v;
}

async function estadoVehiculo(e: Escenario, id: string) {
  const r = await api(e, "GET", `/vehicles/${id}`);
  return r.status === 200 ? (r.body.status as string) : `GET ${r.status}`;
}

// Lo que el agente ve: la salida real de search_vehicles, sin filtros.
async function loQueVeElAgente(e: Escenario, args: Record<string, unknown> = {}) {
  const tool = CATALOGO_DE_TOOLS.get("search_vehicles");
  if (!tool) throw new Error("search_vehicles no está en el catálogo");
  const r = await tool.ejecutar(args, {
    organizationId: e.organizationId,
    conversation: {
      id: randomUUID(),
      contactId: randomUUID(),
      branchId: e.branchId,
      agentId: randomUUID(),
    },
  });
  if (!r.ok) return { total: -1, vehiculos: [] as Array<Record<string, unknown>> };
  const data = r.data as { total: number; vehiculos?: Array<Record<string, unknown>> };
  return { total: data.total, vehiculos: data.vehiculos ?? [] };
}

async function entradaKb(e: Escenario, vehicleId: string) {
  const entrada = await prisma.knowledgeBaseEntry.findFirst({
    where: { organizationId: e.organizationId, sourceVehicleId: vehicleId },
  });
  if (!entrada) return "sin entrada";
  if (entrada.deletedAt) return "entrada dada de baja";
  return `entrada viva (isActive=${entrada.isActive})`;
}

async function pipelineConEtapas(
  e: Escenario,
  nombre: string,
  etapas: Array<{ name: string; isWon?: boolean; isLost?: boolean }>,
  isDefault = false,
) {
  const p = await ok(e, "POST", "/pipelines", { name: nombre, isDefault });
  const creadas: Array<{ id: string; name: string }> = [];
  for (const etapa of etapas) {
    creadas.push(await ok(e, "POST", "/stages", { pipelineId: p.id, ...etapa }));
  }
  return { pipeline: p, etapas: creadas };
}

async function contacto(e: Escenario, extra: Record<string, unknown> = {}) {
  return ok(e, "POST", "/contacts", {
    firstName: "Ana",
    lastName: `Prueba ${randomUUID().slice(0, 4)}`,
    email: `ana-${randomUUID().slice(0, 8)}@example.test`,
    ...extra,
  });
}

async function resumen(e: Escenario) {
  return ok(e, "GET", "/opportunities/dashboard-summary?granularity=month");
}

// ===========================================================================
// VEHICLE
// ===========================================================================

async function celdasVehicle() {
  const e = await montar("veh");

  // V1 — priceOnRequest con priceListUsd cargado.
  {
    const v = await publicado(e, { priceOnRequest: true });
    await ok(e, "POST", "/knowledge-base/sync-vehicles", { branchId: e.branchId });
    const kb = await prisma.knowledgeBaseEntry.findFirst({ where: { sourceVehicleId: v.id } });
    const agente = await loQueVeElAgente(e);
    const visto = agente.vehiculos.find((x) => x.id === v.id);
    const listado = await ok(e, "GET", `/vehicles/${v.id}`);
    const bajo = await loQueVeElAgente(e, { priceMaxUsd: 24000 });
    const alto = await loQueVeElAgente(e, { priceMaxUsd: 26000 });
    const entra = (r: { vehiculos: Array<Record<string, unknown>> }) =>
      r.vehiculos.some((x) => x.id === v.id) ? "la devuelve" : "no la devuelve";
    anotar({
      id: "V1",
      entidad: "Vehicle",
      combinacion: "priceOnRequest=true + priceListUsd cargado, publicada",
      base: await sql(
        `update vehicles set price_on_request = true, price_list_usd = 1 where id = $1::uuid`,
        v.id,
      ),
      api: "201 + PATCH 200 (publicar)",
      despues:
        `KB: ${kb?.content.includes("a consultar") ? '"Precio: a consultar", sin número' : "muestra el número"}. ` +
        `search_vehicles le pasa al modelo priceListUsd=${JSON.stringify(visto?.priceListUsd)} y priceOnRequest=${JSON.stringify(visto?.priceOnRequest)}. ` +
        `Con priceMaxUsd=24000 ${entra(bajo)}, con 26000 ${entra(alto)}: el filtro por precio acota el número oculto. ` +
        `GET /vehicles/:id (interno) trae priceListUsd=${listado.priceListUsd}, que es lo esperable en la vista interna.`,
    });
    await sql(`update vehicles set publish_on_website = false where id = $1::uuid`, v.id);
  }

  // V2 — USD_ONLY sin priceListUsd, publicada.
  {
    const v = await vehiculo(e, { publicationCurrency: "USD_ONLY", priceListUsd: null });
    await foto(e, v.id);
    const intento = await api(e, "PATCH", `/vehicles/${v.id}`, { publishOnWebsite: true });
    const base = await sql(
      `update vehicles set publish_on_website = true where id = $1::uuid`,
      v.id,
    );
    await ok(e, "POST", "/knowledge-base/sync-vehicles", { branchId: e.branchId });
    const kb = await prisma.knowledgeBaseEntry.findFirst({ where: { sourceVehicleId: v.id } });
    const agente = await loQueVeElAgente(e);
    const visto = agente.vehiculos.find((x) => x.id === v.id);
    anotar({
      id: "V2",
      entidad: "Vehicle",
      combinacion: "publicationCurrency=USD_ONLY + priceListUsd null, publicada",
      base,
      api: codigo(intento),
      despues:
        `Si entra por la base: KB ${kb ? "genera la entrada" : "no genera entrada"}` +
        `${kb && !/Precio de lista/.test(kb.content) ? " SIN ninguna línea de precio" : ""}` +
        `; search_vehicles la devuelve con priceListUsd=${JSON.stringify(visto?.priceListUsd)}, priceListLocal=${JSON.stringify(visto?.priceListLocal)}, priceOnRequest=${JSON.stringify(visto?.priceOnRequest)}.`,
    });
    await sql(`update vehicles set publish_on_website = false where id = $1::uuid`, v.id);
  }

  // V2b — la celda LEGAL que la API rechaza: USD_ONLY con USD cargado y sin local.
  {
    const v = await vehiculo(e, { publicationCurrency: "USD_ONLY", priceListLocal: null });
    await foto(e, v.id);
    const intento = await api(e, "PATCH", `/vehicles/${v.id}`, { publishOnWebsite: true });
    const v2 = await vehiculo(e, { publicationCurrency: "LOCAL_ONLY", priceListUsd: null });
    await foto(e, v2.id);
    const intento2 = await api(e, "PATCH", `/vehicles/${v2.id}`, { publishOnWebsite: true });
    anotar({
      id: "V2b",
      entidad: "Vehicle",
      combinacion: "USD_ONLY + solo priceListUsd (o LOCAL_ONLY + solo priceListLocal), publicar",
      base: "acepta (no hay CHECK de precios)",
      api: `USD_ONLY: ${codigo(intento)} · LOCAL_ONLY: ${codigo(intento2)}`,
      despues:
        "Es el caso inverso: una combinación coherente que la API NO deja publicar, porque PUBLISH_REQUIRED_FIELDS exige los dos precios sin mirar publicationCurrency.",
    });
  }

  // V3 — SOLD / DELIVERED con publishOnWebsite=true.
  {
    const v = await publicado(e);
    await ok(e, "POST", "/knowledge-base/sync-vehicles", { branchId: e.branchId });
    const antes = await entradaKb(e, v.id);
    const patch = await api(e, "PATCH", `/vehicles/${v.id}`, { status: "SOLD" });
    const kbSinSync = await entradaKb(e, v.id);
    const agente = await loQueVeElAgente(e);
    await ok(e, "POST", "/knowledge-base/sync-vehicles", { branchId: e.branchId });
    const kbConSync = await entradaKb(e, v.id);
    const detalle = await ok(e, "GET", `/vehicles/${v.id}`);
    const patchDel = await api(e, "PATCH", `/vehicles/${v.id}`, { status: "DELIVERED" });
    anotar({
      id: "V3",
      entidad: "Vehicle",
      combinacion: "status SOLD o DELIVERED + publishOnWebsite=true",
      base: await sql(
        `update vehicles set status = 'DELIVERED', publish_on_website = true where id = $1::uuid`,
        v.id,
      ),
      api: `PATCH status=SOLD: ${codigo(patch)} · status=DELIVERED: ${codigo(patchDel)}`,
      despues:
        `publishOnWebsite sigue en ${detalle.publishOnWebsite}. search_vehicles: ${agente.vehiculos.some((x) => x.id === v.id) ? "LA SIGUE OFRECIENDO" : "no la devuelve (filtra AVAILABLE)"}. ` +
        `KB: antes de vender "${antes}"; vendida y sin re-sincronizar "${kbSinSync}"; después del sync "${kbConSync}". ` +
        "No hay sitio público todavía (Fase 3): hoy los canales hacia afuera son el agente y la KB.",
    });
  }

  // V4 — RESERVED sin oportunidad que lo reserve.
  {
    const v = await publicado(e);
    const patch = await api(e, "PATCH", `/vehicles/${v.id}`, { status: "RESERVED" });
    const contactoA = await contacto(e);
    const { pipeline, etapas } = await pipelineConEtapas(e, "Ventas V4", [{ name: "Nuevo" }], true);
    const vincular = await api(e, "POST", "/opportunities", {
      title: "Quiere el Corolla",
      contactId: contactoA.id,
      pipelineId: pipeline.id,
      stageId: etapas[0].id,
      vehicleId: v.id,
    });
    const agente = await loQueVeElAgente(e);
    const abiertas = await prisma.opportunity.count({
      where: { vehicleId: v.id, status: "OPEN", deletedAt: null },
    });
    anotar({
      id: "V4",
      entidad: "Vehicle ↔ Opportunity",
      combinacion: "status RESERVED sin ninguna oportunidad abierta que la tenga vinculada",
      base: "acepta (no hay vínculo en la base: la reserva se infiere de Opportunity.vehicleId)",
      api: `PATCH status=RESERVED: ${codigo(patch)}`,
      despues:
        `Oportunidades abiertas que la reservan: ${abiertas}. Vincularla a una oportunidad nueva: ${codigo(vincular)}. ` +
        `search_vehicles: ${agente.vehiculos.some((x) => x.id === v.id) ? "la ofrece" : "no la ofrece"}. ` +
        "Queda fuera de venta hasta que alguien la vuelva a AVAILABLE a mano; nada lo avisa.",
    });
  }

  // V4b — al revés: la oportunidad la reserva y la unidad está AVAILABLE.
  {
    const v = await publicado(e);
    const c = await contacto(e);
    const p = await ok(e, "GET", "/pipelines");
    const pipelineId = p.data[0].id;
    const etapa = (await ok(e, "GET", `/stages?pipelineId=${pipelineId}`)).data[0].id;
    const opp1 = await ok(e, "POST", "/opportunities", {
      title: "Primera",
      contactId: c.id,
      pipelineId,
      stageId: etapa,
      vehicleId: v.id,
    });
    const reservada = await estadoVehiculo(e, v.id);
    const patch = await api(e, "PATCH", `/vehicles/${v.id}`, { status: "AVAILABLE" });
    const opp2 = await api(e, "POST", "/opportunities", {
      title: "Segunda",
      contactId: c.id,
      pipelineId,
      stageId: etapa,
      vehicleId: v.id,
    });
    const abiertas = await prisma.opportunity.count({
      where: { vehicleId: v.id, status: "OPEN", deletedAt: null },
    });
    const ganar1 = await api(e, "PATCH", `/opportunities/${opp1.id}`, {
      status: "WON",
      actualCloseDate: "2026-09-23",
    });
    const tras = await estadoVehiculo(e, v.id);
    const opp2Estado =
      opp2.status < 300 ? (await ok(e, "GET", `/opportunities/${opp2.body.id}`)).status : "-";
    anotar({
      id: "V4b",
      entidad: "Vehicle ↔ Opportunity",
      combinacion: "oportunidad OPEN vinculada + unidad pasada a AVAILABLE a mano",
      base: "acepta",
      api: `Al vincular quedó ${reservada}; PATCH status=AVAILABLE: ${codigo(patch)}`,
      despues:
        `Una segunda oportunidad sobre la misma unidad: ${codigo(opp2)} → ${abiertas} oportunidades OPEN sobre una unidad. ` +
        `Ganar la primera: ${codigo(ganar1)}, la unidad queda ${tras} y la segunda sigue ${opp2Estado}.`,
    });
  }

  // V5 — visibleInListing=false.
  {
    const v = await vehiculo(e, { visibleInListing: false });
    const listado = await ok(e, "GET", "/vehicles?pageSize=100");
    const aparece = listado.data.some((x: { id: string }) => x.id === v.id);
    anotar({
      id: "V5",
      entidad: "Vehicle",
      combinacion: "visibleInListing=false",
      base: "acepta",
      api: "201",
      despues: `GET /vehicles (el listado interno) ${aparece ? "LA DEVUELVE IGUAL" : "no la devuelve"}: ningún filtro lee visibleInListing, en el backend ni en el frontend.`,
    });
  }

  // V6 — dar de baja una unidad reservada por una oportunidad abierta.
  {
    const v = await publicado(e);
    const c = await contacto(e);
    const p = await ok(e, "GET", "/pipelines");
    const pipelineId = p.data[0].id;
    const etapa = (await ok(e, "GET", `/stages?pipelineId=${pipelineId}`)).data[0].id;
    const opp = await ok(e, "POST", "/opportunities", {
      title: "Reserva",
      contactId: c.id,
      pipelineId,
      stageId: etapa,
      vehicleId: v.id,
    });
    const borrar = await api(e, "DELETE", `/vehicles/${v.id}`);
    const oppDespues = await ok(e, "GET", `/opportunities/${opp.id}`);
    const vGet = await api(e, "GET", `/vehicles/${v.id}`);
    const ganar = await api(e, "PATCH", `/opportunities/${opp.id}`, { status: "WON" });
    anotar({
      id: "V6",
      entidad: "Vehicle ↔ Opportunity",
      combinacion: "unidad dada de baja (deletedAt) con una oportunidad OPEN que la reserva",
      base: "acepta (FK NO ACTION, pero el borrado es lógico)",
      api: `DELETE /vehicles/:id: ${codigo(borrar)}`,
      despues:
        `La oportunidad sigue ${oppDespues.status} con vehicleId=${oppDespues.vehicleId ? "la unidad borrada" : "null"}; GET de la unidad: ${vGet.status}. ` +
        `Ganar esa oportunidad: ${codigo(ganar)}.`,
    });
  }

  return e;
}

// ===========================================================================
// OPPORTUNITY
// ===========================================================================

async function celdasOpportunity() {
  const e = await montar("opp");
  const { pipeline, etapas } = await pipelineConEtapas(
    e,
    "Ventas",
    [{ name: "Nuevo" }, { name: "Ganado", isWon: true }, { name: "Perdido", isLost: true }],
    true,
  );
  const [nuevo, ganado, perdido] = etapas;
  const c = await contacto(e);
  const base = { contactId: c.id, pipelineId: pipeline.id, amount: 1000, currency: "UYU" };
  const r0 = await resumen(e);

  // O1 — WON en una etapa que no es isWon.
  {
    const r = await api(e, "POST", "/opportunities", {
      ...base,
      title: "Ganada en Nuevo",
      stageId: nuevo.id,
      status: "WON",
      actualCloseDate: new Date().toISOString().slice(0, 10),
    });
    const tablero = await ok(e, "GET", `/opportunities?stageId=${nuevo.id}`);
    const r1 = await resumen(e);
    anotar({
      id: "O1",
      entidad: "Opportunity ↔ Stage",
      combinacion: "status WON parada en una etapa normal (ni isWon ni isLost)",
      base: "acepta (no hay relación entre status y stage en la base)",
      api: codigo(r),
      despues:
        `El embudo (agrupa por stageId) la muestra en la columna "Nuevo" (${tablero.pagination.total} en esa columna); ` +
        `el dashboard (suma por status) la cuenta como ganada: wonThisPeriod.count ${r0.wonThisPeriod.count} → ${r1.wonThisPeriod.count}.`,
    });
  }

  // O2 — WON sin actualCloseDate.
  {
    const antes = await resumen(e);
    const serieAntes = await ok(e, "GET", "/opportunities/revenue-series?granularity=month");
    const r = await api(e, "POST", "/opportunities", {
      ...base,
      title: "Ganada sin fecha",
      stageId: ganado.id,
      status: "WON",
    });
    const despues = await resumen(e);
    const serie = await ok(e, "GET", "/opportunities/revenue-series?granularity=month");
    const ultimo = (s: { points: Array<{ value: string }> }) => s.points[s.points.length - 1].value;
    anotar({
      id: "O2",
      entidad: "Opportunity",
      combinacion: "status WON con actualCloseDate null",
      base: "acepta",
      api: codigo(r),
      despues:
        `No existe para el dashboard: wonThisPeriod.count ${antes.wonThisPeriod.count} → ${despues.wonThisPeriod.count}, ` +
        `ingresos del mes ${ultimo(serieAntes)} → ${ultimo(serie)}. openCount tampoco la cuenta (no es OPEN). ` +
        "La fecha la pone solo el frontend (stageStatus.ts); la API, el agente y la importación no.",
    });
  }

  // O3 — OPEN en una etapa isWon / isLost.
  {
    const r = await api(e, "POST", "/opportunities", {
      ...base,
      title: "Abierta en Ganado",
      stageId: ganado.id,
    });
    const r2 = await api(e, "POST", "/opportunities", {
      ...base,
      title: "Abierta en Perdido",
      stageId: perdido.id,
    });
    const s = await resumen(e);
    anotar({
      id: "O3",
      entidad: "Opportunity ↔ Stage",
      combinacion: "status OPEN parada en una etapa isWon (o isLost)",
      base: "acepta",
      api: `en isWon: ${codigo(r)} · en isLost: ${codigo(r2)}`,
      despues: `El embudo la muestra en la columna de cierre; el dashboard la suma como abierta (openCount=${s.openCount}). Es el default del agente si la primera etapa del pipeline por defecto es de cierre (ver P6).`,
    });
  }

  // O4 — campos de cierre incoherentes con el status.
  {
    const lostSinMotivo = await api(e, "POST", "/opportunities", {
      ...base,
      title: "Perdida sin motivo",
      stageId: perdido.id,
      status: "LOST",
    });
    const openConCierre = await api(e, "POST", "/opportunities", {
      ...base,
      title: "Abierta con cierre",
      stageId: nuevo.id,
      status: "OPEN",
      lostReason: "Precio",
      actualCloseDate: "2026-01-01",
    });
    const wonConMotivo = await api(e, "POST", "/opportunities", {
      ...base,
      title: "Ganada con motivo de pérdida",
      stageId: ganado.id,
      status: "WON",
      lostReason: "Se fue con la competencia",
      actualCloseDate: "2026-09-01",
    });
    anotar({
      id: "O4",
      entidad: "Opportunity",
      combinacion:
        "LOST sin lostReason · OPEN con lostReason y actualCloseDate · WON con lostReason",
      base: "acepta",
      api: `${codigo(lostSinMotivo)} · ${codigo(openConCierre)} · ${codigo(wonConMotivo)}`,
      despues:
        "Se guardan tal cual. El formulario limpia lostReason y la fecha al reabrir (§48/§50), la API no.",
    });
  }

  // O5 — stage de otro pipeline.
  {
    const otro = await pipelineConEtapas(e, "Postventa", [{ name: "Revisión" }]);
    const r = await api(e, "POST", "/opportunities", {
      ...base,
      title: "Cruzada",
      stageId: otro.etapas[0].id,
    });
    const opp = await ok(e, "POST", "/opportunities", {
      ...base,
      title: "Para cruzar",
      stageId: nuevo.id,
    });
    const b = await sql(
      `update opportunities set stage_id = $1::uuid where id = $2::uuid`,
      otro.etapas[0].id,
      opp.id,
    );
    const porPipeline = await ok(e, "GET", `/opportunities?pipelineId=${pipeline.id}&pageSize=100`);
    const enTablero = await ok(
      e,
      "GET",
      `/opportunities?pipelineId=${pipeline.id}&stageId=${otro.etapas[0].id}`,
    );
    anotar({
      id: "O5",
      entidad: "Opportunity ↔ Pipeline/Stage",
      combinacion: "pipelineId = A con stageId de una etapa del pipeline B",
      base: b,
      api: codigo(r),
      despues: `Si entra por la base: el listado por pipeline A la incluye (${porPipeline.data.some((x: { id: string }) => x.id === opp.id) ? "sí" : "no"}) pero ninguna columna de A la tiene; filtrando pipeline A + etapa de B aparece ${enTablero.pagination.total} vez. Queda invisible en el embudo de A y fuera del de B.`,
    });
    await sql(`update opportunities set stage_id = $1::uuid where id = $2::uuid`, nuevo.id, opp.id);
  }

  // O6 — sin company ni contact.
  {
    const r = await api(e, "POST", "/opportunities", {
      pipelineId: pipeline.id,
      stageId: nuevo.id,
      title: "Huérfana",
    });
    const opp = await ok(e, "POST", "/opportunities", {
      ...base,
      title: "Para vaciar",
      stageId: nuevo.id,
    });
    const vaciar = await api(e, "PATCH", `/opportunities/${opp.id}`, { contactId: null });
    anotar({
      id: "O6",
      entidad: "Opportunity",
      combinacion: "companyId null y contactId null",
      base: await sql(
        `update opportunities set contact_id = null, company_id = null where id = $1::uuid`,
        opp.id,
      ),
      api: `POST: ${codigo(r)} · PATCH contactId=null: ${codigo(vaciar)}`,
      despues:
        "Cerrada en las tres capas. (Efecto lateral: la API tampoco deja DESVINCULAR un contacto aunque haya empresa — contactId/companyId no son nullable en el PATCH.)",
    });
  }

  // O7 — contacto o empresa dados de baja con oportunidades abiertas.
  {
    const c2 = await contacto(e);
    const empresa = await ok(e, "POST", "/companies", {
      name: `Empresa ${randomUUID().slice(0, 4)}`,
    });
    const opp = await ok(e, "POST", "/opportunities", {
      ...base,
      contactId: c2.id,
      companyId: empresa.id,
      title: "Con contacto que se borra",
      stageId: nuevo.id,
    });
    const delC = await api(e, "DELETE", `/contacts/${c2.id}`);
    const delE = await api(e, "DELETE", `/companies/${empresa.id}`);
    const oppGet = await ok(e, "GET", `/opportunities/${opp.id}`);
    const cGet = await api(e, "GET", `/contacts/${c2.id}`);
    const filtro = await ok(e, "GET", `/opportunities?contactId=${c2.id}`);
    const editar = await api(e, "PATCH", `/opportunities/${opp.id}`, { title: "Sigue viva" });
    anotar({
      id: "O7",
      entidad: "Opportunity ↔ Contact/Company",
      combinacion: "oportunidad OPEN cuyo contacto y empresa están dados de baja",
      base: "acepta (borrado lógico; la FK no lo ve)",
      api: `DELETE /contacts/:id: ${codigo(delC)} · DELETE /companies/:id: ${codigo(delE)}`,
      despues:
        `La oportunidad sigue ${oppGet.status} apuntando a los dos; GET del contacto: ${cGet.status}; ` +
        `filtrar oportunidades por ese contactId: ${filtro.pagination.total}; editarla: ${codigo(editar)}.`,
    });
  }

  // O8 — financiación incoherente.
  {
    const r1 = await api(e, "POST", "/opportunities", {
      ...base,
      title: "Contado con cuotas",
      stageId: nuevo.id,
      financingType: "NONE",
      financingInstallmentCount: 24,
      financingInstallmentAmount: 500,
      financingLender: "Banco X",
    });
    const r2 = await api(e, "POST", "/opportunities", {
      ...base,
      title: "24 cuotas que son 36",
      stageId: nuevo.id,
      financingType: "INSTALLMENT_24M",
      financingInstallmentCount: 36,
    });
    anotar({
      id: "O8",
      entidad: "Opportunity",
      combinacion: "financingType NONE con cuotas/prestamista · INSTALLMENT_24M con 36 cuotas",
      base: "acepta",
      api: `${codigo(r1)} · ${codigo(r2)}`,
      despues: 'Se guardan tal cual (§42: "pasan tal cual, sin regla de negocio").',
    });
  }

  // O9 — marcar isWon una etapa que ya tiene oportunidades abiertas.
  {
    const conOpps = await ok(e, "POST", "/stages", {
      pipelineId: pipeline.id,
      name: "Negociación",
    });
    await ok(e, "POST", "/opportunities", {
      ...base,
      title: "En negociación",
      stageId: conOpps.id,
    });
    const r = await api(e, "PATCH", `/stages/${conOpps.id}`, { isWon: true });
    const abiertas = await ok(e, "GET", `/opportunities?stageId=${conOpps.id}&status=OPEN`);
    anotar({
      id: "O9",
      entidad: "Stage ↔ Opportunity",
      combinacion: "etapa pasada a isWon con oportunidades OPEN adentro",
      base: "acepta",
      api: codigo(r),
      despues: `Oportunidades de esa etapa que siguen OPEN después del cambio: ${abiertas.pagination.total}. Produce O3 en masa, sin aviso.`,
    });
  }

  return e;
}

// ===========================================================================
// OPPORTUNITY ↔ VEHICLE: reversiones (el caso que el §40 deja fuera)
// ===========================================================================

async function celdasReversion() {
  const e = await montar("rev");
  const { pipeline, etapas } = await pipelineConEtapas(
    e,
    "Ventas",
    [{ name: "Nuevo" }, { name: "Ganado", isWon: true }, { name: "Perdido", isLost: true }],
    true,
  );
  const c = await contacto(e);

  // R1 — ganada con unidad, reabierta, vuelta a ganar.
  {
    const v = await publicado(e);
    const opp = await ok(e, "POST", "/opportunities", {
      title: "Venta",
      contactId: c.id,
      pipelineId: pipeline.id,
      stageId: etapas[0].id,
      vehicleId: v.id,
    });
    await ok(e, "PATCH", `/opportunities/${opp.id}`, {
      stageId: etapas[1].id,
      status: "WON",
      actualCloseDate: "2026-09-23",
    });
    const vendida = await estadoVehiculo(e, v.id);
    const reabrir = await api(e, "PATCH", `/opportunities/${opp.id}`, {
      stageId: etapas[0].id,
      status: "OPEN",
      actualCloseDate: null,
    });
    const tras = await estadoVehiculo(e, v.id);
    const entregas = await prisma.delivery.findMany({ where: { opportunityId: opp.id } });
    const reganar = await api(e, "PATCH", `/opportunities/${opp.id}`, {
      stageId: etapas[1].id,
      status: "WON",
      actualCloseDate: "2026-09-24",
    });
    const final = await ok(e, "GET", `/opportunities/${opp.id}`);
    anotar({
      id: "R1",
      entidad: "Opportunity ↔ Vehicle ↔ Delivery",
      combinacion: "ganada con unidad → reabierta (arrastrar a etapa normal) → ganada de nuevo",
      base: "acepta",
      api: `reabrir: ${codigo(reabrir)} · volver a ganar: ${codigo(reganar)}`,
      despues:
        `Al ganar la unidad quedó ${vendida}; al reabrir pasó a ${tras} con ${entregas.length} entrega ${entregas[0]?.status ?? ""} colgando de una oportunidad abierta. ` +
        `Volver a ganarla ${reganar.status >= 300 ? "FALLA" : "funciona"}: la oportunidad queda ${final.status} en la etapa ${final.stageId === etapas[1].id ? "Ganado" : "Nuevo"}.`,
    });
  }

  // R2 — entregada y después perdida.
  {
    const v = await publicado(e);
    const opp = await ok(e, "POST", "/opportunities", {
      title: "Venta entregada",
      contactId: c.id,
      pipelineId: pipeline.id,
      stageId: etapas[1].id,
      status: "WON",
      actualCloseDate: "2026-09-23",
      vehicleId: v.id,
    });
    const entrega = await prisma.delivery.findFirstOrThrow({ where: { opportunityId: opp.id } });
    const confirmar = await api(e, "PATCH", `/deliveries/${entrega.id}`, { status: "DELIVERED" });
    const entregada = await estadoVehiculo(e, v.id);
    const perder = await api(e, "PATCH", `/opportunities/${opp.id}`, {
      stageId: etapas[2].id,
      status: "LOST",
      lostReason: "Se arrepintió",
    });
    const tras = await estadoVehiculo(e, v.id);
    const agente = await loQueVeElAgente(e);
    const entregaTras = await prisma.delivery.findUniqueOrThrow({ where: { id: entrega.id } });
    const reabrir = await api(e, "PATCH", `/opportunities/${opp.id}`, {
      stageId: etapas[0].id,
      status: "OPEN",
      actualCloseDate: null,
      lostReason: null,
    });
    const tras2 = await estadoVehiculo(e, v.id);
    anotar({
      id: "R2",
      entidad: "Opportunity ↔ Vehicle ↔ Delivery",
      combinacion:
        "entrega confirmada (unidad DELIVERED) y después la oportunidad pasa a LOST u OPEN",
      base: "acepta",
      api: `confirmar entrega: ${codigo(confirmar)} · pasar a LOST: ${codigo(perder)} · reabrir: ${codigo(reabrir)}`,
      despues:
        `La unidad pasa de ${entregada} a ${tras} con la entrega todavía ${entregaTras.status}; ` +
        `search_vehicles ${agente.vehiculos.some((x) => x.id === v.id) ? "LA VUELVE A OFRECER (sigue publishOnWebsite=true)" : "no la ofrece"}. ` +
        `Reabrir la deja en ${tras2}.`,
    });
  }

  return e;
}

// ===========================================================================
// PIPELINE / STAGE
// ===========================================================================

async function celdasPipeline() {
  const e = await montar("pip");

  // P1 — isWon e isLost a la vez.
  const { pipeline, etapas } = await pipelineConEtapas(e, "Ventas", [{ name: "Nuevo" }], true);
  {
    const crear = await api(e, "POST", "/stages", {
      pipelineId: pipeline.id,
      name: "Las dos",
      isWon: true,
      isLost: true,
    });
    anotar({
      id: "P1",
      entidad: "Stage",
      combinacion: "isWon=true e isLost=true",
      base: await sql(
        `update stages set is_won = true, is_lost = true where id = $1::uuid`,
        etapas[0].id,
      ),
      api: codigo(crear),
      despues:
        "Cerrada en las dos capas: la API la corta antes de llegar a la base, y el CHECK stages_won_lost_exclusive_check la frena si entra por SQL.",
    });
  }

  // P2 — dos pipelines por defecto.
  {
    const otro = await ok(e, "POST", "/pipelines", { name: "Otro" });
    const marcar = await api(e, "PATCH", `/pipelines/${otro.id}`, { isDefault: true });
    const defaults = await prisma.pipeline.count({
      where: { organizationId: e.organizationId, isDefault: true, deletedAt: null },
    });
    anotar({
      id: "P2",
      entidad: "Pipeline",
      combinacion: "dos pipelines con isDefault=true en la misma organización",
      base: await sql(`update pipelines set is_default = true where id = $1::uuid`, pipeline.id),
      api: `PATCH isDefault=true sobre otro: ${codigo(marcar)} (desmarca al anterior)`,
      despues: `Defaults vivos después: ${defaults}. Cerrada (índice único parcial pipelines_org_default_unique).`,
    });
  }

  // P3 — cero pipelines por defecto.
  {
    const e2 = await montar("pip0");
    const antes = await prisma.pipeline.count({ where: { organizationId: e2.organizationId } });
    const crear = await api(e2, "POST", "/pipelines", { name: "Sin default" });
    const defaults = await prisma.pipeline.count({
      where: { organizationId: e2.organizationId, isDefault: true, deletedAt: null },
    });
    const quitar = await api(
      e,
      "PATCH",
      `/pipelines/${(await prisma.pipeline.findFirstOrThrow({ where: { organizationId: e.organizationId, isDefault: true } })).id}`,
      { isDefault: false },
    );
    anotar({
      id: "P3",
      entidad: "Pipeline",
      combinacion: "organización con pipelines pero ninguno isDefault",
      base: "acepta (el índice impide dos, no cero)",
      api: `Organización nueva: ${antes} pipelines; POST /pipelines sin isDefault: ${codigo(crear)} → ${defaults} default. PATCH isDefault=false sobre el default: ${codigo(quitar)}`,
      despues:
        "Se llega creando el primer pipeline sin marcarlo (quitarle la marca al default existente sí está cerrado). Consumidor: create_opportunity del agente responde MENSAJE_SIN_PIPELINE_POR_DEFECTO (agentTools.service.ts:484). El onboarding no crea ningún pipeline.",
    });
  }

  // P4 — pipeline por defecto sin etapas.
  {
    const vacio = await api(e, "POST", "/pipelines", { name: "Vacío", isDefault: true });
    const conEtapa = await pipelineConEtapas(e, "Con una etapa", [{ name: "Única" }], true);
    const borrarUltima = await api(e, "DELETE", `/stages/${conEtapa.etapas[0].id}`);
    const def = await prisma.pipeline.findFirstOrThrow({
      where: { organizationId: e.organizationId, isDefault: true, deletedAt: null },
      include: { stages: { where: { deletedAt: null } } },
    });
    anotar({
      id: "P4",
      entidad: "Pipeline ↔ Stage",
      combinacion: "el pipeline por defecto no tiene etapas activas",
      base: "acepta",
      api: `crear un default vacío: ${codigo(vacio)} · borrar la última etapa del default: ${codigo(borrarUltima)}`,
      despues: `El default queda con ${def.stages.length} etapas. create_opportunity del agente responde MENSAJE_PIPELINE_SIN_ETAPAS; en la UI no se puede crear ninguna oportunidad en ese pipeline.`,
    });
  }

  // P5 / P6 — pipeline sin etapas de cierre, y primera etapa de cierre.
  {
    const sinCierre = await pipelineConEtapas(e, "Sin cierre", [{ name: "A" }, { name: "B" }]);
    const primeraGanada = await pipelineConEtapas(e, "Arranca ganada", [
      { name: "Vendido", isWon: true },
      { name: "Nuevo" },
    ]);
    const orden = await ok(
      e,
      "GET",
      `/stages?pipelineId=${primeraGanada.pipeline.id}&sortBy=order&sortOrder=asc`,
    );
    const variasGanadas = await api(e, "POST", "/stages", {
      pipelineId: sinCierre.pipeline.id,
      name: "Ganado 2",
      isWon: true,
    });
    anotar({
      id: "P5",
      entidad: "Pipeline ↔ Stage",
      combinacion: "pipeline sin ninguna etapa isWon ni isLost",
      base: "acepta",
      api: "201 (pipeline y sus dos etapas)",
      despues:
        "Desde el §51 sus oportunidades no se pueden cerrar desde la UI (deuda anotada en ese ítem); por la API sí, mandando status.",
    });
    anotar({
      id: "P6",
      entidad: "Pipeline ↔ Stage",
      combinacion: "la etapa de order=1 es isWon (o isLost)",
      base: "acepta",
      api: `201; primera etapa por order: "${orden.data[0]?.name}"`,
      despues:
        "Si ese pipeline es el default, toda oportunidad que crea el agente nace OPEN en una etapa de cierre (produce O3).",
    });
    anotar({
      id: "P7",
      entidad: "Stage",
      combinacion: "varias etapas isWon en el mismo pipeline",
      base: "acepta",
      api: codigo(variasGanadas),
      despues: "Aceptado a propósito desde el §13 (se retiró la exclusividad).",
    });
  }

  return e;
}

// ===========================================================================
// CONTACT
// ===========================================================================

async function celdasContact() {
  const e = await montar("con");
  const { pipeline, etapas } = await pipelineConEtapas(
    e,
    "Ventas",
    [{ name: "Nuevo" }, { name: "Ganado", isWon: true }],
    true,
  );

  const cliente = await api(e, "POST", "/contacts", {
    firstName: "Cliente",
    lastName: "Sin compras",
    lifecycleStage: "CUSTOMER",
  });
  const lead = await contacto(e, { lifecycleStage: "LEAD" });
  await ok(e, "POST", "/opportunities", {
    title: "Compró",
    contactId: lead.id,
    pipelineId: pipeline.id,
    stageId: etapas[1].id,
    status: "WON",
    actualCloseDate: "2026-09-23",
  });
  const leadDespues = await ok(e, "GET", `/contacts/${lead.id}`);
  anotar({
    id: "K1",
    entidad: "Contact ↔ Opportunity",
    combinacion: "lifecycleStage CUSTOMER sin ninguna oportunidad ganada · LEAD con una ganada",
    base: "acepta",
    api: `${codigo(cliente)} · ganar la oportunidad de un LEAD: 201`,
    despues: `El LEAD sigue ${leadDespues.lifecycleStage} después de ganar: nada deriva lifecycleStage de las oportunidades (promotion.service lo deja fuera a propósito).`,
  });

  const sinCanal = await api(e, "POST", "/contacts", { firstName: "Sin", lastName: "Canal" });
  anotar({
    id: "K2",
    entidad: "Contact",
    combinacion: "email null y phone null",
    base: "acepta",
    api: codigo(sinCanal),
    despues:
      "Un contacto al que no hay por dónde escribirle. Puede ser legítimo (carga de mostrador).",
  });

  const borrado = await contacto(e, { email: "repetido@example.test" });
  await ok(e, "DELETE", `/contacts/${borrado.id}`);
  const nuevo = await api(e, "POST", "/contacts", {
    firstName: "Otro",
    lastName: "Con el mismo email",
    email: "repetido@example.test",
  });
  anotar({
    id: "K3",
    entidad: "Contact",
    combinacion: "email de un contacto dado de baja reutilizado por uno vivo",
    base: "acepta (contacts_org_email_unique excluye deleted_at)",
    api: codigo(nuevo),
    despues: "Coherente: el único es parcial sobre los vivos.",
  });

  return e;
}

// ===========================================================================

async function main() {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    await celdasVehicle();
    await celdasReversion();
    await celdasOpportunity();
    await celdasPipeline();
    await celdasContact();
  } finally {
    for (const e of escenarios) {
      await desmontar(e).catch((err) =>
        console.error(`desmontar ${e.organizationId}:`, err.message),
      );
    }
    server.close();
    await prisma.$disconnect();
  }

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(celdas, null, 2));
    return;
  }
  console.log("| # | Entidad | Combinación | Base | API | Qué pasa después |");
  console.log("|---|---|---|---|---|---|");
  for (const c of celdas) {
    const esc = (s: string) => s.replace(/\|/g, "\\|");
    console.log(
      `| ${c.id} | ${esc(c.entidad)} | ${esc(c.combinacion)} | ${esc(c.base)} | ${esc(c.api)} | ${esc(c.despues)} |`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
