import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import type { OutboxEvent } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { findRoleByName } from "../repositories/role.repository";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { crearRegistroDeAcciones, registroDeAcciones } from "../services/automationActions";
import { registrarAutomatizaciones } from "../services/automationRegistrations";
import { accionCrearActividadDeSeguimiento } from "../services/automationActions/createFollowUpActivity";
import { despacharAutomatizaciones } from "../services/automationDispatch.service";
import { eventoAEntregar } from "../services/automation.test-helper";
import { createAutomation } from "../services/automation.service";
import { createBranch } from "../services/branch.service";
import { activarModulo } from "../services/organizationModules.service";
import { TRIGGER_ORDEN_CAMBIA_DE_ESTADO, TRIGGER_ORDEN_ENTREGADA } from "./eventosDeLaOrden/config";

// ---------------------------------------------------------------------------
// S8 de docs/servicios.md (§3.3 y §9): los eventos de la orden de servicio,
// contra la app real.
//
//   - Nacer en un estado (Agendado, Recibido) y cada cambio de estado emiten
//     service_order.status_changed en la misma transacción; Entregado emite
//     además service_order.delivered. Un cambio rechazado no emite nada.
//   - La regla de "cambia de estado" corre solo con sus estados destino.
//   - La tarea: al encargado de la orden, si no al responsable de la sucursal,
//     si no al ADMIN más antiguo; una por (regla, orden), aunque el evento se
//     reentregue o la orden vuelva al estado.
// ---------------------------------------------------------------------------

let taller: OrgDePrueba; // usuario 0 ADMIN (el más antiguo), 1 USER
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);

let sucursal: string;
let duena: string;

const ORDENES = "/api/servicios/ordenes";
const comoAdmin = (metodo: string, path: string, body?: unknown) =>
  pedir(taller, metodo, path, body, taller.tokens[0]);

async function vehiculo() {
  const r = await comoAdmin("POST", "/api/servicios/vehiculos", {
    contactId: duena,
    make: "Toyota",
    model: "Hilux",
    branchId: sucursal,
    licensePlate: `EVT${randomUUID().slice(0, 6)}`,
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json as { id: string };
}

async function recibida(extra: Record<string, unknown> = {}) {
  const v = await vehiculo();
  const r = await comoAdmin("POST", ORDENES, {
    customerVehicleId: v.id,
    estado: "RECIBIDO",
    mileageIn: 50000,
    ...extra,
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { orden: r.json as { id: string }, vehiculoId: v.id };
}

async function mover(id: string, body: Record<string, unknown>) {
  return comoAdmin("POST", `${ORDENES}/${id}/estado`, body);
}

/** RECIBIDO → EN_TRABAJO → LISTO_PARA_RETIRAR → ENTREGADO. */
async function hastaEntregar(id: string) {
  for (const [desde, hacia, extra] of [
    ["RECIBIDO", "EN_TRABAJO", {}],
    ["EN_TRABAJO", "LISTO_PARA_RETIRAR", {}],
    ["LISTO_PARA_RETIRAR", "ENTREGADO", { proximoService: null }],
  ] as const) {
    const r = await mover(id, { desde, hacia, ...extra });
    assert.equal(r.status, 200, `${desde} → ${hacia}: ${JSON.stringify(r.json)}`);
  }
}

async function eventosDe(serviceOrderId: string): Promise<OutboxEvent[]> {
  const todos = await prisma.outboxEvent.findMany({
    where: { organizationId: taller.id, eventType: { startsWith: "service_order." } },
    // Los dos de la entrega comparten created_at (un solo INSERT): status_changed
    // va antes que delivered.
    orderBy: [{ createdAt: "asc" }, { eventType: "desc" }],
  });
  return todos.filter(
    (e) => (e.payload as { serviceOrderId?: string }).serviceOrderId === serviceOrderId,
  );
}

async function despachar(eventos: OutboxEvent[]) {
  const registro = crearRegistroDeAcciones();
  registro.registrar(accionCrearActividadDeSeguimiento);
  for (const e of eventos) {
    await despacharAutomatizaciones(eventoAEntregar(e), e.eventType, { registro });
  }
}

async function regla(triggerType: string, triggerConfig: Record<string, unknown> = {}) {
  return createAutomation(taller.id, {
    name: `Regla ${randomUUID().slice(0, 8)}`,
    triggerType,
    triggerConfig,
    actionType: "activity.create_follow_up",
    actionConfig: { subject: "Avisarle al cliente", daysUntilDue: 0 },
  });
}

const tareasDe = (serviceOrderId: string) =>
  prisma.activity.findMany({
    where: { organizationId: taller.id, sourceServiceOrderId: serviceOrderId },
  });

before(async () => {
  if (registroDeAcciones.tiposRegistrados().length === 0) registrarAutomatizaciones();
  ({ baseUrl, cerrar } = await levantarApp());
  taller = await crearOrgDePrueba("servicios-eventos", "COMPLETA", "AUTOMOTORA", 2);
  const user = await findRoleByName("USER");
  await prisma.user.update({ where: { id: taller.authIds[1] }, data: { roleId: user!.id } });
  await prisma.organization.update({
    where: { id: taller.id },
    data: { timezone: "America/Montevideo" },
  });
  await activarModulo(taller.id, "servicios", taller.authIds[0]);
  sucursal = (await createBranch(taller.id, { name: "Centro", timezone: "America/Montevideo" })).id;
  duena = (
    await prisma.contact.create({
      data: { organizationId: taller.id, firstName: "Duena", lastName: "Prueba" },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.activity.deleteMany({ where: { organizationId: taller.id } });
  await prisma.automationExecution.deleteMany({ where: { organizationId: taller.id } });
  await prisma.automation.deleteMany({ where: { organizationId: taller.id } });
  await prisma.branch.update({ where: { id: sucursal }, data: { defaultOwnerId: null } });
});

after(async () => {
  if (cerrar) await cerrar();
  await borrarOrgDePrueba(taller);
});

test("nacer en Recibido es entrar a Recibido: status_changed con from vacío, y nada más", async () => {
  const { orden, vehiculoId } = await recibida();
  const eventos = await eventosDe(orden.id);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].eventType, TRIGGER_ORDEN_CAMBIA_DE_ESTADO);
  assert.deepEqual(eventos[0].payload, {
    serviceOrderId: orden.id,
    customerVehicleId: vehiculoId,
    contactId: duena,
    branchId: sucursal,
    from: null,
    to: "RECIBIDO",
  });
});

test("cada cambio emite status_changed; Entregado además delivered con la hora", async () => {
  const { orden } = await recibida();
  await hastaEntregar(orden.id);
  const eventos = await eventosDe(orden.id);
  assert.deepEqual(
    eventos.map((e) => {
      const p = e.payload as { from: string | null; to: string };
      return `${e.eventType} ${String(p.from)}→${p.to}`;
    }),
    [
      "service_order.status_changed null→RECIBIDO",
      "service_order.status_changed RECIBIDO→EN_TRABAJO",
      "service_order.status_changed EN_TRABAJO→LISTO_PARA_RETIRAR",
      "service_order.status_changed LISTO_PARA_RETIRAR→ENTREGADO",
      "service_order.delivered LISTO_PARA_RETIRAR→ENTREGADO",
    ],
  );
  const entregada = eventos.find((e) => e.eventType === TRIGGER_ORDEN_ENTREGADA)!;
  assert.match((entregada.payload as { deliveredAt: string }).deliveredAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("un cambio rechazado no emite nada (la transacción no se confirma)", async () => {
  const { orden } = await recibida();
  // Alguien la movió: el estado de "desde" no es el real.
  assert.equal(
    (await mover(orden.id, { desde: "EN_TRABAJO", hacia: "LISTO_PARA_RETIRAR" })).status,
    409,
  );
  // Entregar sin confirmar el próximo service.
  await mover(orden.id, { desde: "RECIBIDO", hacia: "EN_TRABAJO" });
  await mover(orden.id, { desde: "EN_TRABAJO", hacia: "LISTO_PARA_RETIRAR" });
  assert.equal(
    (await mover(orden.id, { desde: "LISTO_PARA_RETIRAR", hacia: "ENTREGADO" })).status,
    400,
  );
  assert.equal((await eventosDe(orden.id)).length, 3, "el alta y los dos cambios que pasaron");
});

test("la regla corre solo con sus estados destino, también al nacer; la tarea va al encargado, una sola", async () => {
  const listo = await regla(TRIGGER_ORDEN_CAMBIA_DE_ESTADO, { toStatuses: ["LISTO_PARA_RETIRAR"] });
  const recibido = await regla(TRIGGER_ORDEN_CAMBIA_DE_ESTADO, { toStatuses: ["RECIBIDO"] });
  const { orden } = await recibida({ assigneeId: taller.authIds[1] });
  await hastaEntregar(orden.id);
  await despachar(await eventosDe(orden.id));

  const tareas = await tareasDe(orden.id);
  assert.deepEqual(tareas.map((t) => t.sourceAutomationId).sort(), [listo.id, recibido.id].sort());
  for (const t of tareas) {
    assert.equal(t.type, "TASK");
    assert.equal(t.subject, "Avisarle al cliente");
    assert.equal(t.assigneeId, taller.authIds[1], "el encargado de la orden");
    assert.equal(t.contactId, duena);
    assert.ok(t.dueDate! > t.createdAt, "no nace vencida");
  }
  // Solo las reglas que corrieron dejan marca.
  const marcas = await prisma.automationExecution.findMany({
    where: { organizationId: taller.id },
  });
  assert.equal(marcas.filter((m) => m.automationId === listo.id).length, 1);
  assert.equal(marcas.filter((m) => m.automationId === recibido.id).length, 1);

  // Reentrega forzada: no hay otra tarea.
  await prisma.automationExecution.deleteMany({ where: { organizationId: taller.id } });
  await despachar(await eventosDe(orden.id));
  assert.equal((await tareasDe(orden.id)).length, 2);
});

test("la orden vuelve a un estado de la regla: la misma regla no crea una segunda tarea", async () => {
  await regla(TRIGGER_ORDEN_CAMBIA_DE_ESTADO, { toStatuses: ["EN_TRABAJO"] });
  const { orden } = await recibida({ assigneeId: taller.authIds[1] });
  await mover(orden.id, { desde: "RECIBIDO", hacia: "EN_TRABAJO" });
  await mover(orden.id, { desde: "EN_TRABAJO", hacia: "ESPERANDO_APROBACION" });
  const aprobacion = await comoAdmin("POST", `${ORDENES}/${orden.id}/aprobaciones`, {
    description: "Cambio de pastillas",
    decision: "APROBADO",
    approverName: "Duena",
    channel: "TELEFONO",
    decidedAt: new Date().toISOString(),
  });
  assert.ok(aprobacion.status < 300, JSON.stringify(aprobacion.json));
  assert.equal(
    (await mover(orden.id, { desde: "ESPERANDO_APROBACION", hacia: "EN_TRABAJO" })).status,
    200,
  );
  await despachar(await eventosDe(orden.id));
  assert.equal((await tareasDe(orden.id)).length, 1);
});

test("sin encargado, al responsable de la sucursal; sin responsable, al ADMIN más antiguo", async () => {
  await regla(TRIGGER_ORDEN_ENTREGADA);
  await prisma.branch.update({
    where: { id: sucursal },
    data: { defaultOwnerId: taller.authIds[1] },
  });
  const a = (await recibida()).orden;
  await hastaEntregar(a.id);
  await despachar(await eventosDe(a.id));
  assert.equal(
    (await tareasDe(a.id))[0]?.assigneeId,
    taller.authIds[1],
    "responsable de la sucursal",
  );

  await prisma.branch.update({ where: { id: sucursal }, data: { defaultOwnerId: null } });
  const b = (await recibida()).orden;
  await hastaEntregar(b.id);
  await despachar(await eventosDe(b.id));
  assert.equal((await tareasDe(b.id))[0]?.assigneeId, taller.authIds[0], "ADMIN más antiguo");

  // Un encargado inactivo no cuenta.
  await prisma.branch.update({
    where: { id: sucursal },
    data: { defaultOwnerId: taller.authIds[0] },
  });
  const c = (await recibida({ assigneeId: taller.authIds[1] })).orden;
  await prisma.user.update({ where: { id: taller.authIds[1] }, data: { isActive: false } });
  try {
    await hastaEntregar(c.id);
    await despachar(await eventosDe(c.id));
    assert.equal((await tareasDe(c.id))[0]?.assigneeId, taller.authIds[0]);
  } finally {
    await prisma.user.update({ where: { id: taller.authIds[1] }, data: { isActive: true } });
  }
});

test("toStatuses es obligatorio: la regla sin estados no se guarda", async () => {
  await assert.rejects(regla(TRIGGER_ORDEN_CAMBIA_DE_ESTADO, {}), /toStatuses/);
  await assert.rejects(
    regla(TRIGGER_ORDEN_CAMBIA_DE_ESTADO, { toStatuses: [] }),
    /al menos un estado/,
  );
});
