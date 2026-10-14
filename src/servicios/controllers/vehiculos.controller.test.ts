import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actualizarVehiculoSchema,
  cambiarDuenoSchema,
  crearVehiculoSchema,
  listarVehiculosQuerySchema,
} from "./vehiculos.controller";

// La frontera de validación de los vehículos de clientes, sin base ni HTTP.

const CONTACTO = "11111111-1111-4111-8111-111111111111";

test("crear: contacto, marca y modelo alcanzan; los textos vacíos llegan como null", () => {
  const r = crearVehiculoSchema.safeParse({
    contactId: CONTACTO,
    make: " Toyota ",
    model: "Hilux",
    licensePlate: "  ",
    notes: "",
  });
  assert.ok(r.success);
  assert.equal(r.data.make, "Toyota");
  assert.equal(r.data.licensePlate, null);
  assert.equal(r.data.notes, null);
});

test("crear: sin contacto, marca o modelo es 400", () => {
  assert.ok(!crearVehiculoSchema.safeParse({ make: "A", model: "B" }).success);
  assert.ok(!crearVehiculoSchema.safeParse({ contactId: CONTACTO, model: "B" }).success);
  assert.ok(!crearVehiculoSchema.safeParse({ contactId: CONTACTO, make: "A", model: " " }).success);
});

test("año: hasta el que viene, desde 1900, entero", () => {
  const base = { contactId: CONTACTO, make: "A", model: "B" };
  const siguiente = new Date().getUTCFullYear() + 1;
  assert.ok(crearVehiculoSchema.safeParse({ ...base, year: siguiente }).success);
  assert.ok(!crearVehiculoSchema.safeParse({ ...base, year: siguiente + 1 }).success);
  assert.ok(!crearVehiculoSchema.safeParse({ ...base, year: 1899 }).success);
  assert.ok(!crearVehiculoSchema.safeParse({ ...base, year: 2020.5 }).success);
});

test("km no negativo; fechas AAAA-MM-DD", () => {
  const base = { contactId: CONTACTO, make: "A", model: "B" };
  assert.ok(!crearVehiculoSchema.safeParse({ ...base, mileage: -1 }).success);
  assert.ok(crearVehiculoSchema.safeParse({ ...base, purchasedOn: "2024-02-29" }).success);
  assert.ok(!crearVehiculoSchema.safeParse({ ...base, purchasedOn: "29/02/2024" }).success);
  assert.ok(!crearVehiculoSchema.safeParse({ ...base, nextServiceDueOn: "2024-13-01" }).success);
  assert.ok(!crearVehiculoSchema.safeParse({ ...base, nextServiceDueOn: "2025-02-29" }).success);
});

test("actualizar: al menos un campo; null limpia", () => {
  assert.ok(!actualizarVehiculoSchema.safeParse({}).success);
  const r = actualizarVehiculoSchema.safeParse({ nextServiceDueOn: null, branchId: null });
  assert.ok(r.success);
  assert.equal(r.data.nextServiceDueOn, null);
});

test("cambiar dueño: a otro contacto, o fin con VENDIDO_A_TERCERO u OTRO; nunca PERMUTA ni los dos", () => {
  assert.ok(cambiarDuenoSchema.safeParse({ toContactId: CONTACTO, nota: "x" }).success);
  assert.ok(cambiarDuenoSchema.safeParse({ fin: "VENDIDO_A_TERCERO" }).success);
  assert.ok(cambiarDuenoSchema.safeParse({ fin: "OTRO", nota: null }).success);
  assert.ok(!cambiarDuenoSchema.safeParse({ fin: "PERMUTA" }).success);
  assert.ok(!cambiarDuenoSchema.safeParse({ toContactId: CONTACTO, fin: "OTRO" }).success);
  assert.ok(!cambiarDuenoSchema.safeParse({}).success);
});

test("listado: paginado por defecto e incluirNoVigentes como booleano", () => {
  const r = listarVehiculosQuerySchema.parse({ incluirNoVigentes: "true" });
  assert.equal(r.page, 1);
  assert.equal(r.pageSize, 20);
  assert.equal(r.incluirNoVigentes, true);
  assert.ok(!listarVehiculosQuerySchema.safeParse({ pageSize: "500" }).success);
});
