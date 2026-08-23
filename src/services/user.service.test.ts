import assert from "node:assert/strict";
import { test } from "node:test";
import { staysActiveAdmin } from "./user.service";

// staysActiveAdmin decide si, DESPUÉS de aplicar el PATCH, el usuario seguiría
// contando como ADMIN activo. De eso depende que updateUser tenga que proteger
// al último ADMIN (la carrera cubierta por user.service.integration-test.ts).
// Acá se prueba solo la decisión, sin base.

const activeAdmin = { isActive: true, role: { name: "ADMIN" } };
const inactiveAdmin = { isActive: false, role: { name: "ADMIN" } };
const activeUser = { isActive: true, role: { name: "USER" } };

test("sin cambios: un ADMIN activo sigue siendo ADMIN activo", () => {
  assert.equal(staysActiveAdmin(activeAdmin, undefined, undefined), true);
});

test("sin cambios: un ADMIN desactivado no cuenta como ADMIN activo", () => {
  assert.equal(staysActiveAdmin(inactiveAdmin, undefined, undefined), false);
});

test("sin cambios: un USER activo no cuenta como ADMIN activo", () => {
  assert.equal(staysActiveAdmin(activeUser, undefined, undefined), false);
});

test("desactivar a un ADMIN activo lo saca del conteo", () => {
  assert.equal(staysActiveAdmin(activeAdmin, false, undefined), false);
});

test("degradar a un ADMIN activo lo saca del conteo", () => {
  assert.equal(staysActiveAdmin(activeAdmin, undefined, "USER"), false);
});

test("desactivar y degradar a la vez lo saca del conteo", () => {
  assert.equal(staysActiveAdmin(activeAdmin, false, "USER"), false);
});

test("reactivar a un ADMIN desactivado lo devuelve al conteo", () => {
  assert.equal(staysActiveAdmin(inactiveAdmin, true, undefined), true);
});

test("promover a un USER activo lo mete en el conteo", () => {
  assert.equal(staysActiveAdmin(activeUser, undefined, "ADMIN"), true);
});

test("promover a un usuario desactivado no alcanza: sigue fuera del conteo", () => {
  assert.equal(
    staysActiveAdmin({ isActive: false, role: { name: "USER" } }, undefined, "ADMIN"),
    false,
  );
});

// El fallback es `??`, no `||`: un `false` explícito tiene que pisar al valor
// actual en vez de tratarse como "no vino nada". Si alguien cambia `??` por
// `||`, este test es el que falla.
test("isActive:false explícito pisa al valor actual (?? y no ||)", () => {
  assert.equal(staysActiveAdmin(activeAdmin, false, "ADMIN"), false);
});
