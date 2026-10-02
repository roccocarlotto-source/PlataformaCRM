import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import type { Prisma } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import express from "express";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { errorHandler } from "../middlewares/errorHandler";
import { notFound } from "../middlewares/notFound";
import { findApprovedWhatsappTemplate } from "../repositories/whatsappTemplate.repository";
import { findRoleByName } from "../repositories/role.repository";
import { createAutomationRouter } from "../routes/automation.routes";
import { registroDeAcciones } from "../services/automationActions";
import { registrarAutomatizaciones } from "../services/automationRegistrations";
import type { DepsDeReglaConMensaje } from "../services/automationWhatsapp.service";
import {
  WhatsappGraphError,
  type CreateWhatsappTemplateInput,
  type DeleteWhatsappTemplateInput,
  type UploadTemplateSampleInput,
} from "../services/whatsappGraph.service";
import {
  applyWhatsappTemplateStatusFromMeta,
  type DepsDePlantillas,
} from "../services/whatsappTemplate.service";

// ---------------------------------------------------------------------------
// La regla y su plantilla de WhatsApp juntas (formato elegible + plantilla
// integrada), por HTTP real contra Postgres y GoTrue reales, con la cadena del
// router de automatizaciones vía su factory y un doble de la Graph API: nunca
// se habla con Meta.
//
// Lo que este archivo fija:
//   1. Guardar una regla nueva con formato y texto crea la plantilla en Meta
//      sola: header IMAGE con la imagen de ejemplo subida si el formato lleva
//      imagen, el cuerpo en {{1}}/{{2}}, y la fila en PENDING con el id de
//      Meta. La respuesta trae el estado de aprobación.
//   2. Una regla existente (solo link, plantilla aprobada, sin messageText)
//      que se guarda sin cambiar el mensaje NO pide otra aprobación.
//   3. Cambiar el formato crea una versión nueva y la regla SIGUE mandando
//      con la aprobada hasta que Meta aprueba la nueva; ahí la anterior se da
//      de baja (también en Meta) y la nueva pasa a ser la que se usa.
//   4. Volver al mensaje aprobado descarta la versión en revisión.
//   5. Si Meta rechaza el alta, la regla queda guardada, la reserva se
//      descarta y la respuesta dice por qué.
//   6. Sin URL pública del backend, un formato con imagen es 400 y no se
//      guarda nada.
//   7. El refresh repregunta a Meta y promueve; la organización B no ve ni
//      refresca las plantillas de A.
// ---------------------------------------------------------------------------

const PASSWORD = "Automation-whatsapp-test-password-123!";
const TEXTO_LINK = "Hola {nombre}, gracias por tu compra. Tu opinión acá: {link} ¡Gracias!";
const TEXTO_IMAGEN = "Hola {nombre}, te dejamos el QR de tu visita. ¡Gracias!";

interface FixtureUser {
  accessToken: string;
  authUserId: string;
}

let orgA: string;
let orgB: string;
let adminA: FixtureUser;
let adminB: FixtureUser;
let baseUrl: string;
let closeApp: () => Promise<void>;

// El doble de Meta.
let altas: CreateWhatsappTemplateInput[] = [];
let bajas: DeleteWhatsappTemplateInput[] = [];
let subidas: UploadTemplateSampleInput[] = [];
let consultas: string[] = [];
let fallaAlCrear: unknown = null;
let estadoEnMeta = { status: "APPROVED", rejectedReason: null as string | null };
let baseDeLaApi: string | undefined = "https://api.test";

const plantillas: DepsDePlantillas = {
  wabaId: () => "waba-de-prueba",
  accessToken: () => "token-de-prueba",
  appId: () => "app-de-prueba",
  create: (input) => {
    altas.push(input);
    if (fallaAlCrear) return Promise.reject(fallaAlCrear);
    return Promise.resolve({ id: String(randomInt(1_000_000, 9_999_999)), status: "PENDING" });
  },
  delete: (input) => {
    bajas.push(input);
    return Promise.resolve();
  },
  getStatus: ({ metaTemplateId }) => {
    consultas.push(metaTemplateId);
    return Promise.resolve(estadoEnMeta);
  },
  uploadSample: (input) => {
    subidas.push(input);
    return Promise.resolve("4::handle-de-ejemplo");
  },
  // El nombre es único en toda la tabla: uno al azar por versión.
  nombreNuevo: () => `test_auto_wa_${String(randomInt(100_000_000, 999_999_999))}`,
};

const deps: DepsDeReglaConMensaje = { plantillas, baseDeLaApi: () => baseDeLaApi };

function configQr(extra: Record<string, unknown> = {}) {
  return { qrCodeId: randomUUID(), delayHours: 24, ...extra };
}

function reglaQr(actionConfig: Record<string, unknown>) {
  return {
    name: `Regla QR ${randomUUID().slice(0, 8)}`,
    triggerType: "opportunity.won",
    actionType: "opportunity.send_qr_followup",
    actionConfig,
    // Inactiva: la unicidad de reglas activas por trigger no es lo que se prueba.
    isActive: false,
  };
}

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use("/api", createAutomationRouter(deps));
  app.use(notFound);
  app.use(errorHandler);
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function crearOrganizacion(etiqueta: string): Promise<string> {
  const org = await prisma.organization.create({
    data: {
      name: `Automation WhatsApp ${etiqueta} ${randomUUID()}`,
      slug: `auto-wa-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  return org.id;
}

async function createFixtureUser(label: string, organizationId: string): Promise<FixtureUser> {
  const email = `auto-wa-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`No se pudo crear usuario real de Supabase Auth (${label}): ${error?.message}`);
  }
  const roleRow = await findRoleByName("ADMIN");
  if (!roleRow) throw new Error("No está sembrado el rol ADMIN. Abortando.");
  await prisma.user.create({
    data: {
      id: data.user.id,
      organizationId,
      roleId: roleRow.id,
      email,
      fullName: `Automation WhatsApp ${label}`,
    },
  });
  const anonClient = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!);
  const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError || !signInData.session) {
    throw new Error(`No se pudo iniciar sesión real (${label}): ${signInError?.message}`);
  }
  return { accessToken: signInData.session.access_token, authUserId: data.user.id };
}

function call(method: string, path: string, token: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

interface ReglaRespuesta {
  id: string;
  whatsappApproval: {
    estado: string;
    motivo: string | null;
    mandaLaAnterior: boolean;
    bodyText: string | null;
    formato: string | null;
  } | null;
  whatsappSyncError?: string | null;
}

async function json<T>(res: Response, status: number): Promise<T> {
  const crudo = await res.text();
  assert.equal(res.status, status, crudo);
  return JSON.parse(crudo) as T;
}

function vivasDe(automationId: string) {
  return prisma.whatsappTemplate.findMany({
    where: { automationId, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
}

// Una regla "de antes": solo link, sin formato ni texto en la config, con su
// plantilla ya aprobada en Meta.
async function reglaExistenteAprobada(organizationId: string) {
  const regla = await prisma.automation.create({
    data: {
      organizationId,
      ...reglaQr(configQr()),
      actionConfig: configQr() as Prisma.InputJsonValue,
    },
  });
  const aprobada = await prisma.whatsappTemplate.create({
    data: {
      organizationId,
      automationId: regla.id,
      name: `test_auto_wa_vieja_${String(randomInt(100_000_000, 999_999_999))}`,
      language: "es_AR",
      bodyText: TEXTO_LINK,
      metaTemplateId: String(randomInt(1_000_000, 9_999_999)),
      status: "APPROVED",
    },
  });
  return { regla, aprobada };
}

beforeEach(() => {
  altas = [];
  bajas = [];
  subidas = [];
  consultas = [];
  fallaAlCrear = null;
  estadoEnMeta = { status: "APPROVED", rejectedReason: null };
  baseDeLaApi = "https://api.test";
});

before(async () => {
  process.env.LOG_LEVEL = "fatal";
  // El catálogo de acciones lo arma server.ts al arrancar: acá, el mismo
  // registro (mismo criterio que automation.controller.integration-test.ts).
  if (registroDeAcciones.tiposRegistrados().length === 0) {
    registrarAutomatizaciones();
  }
  const started = await startTestApp();
  baseUrl = started.url;
  closeApp = started.close;
  orgA = await crearOrganizacion("a");
  orgB = await crearOrganizacion("b");
  adminA = await createFixtureUser("admin-a", orgA);
  adminB = await createFixtureUser("admin-b", orgB);
});

after(async () => {
  if (closeApp) await closeApp();
  for (const org of [orgA, orgB]) {
    if (!org) continue;
    await prisma.whatsappTemplate.deleteMany({ where: { organizationId: org } });
    await prisma.automation.deleteMany({ where: { organizationId: org } });
    await prisma.user.deleteMany({ where: { organizationId: org } });
    await prisma.organization.delete({ where: { id: org } });
  }
  for (const u of [adminA, adminB]) {
    if (u) await getSupabaseAdmin().auth.admin.deleteUser(u.authUserId);
  }
});

test("1. regla nueva con link e imagen: la plantilla sale sola a Meta, con header IMAGE y su ejemplo", async () => {
  const res = await call(
    "POST",
    "/api/automations",
    adminA.accessToken,
    reglaQr(configQr({ whatsappFormat: "LINK_AND_IMAGE", messageText: TEXTO_LINK })),
  );
  const regla = await json<ReglaRespuesta>(res, 201);

  assert.equal(regla.whatsappSyncError, null);
  assert.deepEqual(regla.whatsappApproval, {
    estado: "PENDIENTE",
    motivo: null,
    mandaLaAnterior: false,
    bodyText: TEXTO_LINK,
    formato: "LINK_AND_IMAGE",
  });
  assert.equal(subidas.length, 1);
  assert.equal(subidas[0].appId, "app-de-prueba");
  assert.equal(subidas[0].png.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(altas.length, 1);
  assert.equal(altas[0].headerImageHandle, "4::handle-de-ejemplo");
  assert.equal(
    altas[0].bodyText,
    "Hola {{1}}, gracias por tu compra. Tu opinión acá: {{2}} ¡Gracias!",
  );
  assert.equal(altas[0].bodyExamples.length, 2);

  const [fila] = await vivasDe(regla.id);
  assert.equal(fila.headerFormat, "IMAGE");
  assert.equal(fila.status, "PENDING");
  assert.ok(fila.metaTemplateId);

  // El GET devuelve el mismo estado.
  const leida = await json<ReglaRespuesta>(
    await call("GET", `/api/automations/${regla.id}`, adminA.accessToken),
    200,
  );
  assert.equal(leida.whatsappApproval?.estado, "PENDIENTE");
});

test("1b. solo imagen: el cuerpo va sin link y con un único ejemplo", async () => {
  const res = await call(
    "POST",
    "/api/automations",
    adminA.accessToken,
    reglaQr(configQr({ whatsappFormat: "IMAGE", messageText: TEXTO_IMAGEN })),
  );
  await json<ReglaRespuesta>(res, 201);
  assert.equal(altas[0].bodyText, "Hola {{1}}, te dejamos el QR de tu visita. ¡Gracias!");
  assert.deepEqual(altas[0].bodyExamples, ["Ana"]);
  assert.equal(altas[0].headerImageHandle, "4::handle-de-ejemplo");
});

test("2. una regla existente que se guarda sin cambiar el mensaje no pide otra aprobación", async () => {
  const { regla } = await reglaExistenteAprobada(orgA);

  const res = await call("PATCH", `/api/automations/${regla.id}`, adminA.accessToken, {
    name: "Pedir reseña (renombrada)",
    actionConfig: regla.actionConfig,
  });
  const guardada = await json<ReglaRespuesta>(res, 200);

  assert.equal(altas.length, 0);
  assert.equal(bajas.length, 0);
  assert.deepEqual(guardada.whatsappApproval, {
    estado: "APROBADA",
    motivo: null,
    mandaLaAnterior: false,
    bodyText: TEXTO_LINK,
    formato: "LINK",
  });
});

test("3. cambiar el formato: sigue mandando la aprobada hasta que Meta aprueba la nueva", async () => {
  const { regla, aprobada } = await reglaExistenteAprobada(orgA);

  const res = await call("PATCH", `/api/automations/${regla.id}`, adminA.accessToken, {
    actionConfig: {
      ...(regla.actionConfig as object),
      whatsappFormat: "IMAGE",
      messageText: TEXTO_IMAGEN,
    },
  });
  const guardada = await json<ReglaRespuesta>(res, 200);

  assert.equal(guardada.whatsappApproval?.estado, "PENDIENTE");
  assert.equal(guardada.whatsappApproval?.mandaLaAnterior, true);
  assert.equal(altas.length, 1);
  // El worker sigue tomando la vieja, solo texto.
  assert.deepEqual(await findApprovedWhatsappTemplate(orgA, regla.id), {
    name: aprobada.name,
    language: "es_AR",
    bodyText: TEXTO_LINK,
    headerFormat: "NONE",
  });

  // Meta la aprueba (webhook): la nueva pasa a ser la que se usa y la vieja
  // se da de baja, también en Meta.
  const nueva = (await vivasDe(regla.id)).find((p) => p.id !== aprobada.id)!;
  const actualizadas = await applyWhatsappTemplateStatusFromMeta(
    nueva.metaTemplateId!,
    "APPROVED",
    null,
    plantillas,
  );
  assert.equal(actualizadas, 1);
  assert.deepEqual(
    (await vivasDe(regla.id)).map((p) => [p.id, p.status]),
    [[nueva.id, "APPROVED"]],
  );
  assert.equal(bajas.length, 1);
  assert.equal(bajas[0].name, aprobada.name);
  assert.equal((await findApprovedWhatsappTemplate(orgA, regla.id))?.headerFormat, "IMAGE");
});

test("4. volver al mensaje aprobado descarta la versión que estaba en revisión", async () => {
  const { regla } = await reglaExistenteAprobada(orgA);
  const config = regla.actionConfig as Record<string, unknown>;
  await json<ReglaRespuesta>(
    await call("PATCH", `/api/automations/${regla.id}`, adminA.accessToken, {
      actionConfig: { ...config, whatsappFormat: "LINK_AND_IMAGE", messageText: TEXTO_LINK },
    }),
    200,
  );
  assert.equal((await vivasDe(regla.id)).length, 2);

  const vuelta = await json<ReglaRespuesta>(
    await call("PATCH", `/api/automations/${regla.id}`, adminA.accessToken, {
      actionConfig: { ...config, whatsappFormat: "LINK", messageText: TEXTO_LINK },
    }),
    200,
  );

  assert.equal(vuelta.whatsappApproval?.estado, "APROBADA");
  assert.equal(altas.length, 1, "no se mandó otra alta");
  assert.equal(bajas.length, 1, "la candidata se borró en Meta");
  assert.deepEqual(
    (await vivasDe(regla.id)).map((p) => p.status),
    ["APPROVED"],
  );
});

test("5. si Meta rechaza el alta, la regla queda guardada y la respuesta dice por qué", async () => {
  fallaAlCrear = new WhatsappGraphError(
    400,
    JSON.stringify({
      error: { message: "Invalid parameter", error_user_msg: "El texto no cumple" },
    }),
  );
  const res = await call(
    "POST",
    "/api/automations",
    adminA.accessToken,
    reglaQr(configQr({ whatsappFormat: "LINK", messageText: TEXTO_LINK })),
  );
  const regla = await json<ReglaRespuesta>(res, 201);

  assert.match(regla.whatsappSyncError ?? "", /El texto no cumple/);
  assert.equal(regla.whatsappApproval?.estado, "SIN_PLANTILLA");
  assert.equal((await vivasDe(regla.id)).length, 0, "la reserva se descartó");
  assert.ok(await prisma.automation.findUnique({ where: { id: regla.id } }));
});

test("6. sin URL pública del backend, un formato con imagen es 400 y no se guarda nada", async () => {
  baseDeLaApi = undefined;
  const nombre = `Sin base ${randomUUID()}`;
  const res = await call("POST", "/api/automations", adminA.accessToken, {
    ...reglaQr(configQr({ whatsappFormat: "IMAGE", messageText: TEXTO_IMAGEN })),
    name: nombre,
  });
  assert.equal(res.status, 400);
  assert.equal(altas.length + subidas.length, 0);
  assert.equal(await prisma.automation.count({ where: { organizationId: orgA, name: nombre } }), 0);
});

test("7. refresh: repregunta a Meta y promueve; la organización B no ve las de A", async () => {
  const { regla, aprobada } = await reglaExistenteAprobada(orgA);
  await json<ReglaRespuesta>(
    await call("PATCH", `/api/automations/${regla.id}`, adminA.accessToken, {
      actionConfig: {
        ...(regla.actionConfig as object),
        messageText: "Hola {nombre}, otro texto: {link} chau",
      },
    }),
    200,
  );

  // B no ve ni refresca nada de A: resumen vacío y Meta no se consulta.
  const deB = await json<{ estado: string }>(
    await call(
      "POST",
      `/api/automations/${regla.id}/whatsapp-approval/refresh`,
      adminB.accessToken,
    ),
    200,
  );
  assert.equal(deB.estado, "SIN_PLANTILLA");
  assert.equal(consultas.length, 0);

  const refrescada = await json<{ estado: string; mandaLaAnterior: boolean }>(
    await call(
      "POST",
      `/api/automations/${regla.id}/whatsapp-approval/refresh`,
      adminA.accessToken,
    ),
    200,
  );
  assert.equal(refrescada.estado, "APROBADA");
  assert.equal(refrescada.mandaLaAnterior, false);
  const vivas = await vivasDe(regla.id);
  assert.equal(vivas.length, 1);
  assert.notEqual(vivas[0].id, aprobada.id);
  assert.equal(bajas[0].name, aprobada.name);
});

test("una regla que no manda WhatsApp no trae estado de aprobación ni habla con Meta", async () => {
  const res = await call("POST", "/api/automations", adminA.accessToken, {
    name: `Tarea ${randomUUID().slice(0, 8)}`,
    triggerType: "opportunity.won",
    actionType: "activity.create_follow_up",
    actionConfig: { subject: "Llamar", daysUntilDue: 1 },
    isActive: false,
  });
  const regla = await json<ReglaRespuesta>(res, 201);
  assert.equal(regla.whatsappApproval, null);
  assert.equal(altas.length, 0);
});
