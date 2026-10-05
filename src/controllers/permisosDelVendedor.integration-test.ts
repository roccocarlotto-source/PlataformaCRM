import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import express from "express";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { errorHandler } from "../middlewares/errorHandler";
import { notFound } from "../middlewares/notFound";
import { findRoleByName } from "../repositories/role.repository";
import { contactRouter } from "../routes/contact.routes";
import { opportunityRouter } from "../routes/opportunity.routes";
import {
  MENSAJE_USER_NO_ASIGNA_A_OTRO,
  MENSAJE_USER_SOLO_EDITA_LO_SUYO,
} from "../services/permisosDelVendedor";

// ---------------------------------------------------------------------------
// Permisos por rol sobre contactos y oportunidades, por HTTP real con las
// rutas reales y contra Postgres — decisión D2 (OPUS-I-03 de
// docs-privados/auditoria-2026-10-04-OPUS.md, local).
//
// Lo que se fija:
//   - un USER crea contactos y oportunidades, y quedan a su nombre; no puede
//     crearlos a nombre de otro;
//   - un USER edita los que tiene asignados (mover de etapa, ganar o perder
//     incluido) y ninguno más: ni los de otro, ni los que no tienen dueño;
//   - un USER no reasigna;
//   - borrar sigue siendo de ADMIN (unir y borrar datos personales ya lo
//     afirman contactMerge y contact-erase);
//   - un ADMIN sigue pudiendo todo;
//   - el aislamiento entre organizaciones no cambia.
// ---------------------------------------------------------------------------

const PASSWORD = "Permisos-test-password-123!";

interface Usuario {
  accessToken: string;
  userId: string;
}

let orgId: string;
let otraOrgId: string;
let pipelineId: string;
let etapaInicial: string;
let etapaSiguiente: string;
let admin: Usuario;
let vendedor: Usuario;
let otroVendedor: Usuario;
let vendedorDeOtraOrg: Usuario;
let baseUrl: string;
let closeApp: () => Promise<void>;
const usuariosDeAuth: string[] = [];

async function crearUsuario(
  label: string,
  organizationId: string,
  role: "ADMIN" | "USER",
): Promise<Usuario> {
  const email = `permisos-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user)
    throw new Error(`No se pudo crear el usuario (${label}): ${error?.message}`);
  usuariosDeAuth.push(data.user.id);
  const rol = await findRoleByName(role);
  if (!rol) throw new Error(`No está sembrado el rol ${role}.`);
  await prisma.user.create({
    data: {
      id: data.user.id,
      organizationId,
      roleId: rol.id,
      email,
      fullName: `Permisos ${label}`,
    },
  });
  const anon = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!);
  const { data: s, error: e } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  if (e || !s.session) throw new Error(`No se pudo iniciar sesión (${label}): ${e?.message}`);
  return { accessToken: s.session.access_token, userId: data.user.id };
}

function call(method: string, path: string, usuario: Usuario, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${usuario.accessToken}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function mensajeDe(res: Response): Promise<string> {
  return ((await res.json()) as { error: { message: string } }).error.message;
}

function contactoDe(ownerId: string | null, organizationId = orgId) {
  return prisma.contact.create({
    data: { organizationId, firstName: "Ana", lastName: randomUUID().slice(0, 6), ownerId },
  });
}

async function oportunidadDe(ownerId: string) {
  const contacto = await contactoDe(ownerId);
  return prisma.opportunity.create({
    data: {
      organizationId: orgId,
      title: `Venta ${randomUUID().slice(0, 6)}`,
      contactId: contacto.id,
      ownerId,
      pipelineId,
      stageId: etapaInicial,
    },
  });
}

before(async () => {
  process.env.LOG_LEVEL = "fatal";
  const app = express();
  app.use(express.json());
  app.use("/api", contactRouter);
  app.use("/api", opportunityRouter);
  app.use(notFound);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    const server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      closeApp = () => new Promise((r) => server.close(() => r()));
      resolve();
    });
  });

  const crearOrg = async (etiqueta: string) =>
    (
      await prisma.organization.create({
        data: {
          name: `Permisos ${etiqueta} ${randomUUID()}`,
          slug: `permisos-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
        },
      })
    ).id;
  orgId = await crearOrg("a");
  otraOrgId = await crearOrg("b");
  pipelineId = (
    await prisma.pipeline.create({
      data: { organizationId: orgId, name: "Ventas", isDefault: true },
    })
  ).id;
  const etapa = (name: string, order: number) =>
    prisma.stage.create({ data: { organizationId: orgId, pipelineId, name, order } });
  etapaInicial = (await etapa("Nuevo", 1)).id;
  etapaSiguiente = (await etapa("Negociación", 2)).id;

  admin = await crearUsuario("admin", orgId, "ADMIN");
  vendedor = await crearUsuario("vendedor", orgId, "USER");
  otroVendedor = await crearUsuario("otro", orgId, "USER");
  vendedorDeOtraOrg = await crearUsuario("ajeno", otraOrgId, "USER");
});

after(async () => {
  if (closeApp) await closeApp();
  for (const id of [orgId, otraOrgId]) {
    if (!id) continue;
    const where = { organizationId: id };
    await prisma.outboxEvent.deleteMany({ where });
    await prisma.opportunity.deleteMany({ where });
    await prisma.contact.deleteMany({ where });
    await prisma.stage.deleteMany({ where });
    await prisma.pipeline.deleteMany({ where });
    await prisma.user.deleteMany({ where });
    await prisma.organization.delete({ where: { id } });
  }
  for (const authId of usuariosDeAuth) {
    await getSupabaseAdmin().auth.admin.deleteUser(authId);
  }
});

// ---------------------------------------------------------------------------
// Contactos
// ---------------------------------------------------------------------------

test("contactos: un USER crea, y el contacto queda a su nombre", async () => {
  const res = await call("POST", "/api/contacts", vendedor, {
    firstName: "Diego",
    lastName: "Ramírez",
  });
  assert.equal(res.status, 201, await res.clone().text());
  const creado = (await res.json()) as { id: string; ownerId: string };
  assert.equal(creado.ownerId, vendedor.userId);

  // Pedirlo a su propio nombre es lo mismo.
  const explicito = await call("POST", "/api/contacts", vendedor, {
    firstName: "Laura",
    lastName: "Gómez",
    ownerId: vendedor.userId,
  });
  assert.equal(explicito.status, 201);
});

test("contactos: un USER no crea a nombre de otra persona (403, y no se crea nada)", async () => {
  const antes = await prisma.contact.count({ where: { organizationId: orgId } });
  const res = await call("POST", "/api/contacts", vendedor, {
    firstName: "Para",
    lastName: "Otro",
    ownerId: otroVendedor.userId,
  });
  assert.equal(res.status, 403);
  assert.equal(await mensajeDe(res), MENSAJE_USER_NO_ASIGNA_A_OTRO);
  assert.equal(await prisma.contact.count({ where: { organizationId: orgId } }), antes);
});

test("contactos: un USER edita el que tiene asignado", async () => {
  const propio = await contactoDe(vendedor.userId);
  const res = await call("PATCH", `/api/contacts/${propio.id}`, vendedor, {
    jobTitle: "Gerente de compras",
  });
  assert.equal(res.status, 200, await res.clone().text());
  const fila = await prisma.contact.findUniqueOrThrow({ where: { id: propio.id } });
  assert.equal(fila.jobTitle, "Gerente de compras");
  assert.equal(fila.ownerId, vendedor.userId);
});

test("contactos: un USER no edita el de otro vendedor ni uno sin asignar (403, y nada cambia)", async () => {
  for (const ownerId of [otroVendedor.userId, admin.userId, null]) {
    const ajeno = await contactoDe(ownerId);
    const res = await call("PATCH", `/api/contacts/${ajeno.id}`, vendedor, {
      jobTitle: "Cambiado",
    });
    assert.equal(res.status, 403, String(ownerId));
    assert.equal(await mensajeDe(res), MENSAJE_USER_SOLO_EDITA_LO_SUYO);
    const fila = await prisma.contact.findUniqueOrThrow({ where: { id: ajeno.id } });
    assert.equal(fila.jobTitle, null);
  }
});

test("contactos: un USER no reasigna — ni lo suyo a otro, ni lo de otro a sí mismo", async () => {
  const propio = await contactoDe(vendedor.userId);
  const ceder = await call("PATCH", `/api/contacts/${propio.id}`, vendedor, {
    ownerId: otroVendedor.userId,
  });
  assert.equal(ceder.status, 403);
  assert.equal(await mensajeDe(ceder), MENSAJE_USER_NO_ASIGNA_A_OTRO);

  const ajeno = await contactoDe(otroVendedor.userId);
  const tomar = await call("PATCH", `/api/contacts/${ajeno.id}`, vendedor, {
    ownerId: vendedor.userId,
  });
  assert.equal(tomar.status, 403);

  assert.equal(
    (await prisma.contact.findUniqueOrThrow({ where: { id: propio.id } })).ownerId,
    vendedor.userId,
  );
  assert.equal(
    (await prisma.contact.findUniqueOrThrow({ where: { id: ajeno.id } })).ownerId,
    otroVendedor.userId,
  );
});

test("contactos: borrar sigue siendo de ADMIN, también para el dueño", async () => {
  const propio = await contactoDe(vendedor.userId);
  const res = await call("DELETE", `/api/contacts/${propio.id}`, vendedor);
  assert.equal(res.status, 403);
  assert.equal(
    (await prisma.contact.findUniqueOrThrow({ where: { id: propio.id } })).deletedAt,
    null,
  );

  const comoAdmin = await call("DELETE", `/api/contacts/${propio.id}`, admin);
  assert.equal(comoAdmin.status, 204);
});

test("contactos: un ADMIN sigue pudiendo crear a nombre de otro, editar el de cualquiera y reasignar", async () => {
  const creado = await call("POST", "/api/contacts", admin, {
    firstName: "Para",
    lastName: "El vendedor",
    ownerId: vendedor.userId,
  });
  assert.equal(creado.status, 201);
  const { id } = (await creado.json()) as { id: string };

  const editado = await call("PATCH", `/api/contacts/${id}`, admin, {
    jobTitle: "Director",
    ownerId: otroVendedor.userId,
  });
  assert.equal(editado.status, 200, await editado.clone().text());
  const fila = await prisma.contact.findUniqueOrThrow({ where: { id } });
  assert.equal(fila.ownerId, otroVendedor.userId);
  assert.equal(fila.jobTitle, "Director");
});

test("contactos: el de otra organización es 404 para un USER, exista o no", async () => {
  const deOtraOrg = await contactoDe(vendedorDeOtraOrg.userId, otraOrgId);
  const res = await call("PATCH", `/api/contacts/${deOtraOrg.id}`, vendedor, {
    jobTitle: "Cambiado",
  });
  assert.equal(res.status, 404);
  const inexistente = await call("PATCH", `/api/contacts/${randomUUID()}`, vendedor, {
    jobTitle: "Cambiado",
  });
  assert.equal(inexistente.status, 404);
  assert.equal(
    (await prisma.contact.findUniqueOrThrow({ where: { id: deOtraOrg.id } })).jobTitle,
    null,
  );
});

// ---------------------------------------------------------------------------
// Oportunidades
// ---------------------------------------------------------------------------

test("oportunidades: un USER crea, y queda a su nombre; no la crea a nombre de otro", async () => {
  const contacto = await contactoDe(vendedor.userId);
  const cuerpo = {
    title: "Venta de una pickup",
    contactId: contacto.id,
    pipelineId,
    stageId: etapaInicial,
  };
  const res = await call("POST", "/api/opportunities", vendedor, cuerpo);
  assert.equal(res.status, 201, await res.clone().text());
  assert.equal(((await res.json()) as { ownerId: string }).ownerId, vendedor.userId);

  const antes = await prisma.opportunity.count({ where: { organizationId: orgId } });
  const paraOtro = await call("POST", "/api/opportunities", vendedor, {
    ...cuerpo,
    ownerId: otroVendedor.userId,
  });
  assert.equal(paraOtro.status, 403);
  assert.equal(await mensajeDe(paraOtro), MENSAJE_USER_NO_ASIGNA_A_OTRO);
  assert.equal(await prisma.opportunity.count({ where: { organizationId: orgId } }), antes);
});

test("oportunidades: un USER edita y mueve de etapa la que tiene asignada", async () => {
  const propia = await oportunidadDe(vendedor.userId);
  const res = await call("PATCH", `/api/opportunities/${propia.id}`, vendedor, {
    title: "Venta de una pickup 4x4",
    stageId: etapaSiguiente,
  });
  assert.equal(res.status, 200, await res.clone().text());
  const fila = await prisma.opportunity.findUniqueOrThrow({ where: { id: propia.id } });
  assert.equal(fila.title, "Venta de una pickup 4x4");
  assert.equal(fila.stageId, etapaSiguiente);
  assert.equal(fila.ownerId, vendedor.userId);
});

test("oportunidades: un USER no edita la de otro ni la reasigna (403, y nada cambia)", async () => {
  const ajena = await oportunidadDe(otroVendedor.userId);
  const editar = await call("PATCH", `/api/opportunities/${ajena.id}`, vendedor, {
    stageId: etapaSiguiente,
  });
  assert.equal(editar.status, 403);
  assert.equal(await mensajeDe(editar), MENSAJE_USER_SOLO_EDITA_LO_SUYO);

  const propia = await oportunidadDe(vendedor.userId);
  const ceder = await call("PATCH", `/api/opportunities/${propia.id}`, vendedor, {
    ownerId: otroVendedor.userId,
  });
  assert.equal(ceder.status, 403);
  assert.equal(await mensajeDe(ceder), MENSAJE_USER_NO_ASIGNA_A_OTRO);

  const [a, b] = await Promise.all([
    prisma.opportunity.findUniqueOrThrow({ where: { id: ajena.id } }),
    prisma.opportunity.findUniqueOrThrow({ where: { id: propia.id } }),
  ]);
  assert.equal(a.stageId, etapaInicial);
  assert.equal(b.ownerId, vendedor.userId);
});

test("oportunidades: borrar sigue siendo de ADMIN, y un ADMIN edita y reasigna la de cualquiera", async () => {
  const propia = await oportunidadDe(vendedor.userId);
  const borrar = await call("DELETE", `/api/opportunities/${propia.id}`, vendedor);
  assert.equal(borrar.status, 403);
  assert.equal(
    (await prisma.opportunity.findUniqueOrThrow({ where: { id: propia.id } })).deletedAt,
    null,
  );

  const reasignar = await call("PATCH", `/api/opportunities/${propia.id}`, admin, {
    ownerId: otroVendedor.userId,
    stageId: etapaSiguiente,
  });
  assert.equal(reasignar.status, 200, await reasignar.clone().text());
  const fila = await prisma.opportunity.findUniqueOrThrow({ where: { id: propia.id } });
  assert.equal(fila.ownerId, otroVendedor.userId);

  // Reasignada, el vendedor anterior ya no la edita.
  const yaNo = await call("PATCH", `/api/opportunities/${propia.id}`, vendedor, { title: "x" });
  assert.equal(yaNo.status, 403);

  const comoAdmin = await call("DELETE", `/api/opportunities/${propia.id}`, admin);
  assert.equal(comoAdmin.status, 204);
});

test("sin sesión, las escrituras siguen siendo 401", async () => {
  const sinToken = (method: string, path: string) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ firstName: "x", lastName: "y" }),
    });
  assert.equal((await sinToken("POST", "/api/contacts")).status, 401);
  assert.equal((await sinToken("PATCH", `/api/contacts/${randomUUID()}`)).status, 401);
  assert.equal((await sinToken("POST", "/api/opportunities")).status, 401);
  assert.equal((await sinToken("PATCH", `/api/opportunities/${randomUUID()}`)).status, 401);
});
