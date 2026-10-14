import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { MODULO_NO_INCLUIDO } from "../middlewares/moduloDeLaEdicion";
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
import { MENSAJE_CONTACTO_BORRADO } from "../utils/contactoBorrado";
import { MENSAJE_DUENO_NO_EDITABLE } from "./controllers/vehiculos.controller";
import {
  VEHICULO_CON_ORDEN_ABIERTA,
  VEHICULO_DUPLICADO,
  VEHICULO_NO_VIGENTE,
} from "./services/vehiculos.service";

// ---------------------------------------------------------------------------
// S3 de docs/servicios.md: vehículos de clientes (§2.2, §2.2.1, §4.5) contra la
// app real, con usuarios reales de Supabase local y el módulo activado.
//
//   - Alta, ficha, edición y búsqueda (prefijo de matrícula o chasis, nombre).
//   - Matrícula y chasis únicos entre vigentes, escritos de cualquier forma
//     (409 con el id del existente); libres otra vez cuando el vehículo deja
//     de ser del cliente.
//   - "Cambiar dueño" en sus dos variantes, con su registro.
//   - Con una orden abierta no se cambia el dueño ni se borra.
//   - Borrar: solo ADMIN, soft. Aislamiento entre organizaciones.
// ---------------------------------------------------------------------------

let taller: OrgDePrueba; // automotora con el módulo; usuario 0 ADMIN, 1 USER
let otra: OrgDePrueba; // automotora con el módulo, para el aislamiento
let sinModulo: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);

let ana: string; // contacto
let bruno: string; // contacto
let borrado: string; // contacto con los datos personales borrados
let deOtra: string; // contacto de la otra organización
let sucursal: string;

const VEHICULOS = "/api/servicios/vehiculos";
const comoAdmin = (metodo: string, path: string, body?: unknown) =>
  pedir(taller, metodo, path, body, taller.tokens[0]);
const comoUser = (metodo: string, path: string, body?: unknown) =>
  pedir(taller, metodo, path, body, taller.tokens[1]);

async function contacto(organizationId: string, firstName: string, lastName = "Prueba") {
  const c = await prisma.contact.create({ data: { organizationId, firstName, lastName } });
  return c.id;
}

async function alta(body: Record<string, unknown>) {
  const r = await comoAdmin("POST", VEHICULOS, {
    contactId: ana,
    make: "Toyota",
    model: "Hilux",
    ...body,
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json as Record<string, unknown> & { id: string };
}

/** Una orden de servicio escrita a mano (las órdenes llegan con S4). */
async function orden(customerVehicleId: string, contactId: string, number: number) {
  return prisma.serviceOrder.create({
    data: {
      organizationId: taller.id,
      number,
      customerVehicleId,
      contactId,
      branchId: sucursal,
      createdById: taller.authIds[0],
    },
  });
}

before(async () => {
  ({ baseUrl, cerrar } = await levantarApp());
  taller = await crearOrgDePrueba("servicios-vehiculos", "COMPLETA", "AUTOMOTORA", 2);
  otra = await crearOrgDePrueba("servicios-vehiculos", "ESENCIAL", "AUTOMOTORA", 1);
  sinModulo = await crearOrgDePrueba("servicios-vehiculos", "COMPLETA", "AUTOMOTORA", 1);
  // El segundo usuario del taller es USER (antes de su primer pedido: el
  // contexto todavía no está en la caché de autenticación).
  const user = await findRoleByName("USER");
  if (!user) throw new Error("No está sembrado el rol USER");
  await prisma.user.update({ where: { id: taller.authIds[1] }, data: { roleId: user.id } });
  for (const org of [taller, otra]) await activarModulo(org.id, "servicios", org.authIds[0]);

  ana = await contacto(taller.id, "Ana", "Pereira");
  bruno = await contacto(taller.id, "Bruno", "Sosa");
  borrado = await contacto(taller.id, "Borrado");
  await prisma.contact.update({
    where: { id: borrado },
    data: { personalDataErasedAt: new Date(), personalDataErasedById: taller.authIds[0] },
  });
  deOtra = await contacto(otra.id, "Otra");
  sucursal = (
    await createBranch(taller.id, { name: "Taller Centro", timezone: "America/Montevideo" })
  ).id;
});

after(async () => {
  if (cerrar) await cerrar();
  for (const org of [taller, otra, sinModulo]) await borrarOrgDePrueba(org);
});

test("sin el módulo: 403 NO_ACTIVADO", async () => {
  const r = await pedir(sinModulo, "GET", VEHICULOS);
  assert.equal(r.status, 403);
  assert.equal(r.json.error?.code, MODULO_NO_INCLUIDO);
  assert.equal(r.json.error?.motivo, "NO_ACTIVADO");
});

test("alta y ficha: la matrícula como se escribió, el chasis normalizado, las fechas AAAA-MM-DD", async () => {
  const v = await alta({
    licensePlate: "sbc 1001",
    vin: "9bw-zzz 377",
    year: 2020,
    mileage: 45000,
    branchId: sucursal,
    purchasedOn: "2020-03-15",
    nextServiceDueOn: "2027-01-10",
    notes: "Cliente de siempre",
  });
  assert.equal(v.licensePlate, "sbc 1001");
  assert.equal(v.vin, "9BWZZZ377");
  assert.equal(v.purchasedOn, "2020-03-15");
  assert.equal(v.nextServiceDueOn, "2027-01-10");
  assert.equal(v.ordenAbierta, null);
  assert.deepEqual(v.contact, { id: ana, firstName: "Ana", lastName: "Pereira" });
  assert.deepEqual(v.branch, { id: sucursal, name: "Taller Centro" });

  const ficha = await comoAdmin("GET", `${VEHICULOS}/${v.id}`);
  assert.equal(ficha.status, 200);
  assert.deepEqual(ficha.json.cambiosDeDueno, []);
  const fila = await prisma.customerVehicle.findUniqueOrThrow({ where: { id: v.id } });
  assert.equal(fila.licensePlateNorm, "SBC1001");
});

test("matrícula y chasis únicos entre vigentes, escritos de cualquier forma: 409 con el existente", async () => {
  const v = await alta({ licensePlate: "SBC-1002", vin: "CHASIS1002" });
  const plate = await comoAdmin("POST", VEHICULOS, {
    contactId: bruno,
    make: "Fiat",
    model: "Uno",
    licensePlate: "sbc1002",
  });
  assert.equal(plate.status, 409);
  assert.equal(plate.json.error?.code, VEHICULO_DUPLICADO);
  assert.equal(plate.json.error?.campo, "licensePlate");
  assert.equal(plate.json.error?.vehiculoId, v.id);

  const vin = await comoAdmin("POST", VEHICULOS, {
    contactId: bruno,
    make: "Fiat",
    model: "Uno",
    vin: "chasis 1002",
  });
  assert.equal(vin.status, 409);
  assert.equal(vin.json.error?.campo, "vin");

  // Editar otro vehículo hacia esa matrícula, igual.
  const otro = await alta({ licensePlate: "SBC1003" });
  const patch = await comoAdmin("PATCH", `${VEHICULOS}/${otro.id}`, { licensePlate: "sbc 1002" });
  assert.equal(patch.status, 409);
  assert.equal(patch.json.error?.vehiculoId, v.id);
  // Guardarse a sí mismo con la misma matrícula escrita distinto no choca.
  const propio = await comoAdmin("PATCH", `${VEHICULOS}/${v.id}`, { licensePlate: "sbc 1002" });
  assert.equal(propio.status, 200, JSON.stringify(propio.json));

  // En otra organización, la misma matrícula está libre.
  const r = await pedir(otra, "POST", VEHICULOS, {
    contactId: deOtra,
    make: "Fiat",
    model: "Uno",
    licensePlate: "SBC1002",
  });
  assert.equal(r.status, 201);
});

test("una matrícula sin letras ni dígitos es 400", async () => {
  const r = await comoAdmin("POST", VEHICULOS, {
    contactId: ana,
    make: "A",
    model: "B",
    licensePlate: "--",
  });
  assert.equal(r.status, 400);
});

test("el dueño no se edita: PATCH con contactId es 400", async () => {
  const v = await alta({});
  const r = await comoAdmin("PATCH", `${VEHICULOS}/${v.id}`, { contactId: bruno });
  assert.equal(r.status, 400);
  assert.equal(r.json.error?.message, MENSAJE_DUENO_NO_EDITABLE);
});

test("próximo service a mano y 'No recordar'", async () => {
  const v = await alta({});
  const r = await comoAdmin("PATCH", `${VEHICULOS}/${v.id}`, {
    nextServiceDueOn: "2027-06-01",
    remindersOptOut: true,
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.nextServiceDueOn, "2027-06-01");
  assert.equal(r.json.remindersOptOut, true);
  const limpio = await comoAdmin("PATCH", `${VEHICULOS}/${v.id}`, { nextServiceDueOn: null });
  assert.equal(limpio.json.nextServiceDueOn, null);
});

test("búsqueda: prefijo de matrícula o chasis normalizado, nombre del contacto, y por contacto", async () => {
  const v = await alta({ licensePlate: "XQZ 7781", vin: "QQQ999" });
  const ids = async (query: string) => {
    const r = await comoAdmin("GET", `${VEHICULOS}?${query}`);
    assert.equal(r.status, 200);
    return (r.json.data as { id: string }[]).map((x) => x.id);
  };
  assert.ok((await ids("q=xqz-77")).includes(v.id), "prefijo, escrito distinto");
  assert.ok(!(await ids("q=7781")).includes(v.id), "no es prefijo");
  assert.ok((await ids("q=qqq9")).includes(v.id), "chasis");
  assert.ok((await ids("q=pereir")).includes(v.id), "apellido del dueño");
  const deBruno = await ids(`contactId=${bruno}`);
  assert.ok(!deBruno.includes(v.id));
});

test("aislamiento: el vehículo y el contacto de otra organización son 404", async () => {
  const ajeno = await pedir(otra, "POST", VEHICULOS, { contactId: deOtra, make: "A", model: "B" });
  assert.equal(ajeno.status, 201);
  const id = ajeno.json.id as string;
  assert.equal((await comoAdmin("GET", `${VEHICULOS}/${id}`)).status, 404);
  assert.equal((await comoAdmin("PATCH", `${VEHICULOS}/${id}`, { make: "X" })).status, 404);
  assert.equal((await comoAdmin("DELETE", `${VEHICULOS}/${id}`)).status, 404);
  assert.equal((await comoAdmin("GET", `${VEHICULOS}/${id}/ordenes`)).status, 404);
  assert.equal((await comoAdmin("POST", `${VEHICULOS}/${id}/dueno`, { fin: "OTRO" })).status, 404);
  const conContactoAjeno = await comoAdmin("POST", VEHICULOS, {
    contactId: deOtra,
    make: "A",
    model: "B",
  });
  assert.equal(conContactoAjeno.status, 404);
  const v = await alta({});
  const aAjeno = await comoAdmin("POST", `${VEHICULOS}/${v.id}/dueno`, { toContactId: deOtra });
  assert.equal(aAjeno.status, 404);
  assert.equal(
    (await prisma.customerVehicle.findUniqueOrThrow({ where: { id: ajeno.json.id as string } }))
      .make,
    "A",
  );
});

test("un contacto con los datos borrados es de solo lectura: 409", async () => {
  const r = await comoAdmin("POST", VEHICULOS, { contactId: borrado, make: "A", model: "B" });
  assert.equal(r.status, 409);
  assert.equal(r.json.error?.message, MENSAJE_CONTACTO_BORRADO);
  const v = await alta({});
  const aBorrado = await comoAdmin("POST", `${VEHICULOS}/${v.id}/dueno`, { toContactId: borrado });
  assert.equal(aBorrado.status, 409);
});

test("cambiar dueño a otro contacto: limpia la compra, conserva el próximo service y deja el registro", async () => {
  const v = await alta({
    licensePlate: "DUE0001",
    purchasedOn: "2021-05-02",
    nextServiceDueOn: "2027-02-01",
  });
  const mismo = await comoUser("POST", `${VEHICULOS}/${v.id}/dueno`, { toContactId: ana });
  assert.equal(mismo.status, 400);

  const r = await comoUser("POST", `${VEHICULOS}/${v.id}/dueno`, {
    toContactId: bruno,
    nota: "Se lo vendió al cuñado",
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((r.json.contact as { id: string }).id, bruno);
  assert.equal(r.json.purchasedOn, null);
  assert.equal(r.json.nextServiceDueOn, "2027-02-01");
  assert.equal(r.json.ownershipEndedAt, null);
  const [cambio] = r.json.cambiosDeDueno as Record<string, unknown>[];
  assert.equal(cambio.kind, "CAMBIO_DE_DUENO");
  assert.equal((cambio.fromContact as { id: string }).id, ana);
  assert.equal((cambio.toContact as { id: string }).id, bruno);
  assert.equal(cambio.previousPurchasedOn, "2021-05-02");
  assert.equal(cambio.note, "Se lo vendió al cuñado");
  assert.equal((cambio.changedBy as { id: string }).id, taller.authIds[1]);
});

test("ya no es del cliente: sale de los vigentes, libera la matrícula y no se puede volver a cambiar", async () => {
  const v = await alta({ licensePlate: "FIN0001", purchasedOn: "2019-01-01" });
  const r = await comoAdmin("POST", `${VEHICULOS}/${v.id}/dueno`, { fin: "VENDIDO_A_TERCERO" });
  assert.equal(r.status, 200);
  assert.ok(r.json.ownershipEndedAt);
  assert.equal(r.json.ownershipEndReason, "VENDIDO_A_TERCERO");
  assert.equal(r.json.purchasedOn, null);
  const [cambio] = r.json.cambiosDeDueno as Record<string, unknown>[];
  assert.equal(cambio.kind, "FIN");
  assert.equal(cambio.endReason, "VENDIDO_A_TERCERO");
  assert.equal(cambio.toContact, null);

  const vigentes = await comoAdmin("GET", `${VEHICULOS}?q=FIN0001`);
  assert.equal((vigentes.json.data as unknown[]).length, 0);
  const todos = await comoAdmin("GET", `${VEHICULOS}?q=FIN0001&incluirNoVigentes=true`);
  assert.equal((todos.json.data as unknown[]).length, 1);

  // El mismo auto vuelve a entrar como vehículo vigente de otro cliente.
  const nuevo = await comoAdmin("POST", VEHICULOS, {
    contactId: bruno,
    make: "Toyota",
    model: "Hilux",
    licensePlate: "FIN 0001",
  });
  assert.equal(nuevo.status, 201);

  const otraVez = await comoAdmin("POST", `${VEHICULOS}/${v.id}/dueno`, { fin: "OTRO" });
  assert.equal(otraVez.status, 409);
  assert.equal(otraVez.json.error?.message, VEHICULO_NO_VIGENTE);
});

test("con una orden abierta no se cambia el dueño ni se borra; el historial la muestra", async () => {
  const v = await alta({ licensePlate: "ORD0001" });
  const o = await orden(v.id, ana, 1);

  const ficha = await comoAdmin("GET", `${VEHICULOS}/${v.id}`);
  assert.deepEqual(ficha.json.ordenAbierta, { id: o.id, numero: "OS-0001", status: "AGENDADO" });

  const dueno = await comoAdmin("POST", `${VEHICULOS}/${v.id}/dueno`, { toContactId: bruno });
  assert.equal(dueno.status, 409);
  assert.equal(dueno.json.error?.message, VEHICULO_CON_ORDEN_ABIERTA);
  const borrar = await comoAdmin("DELETE", `${VEHICULOS}/${v.id}`);
  assert.equal(borrar.status, 409);

  const historial = await comoAdmin("GET", `${VEHICULOS}/${v.id}/ordenes`);
  assert.equal(historial.status, 200);
  const [fila] = historial.json as unknown as Record<string, unknown>[];
  assert.equal(fila.numero, "OS-0001");
  assert.deepEqual(fila.tipos, []);

  // Entregada, ya no frena.
  await prisma.serviceOrder.update({
    where: { id: o.id },
    data: { status: "ENTREGADO", deliveredAt: new Date() },
  });
  assert.equal((await comoAdmin("DELETE", `${VEHICULOS}/${v.id}`)).status, 204);
});

test("borrar: solo ADMIN, soft delete, y después es 404", async () => {
  const v = await alta({ licensePlate: "BOR0001" });
  const user = await comoUser("DELETE", `${VEHICULOS}/${v.id}`);
  assert.equal(user.status, 403);
  // Un USER sí crea y edita (D9).
  const editado = await comoUser("PATCH", `${VEHICULOS}/${v.id}`, { mileage: 1000 });
  assert.equal(editado.status, 200);

  assert.equal((await comoAdmin("DELETE", `${VEHICULOS}/${v.id}`)).status, 204);
  assert.equal((await comoAdmin("GET", `${VEHICULOS}/${v.id}`)).status, 404);
  const fila = await prisma.customerVehicle.findUniqueOrThrow({ where: { id: v.id } });
  assert.ok(fila.deletedAt, "soft delete");
  // La matrícula de un borrado queda libre.
  const otraVez = await alta({ licensePlate: "BOR0001" });
  assert.notEqual(otraVez.id, v.id);
});

test("un id que no existe es 404; uno mal formado, 400", async () => {
  assert.equal((await comoAdmin("GET", `${VEHICULOS}/${randomUUID()}`)).status, 404);
  assert.equal((await comoAdmin("GET", `${VEHICULOS}/no-es-uuid`)).status, 400);
});
