import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import type { ContextoDeEjecucionDeTool, ResultadoDeTool } from "../services/agentTools.service";
import { relojDeReservas } from "../services/booking.service";
import { createBranch } from "../services/branch.service";
import { createResource } from "../services/resource.service";
import { createServiceType } from "../services/serviceType.service";
import { replaceWorkingHoursForResource } from "../services/workingHours.service";
import {
  MARCA_DEL_ASISTENTE,
  PREFIJO_NOTA_REPROGRAMADO,
} from "../clinicas/services/reprogramar.service";
import { PREFIJO_NOTA_CANCELADO } from "../clinicas/toolsDeTurnos";
import {
  PREFIJO_TAREA_CANCELADO,
  PREFIJO_TAREA_REPROGRAMADO,
  TEXTOS_DE_TURNOS_DE_AUTOMOTORA,
  TOOLS_DE_TURNOS_DE_AUTOMOTORA,
} from "./toolsDeTurnos";

// ---------------------------------------------------------------------------
// Ver, reprogramar y cancelar turnos en el agente de una AUTOMOTORA (decisión
// de Rocco, 2026-10-31), contra Postgres real:
//
//   1. get_contact_bookings lista los turnos del cliente con claves de
//      automotora (servicio, recurso), nunca "prestación" ni "profesional".
//   2. Reprogramar mueve el MISMO turno, deja la nota del historial y una
//      TAREA para el vendedor del cliente, con el horario de antes y el de
//      ahora, que vence en el momento. Sin eventos de turno (R10).
//   3. Sin vendedor del cliente, la tarea va al vendedor por defecto de la
//      sucursal; sin ninguno, queda solo la nota.
//   4. Cancelar va en dos pasos; recién el segundo cancela, con nota + tarea.
//
// Las reglas compartidas con la clínica (candado de identidad, turno de otro
// contacto o de otra sucursal, plazo mínimo, horario) ya las cubre
// src/clinicas/toolsDeTurnos.integration-test.ts: es la misma implementación.
// ---------------------------------------------------------------------------

const TZ = "America/Montevideo";
// Lunes 1 de marzo de 2027, en Montevideo (UTC-3).
const LUNES = (hora: number) =>
  new Date(`2027-03-01T${String(hora + 3).padStart(2, "0")}:00:00.000Z`);
const AHORA_FIJO = new Date("2027-02-28T12:00:00Z");
const LUNES_9_A_13 = [{ weekday: "MONDAY" as const, startMinute: 540, endMinute: 780 }];

const ADMIN = 0;
const VENDEDOR = 1;
const VENDEDOR_DE_LA_SUCURSAL = 2;

let org: OrgDePrueba;
const ids = {} as {
  centro: string;
  sinVendedor: string;
  recurso: string;
  recursoSinVendedor: string;
  testDrive: string;
  testDriveSinVendedor: string;
  conVendedor: string;
  sinVendedorPropio: string;
  agenteCentro: string;
  agenteSinVendedor: string;
};

before(async () => {
  mock.method(relojDeReservas, "ahora", () => AHORA_FIJO);
  org = await crearOrgDePrueba("turnos-automotora", "COMPLETA", "AUTOMOTORA", 3);
  const centro = await createBranch(org.id, {
    name: "Centro",
    timezone: TZ,
    defaultOwnerId: org.authIds[VENDEDOR_DE_LA_SUCURSAL],
  });
  const sinVendedor = await createBranch(org.id, { name: "Norte", timezone: TZ });
  ids.centro = centro.id;
  ids.sinVendedor = sinVendedor.id;

  const recursoDe = async (branchId: string) => {
    const r = await createResource(org.id, { branchId, name: "Hilux de prueba", type: "ROOM" });
    await replaceWorkingHoursForResource(org.id, r.id, LUNES_9_A_13);
    return r.id;
  };
  ids.recurso = await recursoDe(centro.id);
  ids.recursoSinVendedor = await recursoDe(sinVendedor.id);
  const servicioDe = async (branchId: string, resourceId: string) =>
    (
      await createServiceType(org.id, {
        branchId,
        resourceId,
        name: "Prueba de manejo",
        durationMin: 60,
      })
    ).id;
  ids.testDrive = await servicioDe(centro.id, ids.recurso);
  ids.testDriveSinVendedor = await servicioDe(sinVendedor.id, ids.recursoSinVendedor);

  ids.conVendedor = (
    await prisma.contact.create({
      data: {
        organizationId: org.id,
        firstName: "Cliente",
        lastName: "Ejemplo",
        phone: "+59899000011",
        ownerId: org.authIds[VENDEDOR],
      },
    })
  ).id;
  ids.sinVendedorPropio = (
    await prisma.contact.create({
      data: {
        organizationId: org.id,
        firstName: "Otra",
        lastName: "Persona",
        phone: "+59899000012",
      },
    })
  ).id;

  const agente = (branchId: string) =>
    prisma.agent.create({
      data: {
        organizationId: org.id,
        branchId,
        name: "Asistente",
        instructions: "Sos el asistente de la automotora.",
        modelProvider: "openrouter",
        modelName: "doble/modelo",
        enabledTools: Object.keys(TOOLS_DE_TURNOS_DE_AUTOMOTORA),
        channels: ["WHATSAPP"],
        guardrails: {} as Prisma.InputJsonValue,
        participation: "AUTONOMA",
        participationChosenAt: new Date(),
      },
    });
  ids.agenteCentro = (await agente(centro.id)).id;
  ids.agenteSinVendedor = (await agente(sinVendedor.id)).id;
});

after(async () => {
  mock.restoreAll();
  if (!org) return;
  const where = { organizationId: org.id };
  await prisma.message.deleteMany({ where });
  await prisma.conversation.deleteMany({ where });
  await prisma.activity.deleteMany({ where });
  await prisma.outboxEvent.deleteMany({ where });
  await prisma.booking.deleteMany({ where });
  await prisma.agent.deleteMany({ where });
  await prisma.serviceType.deleteMany({ where });
  await prisma.workingHours.deleteMany({ where });
  await prisma.resource.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
  await borrarOrgDePrueba(org);
});

beforeEach(async () => {
  const where = { organizationId: org.id };
  await prisma.message.deleteMany({ where });
  await prisma.conversation.deleteMany({ where });
  await prisma.activity.deleteMany({ where });
  await prisma.outboxEvent.deleteMany({ where });
  await prisma.booking.deleteMany({ where });
});

function turno(contactId: string, inicio: Date, sucursal: "centro" | "norte" = "centro") {
  const centro = sucursal === "centro";
  return prisma.booking.create({
    data: {
      organizationId: org.id,
      branchId: centro ? ids.centro : ids.sinVendedor,
      serviceTypeId: centro ? ids.testDrive : ids.testDriveSinVendedor,
      resourceId: centro ? ids.recurso : ids.recursoSinVendedor,
      contactId,
      startsAt: inicio,
      endsAt: new Date(inicio.getTime() + 60 * 60 * 1000),
    },
  });
}

async function conversacion(
  contactId: string,
  sucursal: "centro" | "norte" = "centro",
): Promise<ContextoDeEjecucionDeTool> {
  const centro = sucursal === "centro";
  const c = await prisma.conversation.create({
    data: {
      organizationId: org.id,
      branchId: centro ? ids.centro : ids.sinVendedor,
      agentId: centro ? ids.agenteCentro : ids.agenteSinVendedor,
      contactId,
      channel: "WHATSAPP",
    },
  });
  return {
    organizationId: org.id,
    conversation: {
      id: c.id,
      contactId,
      branchId: c.branchId,
      agentId: c.agentId,
      channel: c.channel,
    },
  };
}

function ejecutar(
  nombre: string,
  args: Record<string, unknown>,
  contexto: ContextoDeEjecucionDeTool,
): Promise<ResultadoDeTool> {
  return TOOLS_DE_TURNOS_DE_AUTOMOTORA[nombre].ejecutar(args, contexto);
}

function actividades(contactId: string) {
  return prisma.activity.findMany({
    where: { organizationId: org.id, contactId },
    orderBy: { createdAt: "asc" },
  });
}

test("get_contact_bookings: los turnos del cliente con claves de automotora", async () => {
  const t = await turno(ids.conVendedor, LUNES(10));
  const r = await ejecutar("get_contact_bookings", {}, await conversacion(ids.conVendedor));
  assert.ok(r.ok);
  const [visto] = (r.data as { turnos: Record<string, unknown>[] }).turnos;
  assert.equal(visto.bookingId, t.id);
  assert.equal(visto.servicio, "Prueba de manejo");
  assert.deepEqual(visto.recurso, { id: ids.recurso, name: "Hilux de prueba" });
  assert.equal(visto.prestacion, undefined);
  assert.equal(visto.profesional, undefined);
});

test("los textos de las tools no hablan de pacientes, profesionales ni sedes", () => {
  const textos = Object.values(TOOLS_DE_TURNOS_DE_AUTOMOTORA)
    .map((tool) => JSON.stringify(tool.definition))
    .concat(JSON.stringify({ ...TEXTOS_DE_TURNOS_DE_AUTOMOTORA, fueraDePlazo: null }))
    .concat(TEXTOS_DE_TURNOS_DE_AUTOMOTORA.fueraDePlazo(2))
    .join(" ");
  assert.doesNotMatch(textos, /\b(pacientes?|profesional(es)?|sedes?|prestaci[oó]n)\b/i);
});

test("reprogramar: el mismo turno, nota del historial y tarea para el vendedor del cliente que vence ya", async () => {
  const t = await turno(ids.conVendedor, LUNES(10));
  const r = await ejecutar(
    "reschedule_booking",
    { bookingId: t.id, startsAt: "2027-03-01T11:00:00-03:00" },
    await conversacion(ids.conVendedor),
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal((r.data as { recursoId: string }).recursoId, ids.recurso);

  const movido = await prisma.booking.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(movido.startsAt.getTime(), LUNES(11).getTime());
  assert.equal(movido.status, "CONFIRMED");

  const [nota, tarea, ...resto] = await actividades(ids.conVendedor);
  assert.equal(resto.length, 0);
  assert.equal(nota.type, "NOTE");
  assert.equal(nota.subject, `${MARCA_DEL_ASISTENTE}${PREFIJO_NOTA_REPROGRAMADO}Cliente Ejemplo`);
  assert.equal(tarea.type, "TASK");
  assert.equal(tarea.assigneeId, org.authIds[VENDEDOR]);
  assert.equal(tarea.subject, `${MARCA_DEL_ASISTENTE}${PREFIJO_TAREA_REPROGRAMADO}Cliente Ejemplo`);
  assert.equal(tarea.dueDate?.getTime(), AHORA_FIJO.getTime(), "vence en el momento");
  assert.equal(tarea.completedAt, null);
  assert.match(tarea.body ?? "", /Antes: lunes 1 de marzo a las 10:00 con Hilux de prueba/);
  assert.match(tarea.body ?? "", /Ahora: lunes 1 de marzo a las 11:00 con Hilux de prueba/);

  // R10: una automotora no emite eventos de turno.
  assert.equal(await prisma.outboxEvent.count({ where: { organizationId: org.id } }), 0);
});

test("reprogramar a un horario fuera del horario del recurso: no se mueve y no se avisa nada", async () => {
  const t = await turno(ids.conVendedor, LUNES(10));
  const r = await ejecutar(
    "reschedule_booking",
    { bookingId: t.id, startsAt: "2027-03-01T18:00:00-03:00" },
    await conversacion(ids.conVendedor),
  );
  assert.equal(r.ok, false);
  const igual = await prisma.booking.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(igual.startsAt.getTime(), LUNES(10).getTime());
  assert.equal((await actividades(ids.conVendedor)).length, 0);
});

test("sin vendedor del cliente, la tarea va al vendedor por defecto de la sucursal", async () => {
  const t = await turno(ids.sinVendedorPropio, LUNES(10));
  const r = await ejecutar(
    "reschedule_booking",
    { bookingId: t.id, startsAt: "2027-03-01T12:00:00-03:00" },
    await conversacion(ids.sinVendedorPropio),
  );
  assert.ok(r.ok, JSON.stringify(r));
  const tarea = (await actividades(ids.sinVendedorPropio)).find((a) => a.type === "TASK");
  assert.equal(tarea?.assigneeId, org.authIds[VENDEDOR_DE_LA_SUCURSAL]);
});

test("sin vendedor del cliente ni de la sucursal, queda solo la nota", async () => {
  const t = await turno(ids.sinVendedorPropio, LUNES(10), "norte");
  const r = await ejecutar(
    "reschedule_booking",
    { bookingId: t.id, startsAt: "2027-03-01T12:00:00-03:00" },
    await conversacion(ids.sinVendedorPropio, "norte"),
  );
  assert.ok(r.ok, JSON.stringify(r));
  const hechas = await actividades(ids.sinVendedorPropio);
  assert.deepEqual(
    hechas.map((a) => a.type),
    ["NOTE"],
  );
  // La nota la firma alguien (el ADMIN más antiguo), aunque la pantalla
  // muestre "Asistente".
  assert.equal(hechas[0].authorId, org.authIds[ADMIN]);
});

test("cancelar en dos pasos: el primero no toca nada; el segundo cancela con nota y tarea para el vendedor", async () => {
  const t = await turno(ids.conVendedor, LUNES(10));
  const contexto = await conversacion(ids.conVendedor);

  const paso1 = await ejecutar("cancel_booking", { bookingId: t.id }, contexto);
  assert.ok(paso1.ok);
  const resumen = paso1.data as { requiereConfirmacion: boolean; turno: Record<string, string> };
  assert.equal(resumen.requiereConfirmacion, true);
  assert.equal(resumen.turno.servicio, "Prueba de manejo");
  assert.equal(
    (await prisma.booking.findUniqueOrThrow({ where: { id: t.id } })).status,
    "CONFIRMED",
  );
  assert.equal((await actividades(ids.conVendedor)).length, 0);

  // Lo que deja el loop: el mensaje del agente con el resumen, y la respuesta
  // del cliente DESPUÉS.
  const base = { organizationId: org.id, conversationId: contexto.conversation.id };
  await prisma.message.create({
    data: {
      ...base,
      direction: "OUTBOUND",
      senderType: "AGENT",
      content: "¿Confirmas que cancelas tu prueba de manejo del lunes a las 10?",
      toolCalls: [{ name: "cancel_booking", result: paso1 }] as Prisma.InputJsonValue,
      createdAt: new Date(AHORA_FIJO.getTime() - 60_000),
    },
  });
  await prisma.message.create({
    data: {
      ...base,
      direction: "INBOUND",
      senderType: "CONTACT",
      content: "sí",
      createdAt: new Date(AHORA_FIJO.getTime() - 30_000),
    },
  });

  const paso2 = await ejecutar("cancel_booking", { bookingId: t.id, confirmado: true }, contexto);
  assert.ok(paso2.ok, JSON.stringify(paso2));
  assert.equal((paso2.data as { cancelado: boolean }).cancelado, true);
  assert.equal(
    (await prisma.booking.findUniqueOrThrow({ where: { id: t.id } })).status,
    "CANCELLED",
  );

  const [nota, tarea, ...resto] = await actividades(ids.conVendedor);
  assert.equal(resto.length, 0);
  assert.equal(nota.subject, `${MARCA_DEL_ASISTENTE}${PREFIJO_NOTA_CANCELADO}Cliente Ejemplo`);
  assert.match(nota.body ?? "", /a pedido del cliente/);
  assert.equal(tarea.type, "TASK");
  assert.equal(tarea.assigneeId, org.authIds[VENDEDOR]);
  assert.equal(tarea.subject, `${MARCA_DEL_ASISTENTE}${PREFIJO_TAREA_CANCELADO}Cliente Ejemplo`);
  assert.equal(tarea.dueDate?.getTime(), AHORA_FIJO.getTime());
  assert.match(tarea.body ?? "", /lunes 1 de marzo a las 10:00 con Hilux de prueba/);
  assert.equal(await prisma.outboxEvent.count({ where: { organizationId: org.id } }), 0);
});
