import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { findRoleByName } from "../repositories/role.repository";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { createBranch } from "../services/branch.service";
import { activarModulo } from "../services/organizationModules.service";
import {
  FALTA_REGISTRAR_LA_APROBACION,
  ORDEN_FINAL,
  ORDEN_MOVIDA,
  VEHICULO_EN_EL_TALLER,
} from "./services/ordenes.service";

// ---------------------------------------------------------------------------
// S4a de docs/servicios.md: órdenes de servicio (§2.3–§2.5, §3, §6.1) contra la
// app real, con usuarios de Supabase local y el módulo activado.
//
//   - Número consecutivo sin huecos, también con altas simultáneas.
//   - Un auto no está dos veces dentro del taller (409 con la orden).
//   - El estado cambia solo desde el que se dice (409 si alguien la movió).
//   - Lo que pide cada transición; salir de Esperando aprobación exige una
//     aprobación registrada; Entregado copia el próximo service al vehículo.
//   - Entregado y Cancelado son finales. Configuración y tipos: solo ADMIN.
// ---------------------------------------------------------------------------

let taller: OrgDePrueba; // usuario 0 ADMIN, 1 USER
let otra: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);

let sucursal: string;
let duena: string;
let tipo6: string; // Service con próximo a los 6 meses
let tipo12: string; // a los 12

const ORDENES = "/api/servicios/ordenes";
const comoAdmin = (metodo: string, path: string, body?: unknown) =>
  pedir(taller, metodo, path, body, taller.tokens[0]);
const comoUser = (metodo: string, path: string, body?: unknown) =>
  pedir(taller, metodo, path, body, taller.tokens[1]);

async function vehiculo(extra: Record<string, unknown> = {}) {
  const r = await comoAdmin("POST", "/api/servicios/vehiculos", {
    contactId: duena,
    make: "Toyota",
    model: "Hilux",
    branchId: sucursal,
    licensePlate: `ORD${randomUUID().slice(0, 6)}`,
    ...extra,
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json as { id: string };
}

async function recibida(vehiculoId: string, extra: Record<string, unknown> = {}) {
  const r = await comoUser("POST", ORDENES, {
    customerVehicleId: vehiculoId,
    estado: "RECIBIDO",
    mileageIn: 50000,
    ...extra,
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json as Record<string, unknown> & { id: string };
}

async function mover(id: string, body: Record<string, unknown>, como = comoUser) {
  return como("POST", `${ORDENES}/${id}/estado`, body);
}

before(async () => {
  ({ baseUrl, cerrar } = await levantarApp());
  taller = await crearOrgDePrueba("servicios-ordenes", "COMPLETA", "AUTOMOTORA", 2);
  otra = await crearOrgDePrueba("servicios-ordenes", "COMPLETA", "AUTOMOTORA", 1);
  const user = await findRoleByName("USER");
  await prisma.user.update({ where: { id: taller.authIds[1] }, data: { roleId: user!.id } });
  await prisma.organization.update({
    where: { id: taller.id },
    data: { timezone: "America/Montevideo", preferredCurrency: "UYU" },
  });
  for (const org of [taller, otra]) await activarModulo(org.id, "servicios", org.authIds[0]);
  sucursal = (
    await createBranch(taller.id, { name: "Taller Centro", timezone: "America/Montevideo" })
  ).id;
  duena = (
    await prisma.contact.create({
      data: { organizationId: taller.id, firstName: "Duena", lastName: "Prueba" },
    })
  ).id;
  const t6 = await comoAdmin("POST", "/api/servicios/tipos", {
    name: "Cambio de aceite",
    nextServiceAfterMonths: 6,
  });
  assert.equal(t6.status, 201, JSON.stringify(t6.json));
  tipo6 = t6.json.id as string;
  tipo12 = (
    (
      await comoAdmin("POST", "/api/servicios/tipos", {
        name: "Service",
        nextServiceAfterMonths: 12,
      })
    ).json as { id: string }
  ).id;
});

after(async () => {
  if (cerrar) await cerrar();
  for (const org of [taller, otra]) await borrarOrgDePrueba(org);
});

test("alta agendada: número OS-, historial, encargado y Valor en la moneda de la organización", async () => {
  const v = await vehiculo();
  const r = await comoUser("POST", ORDENES, {
    customerVehicleId: v.id,
    estado: "AGENDADO",
    scheduledFor: "2027-01-15T13:00:00.000Z",
    assigneeId: taller.authIds[0],
    jobTypeIds: [tipo12],
    amount: 4500.5,
    notes: "Service de los 50.000",
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.match(r.json.numero as string, /^OS-\d{4,}$/);
  assert.equal(r.json.status, "AGENDADO");
  assert.equal(r.json.amount, "4500.50");
  assert.equal(r.json.currency, "UYU");
  assert.equal((r.json.contact as { id: string }).id, duena, "por defecto, el dueño");
  assert.equal((r.json.branch as { id: string }).id, sucursal, "por defecto, la del vehículo");
  assert.deepEqual(
    (r.json.tipos as { id: string }[]).map((t) => t.id),
    [tipo12],
  );
  const [alta] = r.json.historial as { fromStatus: string | null; toStatus: string }[];
  assert.equal(alta.fromStatus, null);
  assert.equal(alta.toStatus, "AGENDADO");
});

test("agendada sin fecha o recibida sin km: 400", async () => {
  const v = await vehiculo();
  assert.equal(
    (await comoUser("POST", ORDENES, { customerVehicleId: v.id, estado: "AGENDADO" })).status,
    400,
  );
  assert.equal(
    (await comoUser("POST", ORDENES, { customerVehicleId: v.id, estado: "RECIBIDO" })).status,
    400,
  );
});

test("diez altas simultáneas: números consecutivos, sin repetir ni saltear", async () => {
  const vehiculos = await Promise.all(Array.from({ length: 10 }, () => vehiculo()));
  const antes = await prisma.workshopSettings.findUniqueOrThrow({
    where: { organizationId: taller.id },
  });
  const altas = await Promise.all(
    vehiculos.map((v, i) =>
      pedir(
        taller,
        "POST",
        ORDENES,
        { customerVehicleId: v.id, estado: "RECIBIDO", mileageIn: 1000 },
        taller.tokens[i % 2],
      ),
    ),
  );
  for (const a of altas) assert.equal(a.status, 201, JSON.stringify(a.json));
  const numeros = altas
    .map((a) => Number((a.json.numero as string).slice(3)))
    .sort((x, y) => x - y);
  const primero = antes.nextOrderNumber;
  assert.deepEqual(
    numeros,
    Array.from({ length: 10 }, (_, i) => primero + i),
  );
});

test("el mismo auto no entra dos veces al taller; agendarlo mientras está adentro sí se puede", async () => {
  const v = await vehiculo();
  const primera = await recibida(v.id);
  const segunda = await comoUser("POST", ORDENES, {
    customerVehicleId: v.id,
    estado: "RECIBIDO",
    mileageIn: 50100,
  });
  assert.equal(segunda.status, 409);
  assert.equal(segunda.json.error?.code, VEHICULO_EN_EL_TALLER);
  assert.equal(segunda.json.error?.ordenId, primera.id);

  const agendada = await comoUser("POST", ORDENES, {
    customerVehicleId: v.id,
    estado: "AGENDADO",
    scheduledFor: "2027-03-01T12:00:00Z",
  });
  assert.equal(agendada.status, 201);
  // Recibirla mientras la otra sigue adentro: el mismo 409.
  const recibir = await mover(agendada.json.id as string, {
    desde: "AGENDADO",
    hacia: "RECIBIDO",
    mileageIn: 50200,
  });
  assert.equal(recibir.status, 409);
  assert.equal(recibir.json.error?.code, VEHICULO_EN_EL_TALLER);
});

test("recibir: exige km y sube los del vehículo, nunca los baja", async () => {
  const v = await vehiculo({ mileage: 60000 });
  const r = await comoUser("POST", ORDENES, {
    customerVehicleId: v.id,
    estado: "AGENDADO",
    scheduledFor: "2027-01-01T12:00:00Z",
  });
  const id = r.json.id as string;
  assert.equal((await mover(id, { desde: "AGENDADO", hacia: "RECIBIDO" })).status, 400);
  const ok = await mover(id, { desde: "AGENDADO", hacia: "RECIBIDO", mileageIn: 55000 });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.mileageIn, 55000);
  assert.ok(ok.json.receivedAt);
  const fila = await prisma.customerVehicle.findUniqueOrThrow({ where: { id: v.id } });
  assert.equal(fila.mileage, 60000, "55.000 es menos: no baja");

  const v2 = await vehiculo({ mileage: 10000 });
  await recibida(v2.id, { mileageIn: 12000 });
  assert.equal(
    (await prisma.customerVehicle.findUniqueOrThrow({ where: { id: v2.id } })).mileage,
    12000,
  );
});

test("el cambio es condicional: con un desde viejo, o dos a la vez, gana uno y el otro es 409", async () => {
  const o = await recibida((await vehiculo()).id);
  const viejo = await mover(o.id, { desde: "AGENDADO", hacia: "RECIBIDO", mileageIn: 1 });
  // AGENDADO→RECIBIDO está en la tabla, pero la orden ya no está en AGENDADO.
  assert.equal(viejo.status, 409);
  assert.equal(viejo.json.error?.message, ORDEN_MOVIDA);
  const [a, b] = await Promise.all([
    mover(o.id, { desde: "RECIBIDO", hacia: "EN_TRABAJO" }),
    mover(o.id, { desde: "RECIBIDO", hacia: "LISTO_PARA_RETIRAR" }),
  ]);
  const estados = [a.status, b.status].sort();
  assert.deepEqual(estados, [200, 409]);
  const perdedor = a.status === 409 ? a : b;
  assert.equal(perdedor.json.error?.message, ORDEN_MOVIDA);
  const historial = await prisma.serviceOrderStatusChange.count({
    where: { serviceOrderId: o.id },
  });
  assert.equal(historial, 2, "el alta y un solo cambio");
});

test("una transición que no está en la tabla es 400", async () => {
  const o = await recibida((await vehiculo()).id);
  const r = await mover(o.id, { desde: "RECIBIDO", hacia: "ENTREGADO", proximoService: null });
  assert.equal(r.status, 400);
});

test("cancelar exige motivo, y la orden cancelada es final", async () => {
  const o = await recibida((await vehiculo()).id);
  assert.equal((await mover(o.id, { desde: "RECIBIDO", hacia: "CANCELADO" })).status, 400);
  const r = await mover(o.id, {
    desde: "RECIBIDO",
    hacia: "CANCELADO",
    cancelReason: "El cliente se lo llevó sin hacer nada",
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.cancelReason, "El cliente se lo llevó sin hacer nada");
  const editar = await comoUser("PATCH", `${ORDENES}/${o.id}`, { notes: "x" });
  assert.equal(editar.status, 409);
  assert.equal(editar.json.error?.message, ORDEN_FINAL);
  const aprobar = await comoUser("POST", `${ORDENES}/${o.id}/aprobaciones`, {
    description: "x",
    decision: "APROBADO",
    approverName: "x",
    channel: "TELEFONO",
    decidedAt: new Date().toISOString(),
  });
  assert.equal(aprobar.status, 409);
});

test("esperando aprobación: no sale sin una aprobación registrada después de entrar", async () => {
  const o = await recibida((await vehiculo()).id, { amount: 1000 });
  await mover(o.id, { desde: "RECIBIDO", hacia: "ESPERANDO_APROBACION" });
  const sinAprobar = await mover(o.id, { desde: "ESPERANDO_APROBACION", hacia: "EN_TRABAJO" });
  assert.equal(sinAprobar.status, 409);
  assert.equal(sinAprobar.json.error?.code, FALTA_REGISTRAR_LA_APROBACION);
  const ficha = await comoUser("GET", `${ORDENES}/${o.id}`);
  assert.equal(ficha.json.aprobacionPendiente, true);

  const aprobacion = await comoUser("POST", `${ORDENES}/${o.id}/aprobaciones`, {
    description: "Cambio de pastillas de freno",
    decision: "APROBADO",
    approverName: "El titular",
    channel: "WHATSAPP",
    decidedAt: new Date().toISOString(),
    amount: 2500,
    sumarAlValor: true,
  });
  assert.equal(aprobacion.status, 201, JSON.stringify(aprobacion.json));
  assert.equal(aprobacion.json.amount, "3500.00", "1000 + 2500, en la misma transacción");
  assert.equal(aprobacion.json.aprobacionPendiente, false);
  const [a] = aprobacion.json.aprobaciones as Record<string, unknown>[];
  assert.equal(a.currency, "UYU");
  assert.equal((a.recordedBy as { id: string }).id, taller.authIds[1]);

  assert.equal(
    (await mover(o.id, { desde: "ESPERANDO_APROBACION", hacia: "EN_TRABAJO" })).status,
    200,
  );
  // Volver a esperar: la aprobación de antes ya no alcanza.
  await mover(o.id, { desde: "EN_TRABAJO", hacia: "ESPERANDO_APROBACION" });
  const otraVez = await mover(o.id, { desde: "ESPERANDO_APROBACION", hacia: "LISTO_PARA_RETIRAR" });
  assert.equal(otraVez.status, 409);
});

test("esperando aprobación: cancelar no exige la aprobación, solo el motivo", async () => {
  const o = await recibida((await vehiculo()).id);
  await mover(o.id, { desde: "RECIBIDO", hacia: "ESPERANDO_APROBACION" });
  const sinMotivo = await mover(o.id, { desde: "ESPERANDO_APROBACION", hacia: "CANCELADO" });
  assert.equal(sinMotivo.status, 400);
  const r = await mover(o.id, {
    desde: "ESPERANDO_APROBACION",
    hacia: "CANCELADO",
    cancelReason: "El cliente no respondió",
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, "CANCELADO");
  assert.equal(await prisma.serviceOrderApproval.count({ where: { serviceOrderId: o.id } }), 0);
});

test("sumar al valor en otra moneda es 400 y no registra nada", async () => {
  const o = await recibida((await vehiculo()).id, { amount: 100 });
  const r = await comoUser("POST", `${ORDENES}/${o.id}/aprobaciones`, {
    description: "Alineación",
    decision: "APROBADO",
    approverName: "El titular",
    channel: "TELEFONO",
    decidedAt: new Date().toISOString(),
    amount: 50,
    currency: "USD",
    sumarAlValor: true,
  });
  assert.equal(r.status, 400);
  assert.equal(await prisma.serviceOrderApproval.count({ where: { serviceOrderId: o.id } }), 0);
});

test("entregar: propone el intervalo menor, exige confirmarlo y lo copia al vehículo", async () => {
  const v = await vehiculo({ nextServiceDueOn: "2026-11-01" });
  const o = await recibida(v.id, { jobTypeIds: [tipo12, tipo6] });
  await mover(o.id, { desde: "RECIBIDO", hacia: "LISTO_PARA_RETIRAR" });
  const ficha = await comoUser("GET", `${ORDENES}/${o.id}`);
  const propuesta = ficha.json.proximoServicePropuesto as { meses: number; fecha: string };
  assert.equal(propuesta.meses, 6, "manda el menor");
  assert.match(propuesta.fecha, /^\d{4}-\d{2}-\d{2}$/);

  const sinConfirmar = await mover(o.id, { desde: "LISTO_PARA_RETIRAR", hacia: "ENTREGADO" });
  assert.equal(sinConfirmar.status, 400);
  const r = await mover(o.id, {
    desde: "LISTO_PARA_RETIRAR",
    hacia: "ENTREGADO",
    proximoService: "2027-05-20",
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.deliveredAt);
  assert.equal(r.json.nextServiceDueOn, "2027-05-20");
  const fila = await prisma.customerVehicle.findUniqueOrThrow({ where: { id: v.id } });
  assert.equal(fila.nextServiceDueOn?.toISOString().slice(0, 10), "2027-05-20");
  assert.equal(fila.nextServiceSetFromOrderId, o.id);

  // Final: no se mueve más.
  const otra = await mover(o.id, { desde: "ENTREGADO", hacia: "EN_TRABAJO" });
  assert.equal(otra.status, 400);

  // El historial del vehículo la muestra.
  const historial = await comoUser("GET", `/api/servicios/vehiculos/${v.id}/ordenes`);
  const [h] = historial.json as unknown as { id: string; status: string }[];
  assert.equal(h.id, o.id);
  assert.equal(h.status, "ENTREGADO");
});

test("entregar sin próximo service deja el vehículo sin fecha", async () => {
  const v = await vehiculo({ nextServiceDueOn: "2026-11-01" });
  const o = await recibida(v.id);
  await mover(o.id, { desde: "RECIBIDO", hacia: "LISTO_PARA_RETIRAR" });
  const r = await mover(o.id, {
    desde: "LISTO_PARA_RETIRAR",
    hacia: "ENTREGADO",
    proximoService: null,
  });
  assert.equal(r.status, 200);
  const fila = await prisma.customerVehicle.findUniqueOrThrow({ where: { id: v.id } });
  assert.equal(fila.nextServiceDueOn, null);
});

test("editar: encargado, notas, valor y tipos; un tipo inactivo nuevo no, uno que ya tenía sí", async () => {
  const inactivo = await comoAdmin("POST", "/api/servicios/tipos", {
    name: "Tipo viejo",
    isActive: true,
  });
  const o = await recibida((await vehiculo()).id, { jobTypeIds: [inactivo.json.id] });
  await comoAdmin("PATCH", `/api/servicios/tipos/${inactivo.json.id}`, { isActive: false });

  const ok = await comoUser("PATCH", `${ORDENES}/${o.id}`, {
    assigneeId: taller.authIds[1],
    notes: "Revisar ruido",
    jobTypeIds: [inactivo.json.id, tipo6],
    amount: 900,
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal((ok.json.assignee as { id: string }).id, taller.authIds[1]);
  assert.equal((ok.json.tipos as unknown[]).length, 2);
  assert.equal(ok.json.currency, "UYU");

  const otroInactivo = await comoAdmin("POST", "/api/servicios/tipos", {
    name: "Inactivo",
    isActive: false,
  });
  const no = await comoUser("PATCH", `${ORDENES}/${o.id}`, {
    jobTypeIds: [otroInactivo.json.id],
  });
  assert.equal(no.status, 404);
  const ajeno = await comoUser("PATCH", `${ORDENES}/${o.id}`, { assigneeId: otra.authIds[0] });
  assert.equal(ajeno.status, 404);
});

test("listado y búsqueda: por estados, por número y por matrícula", async () => {
  const v = await vehiculo({ licensePlate: "BUS 4321" });
  const o = await recibida(v.id);
  const ids = async (query: string) =>
    ((await comoUser("GET", `${ORDENES}?${query}`)).json.data as { id: string }[]).map((x) => x.id);
  assert.ok((await ids("estados=RECIBIDO,EN_TRABAJO")).includes(o.id));
  assert.ok(!(await ids("estados=ENTREGADO")).includes(o.id));
  assert.ok((await ids(`q=${encodeURIComponent(o.numero as string)}`)).includes(o.id));
  assert.ok((await ids("q=bus-43")).includes(o.id));
  const item = (
    (await comoUser("GET", `${ORDENES}?q=bus43`)).json.data as Record<string, unknown>[]
  )[0];
  assert.ok(item.enEstadoDesde);
  assert.equal((item.vehiculo as { licensePlate: string }).licensePlate, "BUS 4321");
});

test("aislamiento: la orden y el vehículo de otra organización son 404", async () => {
  const ajeno = await pedir(otra, "POST", "/api/servicios/vehiculos", {
    contactId: (
      await prisma.contact.create({
        data: { organizationId: otra.id, firstName: "Otra", lastName: "Org" },
      })
    ).id,
    make: "A",
    model: "B",
    branchId: (await createBranch(otra.id, { name: "S", timezone: "UTC" })).id,
  });
  const orden = await pedir(otra, "POST", ORDENES, {
    customerVehicleId: ajeno.json.id,
    estado: "RECIBIDO",
    mileageIn: 1,
  });
  assert.equal(orden.status, 201, JSON.stringify(orden.json));
  const id = orden.json.id as string;
  assert.equal((await comoUser("GET", `${ORDENES}/${id}`)).status, 404);
  assert.equal((await comoUser("PATCH", `${ORDENES}/${id}`, { notes: "x" })).status, 404);
  assert.equal((await mover(id, { desde: "RECIBIDO", hacia: "EN_TRABAJO" })).status, 404);
  const conVehiculoAjeno = await comoUser("POST", ORDENES, {
    customerVehicleId: ajeno.json.id,
    estado: "RECIBIDO",
    mileageIn: 1,
  });
  assert.equal(conVehiculoAjeno.status, 404);
});

test("un vehículo que ya no es del cliente no recibe órdenes", async () => {
  const v = await vehiculo();
  await comoUser("POST", `/api/servicios/vehiculos/${v.id}/dueno`, { fin: "OTRO" });
  const r = await comoUser("POST", ORDENES, {
    customerVehicleId: v.id,
    estado: "RECIBIDO",
    mileageIn: 1,
  });
  assert.equal(r.status, 409);
});

test("configuración y tipos: un USER lee, solo un ADMIN escribe", async () => {
  assert.equal((await comoUser("GET", "/api/servicios/tipos")).status, 200);
  assert.equal(
    (await comoUser("PUT", "/api/servicios/configuracion", { defaultNextServiceMonths: 6 })).status,
    403,
  );
  assert.equal((await comoUser("POST", "/api/servicios/tipos", { name: "x" })).status, 403);
  const r = await comoAdmin("PUT", "/api/servicios/configuracion", {
    defaultNextServiceMonths: 9,
    firstServiceAfterMonths: null,
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { defaultNextServiceMonths: 9, firstServiceAfterMonths: null });
  assert.equal(
    (await comoAdmin("PUT", "/api/servicios/configuracion", { defaultNextServiceMonths: 61 }))
      .status,
    400,
  );
  // Un tipo borrado desaparece del catálogo pero las órdenes viejas lo muestran.
  const t = await comoAdmin("POST", "/api/servicios/tipos", { name: "Para borrar" });
  const o = await recibida((await vehiculo()).id, { jobTypeIds: [t.json.id] });
  assert.equal((await comoAdmin("DELETE", `/api/servicios/tipos/${t.json.id}`)).status, 204);
  const tipos = (await comoUser("GET", "/api/servicios/tipos")).json as unknown as { id: string }[];
  assert.ok(!tipos.some((x) => x.id === t.json.id));
  const ficha = await comoUser("GET", `${ORDENES}/${o.id}`);
  assert.ok((ficha.json.tipos as { id: string }[]).some((x) => x.id === t.json.id));
});

test("encargados: id y nombre de los usuarios activos, para cualquier rol", async () => {
  const r = await comoUser("GET", "/api/servicios/usuarios");
  assert.equal(r.status, 200);
  const usuarios = r.json as unknown as Record<string, unknown>[];
  assert.equal(usuarios.length, 2);
  for (const u of usuarios) assert.deepEqual(Object.keys(u).sort(), ["fullName", "id"]);
});
