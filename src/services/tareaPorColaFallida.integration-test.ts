import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { emitOutboxEvent } from "../repositories/outboxEvent.repository";
import { drenarOutbox } from "../workers/outboxWorker";
import { crearRegistroDeHandlers } from "./outboxHandlers";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findRoleByName } from "../repositories/role.repository";
import {
  MAXIMO_INDIVIDUALES,
  avisarColaFallida,
  crearTareaPorColaFallida,
  type AvisoDeColaFallida,
} from "./tareaPorColaFallida";

// ---------------------------------------------------------------------------
// La tarea de un envío que se perdió (tareaPorColaFallida.ts), contra
// Postgres real.
//
//   1. Va al dueño de la oportunidad, con el nombre del cliente en el asunto,
//      el contacto, la oportunidad y vencimiento hoy.
//   2. Mientras esa tarea siga abierta, otro fallo igual no crea otra; una vez
//      cerrada, sí.
//   3. El asignado que propone la cola gana; uno inactivo se saltea.
//   4. Sin dueño activo, va al dueño del contacto y, si no, al ADMIN.
//   5. Sin contacto, se ata a la oportunidad; sin ninguno de los dos, nada
//      (la base exige empresa, contacto u oportunidad).
//   6. Contacto borrado: no se crea nada.
//   7. avisarColaFallida no lanza aunque armar el aviso falle.
//   9. Desde la 4.ª falla del día: UNA tarea agrupada, sin nombres, que se
//      actualiza con el número en vez de duplicarse; va al asignado del grupo.
//   8. De punta a punta en el outbox: un evento con contacto que agota sus
//      intentos deja una tarea al ADMIN, atada a ese contacto.
// ---------------------------------------------------------------------------

let orgId: string;
let pipelineId: string;
let stageId: string;
const authIds: string[] = [];
let adminId: string;
let vendedorId: string;
let otroVendedorId: string;

async function crearUsuario(rolNombre: "ADMIN" | "USER", etiqueta: string) {
  const email = `tarea-cola-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password: "Tarea-cola-test-123!",
    email_confirm: true,
  });
  if (error || !data.user)
    throw new Error(`No se pudo crear el usuario de Auth: ${error?.message}`);
  authIds.push(data.user.id);
  const rol = await findRoleByName(rolNombre);
  if (!rol) throw new Error(`No está sembrado el rol ${rolNombre}. Abortando.`);
  const user = await prisma.user.create({
    data: { id: data.user.id, organizationId: orgId, roleId: rol.id, email, fullName: etiqueta },
  });
  return user.id;
}

async function crearContacto(ownerId: string | null = null) {
  return prisma.contact.create({
    data: { organizationId: orgId, firstName: "Ana", lastName: randomUUID().slice(0, 6), ownerId },
  });
}

async function crearOportunidad(contactId: string, ownerId: string) {
  return prisma.opportunity.create({
    data: { organizationId: orgId, title: "Venta", pipelineId, stageId, contactId, ownerId },
  });
}

function aviso(extra: Partial<AvisoDeColaFallida>): AvisoDeColaFallida {
  return {
    organizationId: orgId,
    asunto: (cliente) => `Contactar a ${cliente}: no le llegó el WhatsApp de prueba`,
    cuerpo: "Cuerpo de prueba",
    // Por defecto, la primera falla del día: tarea individual.
    grupo: { etiqueta: "envíos de prueba", contarFallidosDesde: () => Promise.resolve(1) },
    ...extra,
  };
}

function tareasDe(contactId: string | null) {
  return prisma.activity.findMany({
    where: { organizationId: orgId, contactId, type: "TASK", deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
}

before(async () => {
  process.env.LOG_LEVEL = "fatal";
  const org = await prisma.organization.create({
    data: {
      name: `Tarea cola ${randomUUID()}`,
      slug: `tarea-cola-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  orgId = org.id;
  const pipeline = await prisma.pipeline.create({
    data: { organizationId: orgId, name: "Ventas" },
  });
  pipelineId = pipeline.id;
  stageId = (
    await prisma.stage.create({
      data: { organizationId: orgId, pipelineId, name: "Nuevo", order: 0 },
    })
  ).id;
  adminId = await crearUsuario("ADMIN", "admin");
  vendedorId = await crearUsuario("USER", "vendedor");
  otroVendedorId = await crearUsuario("USER", "otro");
});

after(async () => {
  if (orgId) {
    await prisma.activity.deleteMany({ where: { organizationId: orgId } });
    await prisma.outboxEvent.deleteMany({ where: { organizationId: orgId } });
    await prisma.opportunity.deleteMany({ where: { organizationId: orgId } });
    await prisma.contact.deleteMany({ where: { organizationId: orgId } });
    await prisma.stage.deleteMany({ where: { organizationId: orgId } });
    await prisma.pipeline.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  }
  for (const id of authIds) await getSupabaseAdmin().auth.admin.deleteUser(id);
});

test("1. va al dueño de la oportunidad, con el nombre del cliente, el contacto y vencimiento hoy", async () => {
  const contacto = await crearContacto(otroVendedorId);
  const opp = await crearOportunidad(contacto.id, vendedorId);

  const resultado = await crearTareaPorColaFallida(
    aviso({ contactId: contacto.id, opportunityId: opp.id }),
  );

  assert.equal(resultado, "CREADA");
  const [tarea] = await tareasDe(contacto.id);
  assert.equal(tarea.assigneeId, vendedorId);
  assert.equal(tarea.authorId, vendedorId);
  assert.equal(tarea.opportunityId, opp.id);
  assert.equal(
    tarea.subject,
    `Contactar a Ana ${contacto.lastName}: no le llegó el WhatsApp de prueba`,
  );
  assert.equal(tarea.body, "Cuerpo de prueba");
  assert.equal(tarea.completedAt, null);
  assert.ok(tarea.dueDate && Math.abs(tarea.dueDate.getTime() - Date.now()) < 60_000);
});

test("2. con la tarea abierta no se crea otra; una vez cerrada, sí", async () => {
  const contacto = await crearContacto(vendedorId);

  assert.equal(await crearTareaPorColaFallida(aviso({ contactId: contacto.id })), "CREADA");
  assert.equal(await crearTareaPorColaFallida(aviso({ contactId: contacto.id })), "YA_ABIERTA");
  assert.equal((await tareasDe(contacto.id)).length, 1);

  // Otro tipo de envío al mismo cliente sí crea la suya.
  const otroTipo = aviso({
    contactId: contacto.id,
    asunto: (c) => `Contactar a ${c}: no le llegó otra cosa`,
  });
  assert.equal(await crearTareaPorColaFallida(otroTipo), "CREADA");

  const [primera] = await tareasDe(contacto.id);
  await prisma.activity.update({ where: { id: primera.id }, data: { completedAt: new Date() } });
  assert.equal(await crearTareaPorColaFallida(aviso({ contactId: contacto.id })), "CREADA");
  assert.equal((await tareasDe(contacto.id)).length, 3);
});

test("3. el asignado que propone la cola gana; si está inactivo, se saltea", async () => {
  const contacto = await crearContacto(vendedorId);
  await crearTareaPorColaFallida(aviso({ contactId: contacto.id, asignado: otroVendedorId }));
  assert.equal((await tareasDe(contacto.id))[0].assigneeId, otroVendedorId);

  const inactivo = await crearUsuario("USER", "inactivo");
  await prisma.user.update({ where: { id: inactivo }, data: { isActive: false } });
  const otro = await crearContacto(vendedorId);
  await crearTareaPorColaFallida(aviso({ contactId: otro.id, asignado: inactivo }));
  assert.equal((await tareasDe(otro.id))[0].assigneeId, vendedorId, "cae al dueño del contacto");
});

test("4. sin dueño activo de la oportunidad ni del contacto, va al ADMIN", async () => {
  const inactivo = await crearUsuario("USER", "baja");
  const contacto = await crearContacto(null);
  const opp = await crearOportunidad(contacto.id, inactivo);
  await prisma.user.update({ where: { id: inactivo }, data: { isActive: false } });

  await crearTareaPorColaFallida(aviso({ contactId: contacto.id, opportunityId: opp.id }));

  assert.equal((await tareasDe(contacto.id))[0].assigneeId, adminId);
});

test("5. sin contacto, la tarea se ata a la oportunidad (una sola abierta); sin ninguno de los dos, no hay tarea", async () => {
  const contacto = await crearContacto(null);
  const opp = await crearOportunidad(contacto.id, vendedorId);
  const sinContacto = aviso({ opportunityId: opp.id, asunto: () => "No se pudo ejecutar algo" });

  assert.equal(await crearTareaPorColaFallida(sinContacto), "CREADA");
  assert.equal(await crearTareaPorColaFallida(sinContacto), "YA_ABIERTA");
  const tareas = await prisma.activity.findMany({
    where: { organizationId: orgId, opportunityId: opp.id, type: "TASK" },
  });
  assert.equal(tareas.length, 1);
  assert.equal(tareas[0].contactId, null);
  assert.equal(tareas[0].assigneeId, vendedorId);

  // La base exige empresa, contacto u oportunidad: sin nada, no se crea.
  const antes = await prisma.activity.count({ where: { organizationId: orgId } });
  assert.equal(await crearTareaPorColaFallida(aviso({})), "SIN_RELACION");
  assert.equal(
    await crearTareaPorColaFallida(aviso({ opportunityId: randomUUID() })),
    "SIN_RELACION",
    "una oportunidad que no existe tampoco cuenta",
  );
  assert.equal(await prisma.activity.count({ where: { organizationId: orgId } }), antes);
});

test("6. contacto borrado: no hay a quién llamar y no se crea nada", async () => {
  const contacto = await crearContacto(vendedorId);
  await prisma.contact.update({ where: { id: contacto.id }, data: { deletedAt: new Date() } });

  assert.equal(await crearTareaPorColaFallida(aviso({ contactId: contacto.id })), "SIN_CONTACTO");
  assert.equal((await tareasDe(contacto.id)).length, 0);
});

test("7. avisarColaFallida no lanza aunque armar el aviso falle", async () => {
  await avisarColaFallida("prueba", () => Promise.reject(new Error("la base no responde")));
});

test("8. outbox: un evento con contacto que agota sus intentos deja la tarea al ADMIN", async () => {
  const contacto = await crearContacto(vendedorId);
  const registro = crearRegistroDeHandlers();
  registro.registrar("test.tarea-cola", () => Promise.reject(new Error("nunca funciona")));
  const evento = await prisma.$transaction((tx) =>
    emitOutboxEvent(
      { organizationId: orgId, eventType: "test.tarea-cola", payload: { contactId: contacto.id } },
      tx,
    ),
  );

  for (let i = 0; i < env.OUTBOX_MAX_ATTEMPTS; i++) {
    await drenarOutbox({ organizationId: orgId, registro });
    await prisma.outboxEvent.updateMany({
      where: { id: evento.id, status: "PENDING" },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
  }

  const fila = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: evento.id } });
  assert.equal(fila.status, "DEAD_LETTER");
  const [tarea] = await tareasDe(contacto.id);
  assert.equal(tarea.subject, "Un proceso automático no se pudo completar");
  assert.equal(
    tarea.assigneeId,
    adminId,
    "es configuración: va al ADMIN, no al dueño del contacto",
  );
});

test("9. desde la 4.ª falla del día, una sola tarea agrupada que se actualiza", async () => {
  const etiqueta = `grupo ${randomUUID().slice(0, 6)}`;
  const conFallas = (n: number, contactId: string, asignado?: string) =>
    aviso({
      contactId,
      grupo: { etiqueta, asignado, contarFallidosDesde: () => Promise.resolve(n) },
    });
  const primero = await crearContacto(vendedorId);
  const segundo = await crearContacto(vendedorId);
  const delGrupo = () =>
    prisma.activity.findMany({
      where: { organizationId: orgId, subject: { startsWith: `Más ${etiqueta} ` } },
    });

  assert.equal(
    await crearTareaPorColaFallida(conFallas(MAXIMO_INDIVIDUALES, primero.id)),
    "CREADA",
  );
  assert.equal(
    await crearTareaPorColaFallida(conFallas(MAXIMO_INDIVIDUALES + 1, segundo.id, otroVendedorId)),
    "AGRUPADA",
  );
  let [grupo] = await delGrupo();
  assert.match(grupo.subject, /que no salieron el \d{2}\/\d{2}: 1$/);
  assert.equal(grupo.contactId, segundo.id, "atada al primer cliente del grupo");
  assert.equal(grupo.assigneeId, otroVendedorId, "va al asignado del grupo");
  assert.ok(!grupo.body?.includes(segundo.lastName), "sin nombres en el texto");
  assert.ok(grupo.body?.includes("/envios-que-no-salieron"));
  assert.equal((await tareasDe(segundo.id)).length, 1, "el 4.º no tiene tarea individual");

  const tercero = await crearContacto(vendedorId);
  assert.equal(
    await crearTareaPorColaFallida(conFallas(MAXIMO_INDIVIDUALES + 3, tercero.id)),
    "AGRUPADA",
  );
  const todas = await delGrupo();
  assert.equal(todas.length, 1, "se actualiza, no se duplica");
  [grupo] = todas;
  assert.match(grupo.subject, /: 3$/);
  assert.equal((await tareasDe(tercero.id)).length, 0);

  // Sin asignado propio, va al ADMIN.
  const otraEtiqueta = aviso({
    contactId: tercero.id,
    grupo: { etiqueta: `${etiqueta}-b`, contarFallidosDesde: () => Promise.resolve(10) },
  });
  await crearTareaPorColaFallida(otraEtiqueta);
  const [deOtraCola] = await prisma.activity.findMany({
    where: { organizationId: orgId, subject: { startsWith: `Más ${etiqueta}-b ` } },
  });
  assert.equal(deOtraCola.assigneeId, adminId);
});
