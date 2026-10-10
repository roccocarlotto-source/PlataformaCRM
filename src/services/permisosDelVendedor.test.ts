import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../utils/AppError";
import {
  MENSAJE_USER_NO_ASIGNA_A_OTRO,
  MENSAJE_USER_SOLO_EDITA_LO_SUYO,
  assertPuedeEditar as assertPuedeEditarCon,
  ownerAlCrear,
  type Actor,
} from "./permisosDelVendedor";

// ---------------------------------------------------------------------------
// D2 (OPUS-I-03, docs-privados, local): qué puede escribir un USER sobre
// contactos y oportunidades. El recorrido por HTTP está en
// controllers/permisosDelVendedor.integration-test.ts.
// ---------------------------------------------------------------------------

const ADMIN: Actor = { userId: "admin-1", role: "ADMIN" };
const VENDEDOR: Actor = { userId: "vendedor-1", role: "USER" };
const RECEPCION: Actor = { userId: "recepcion-1", role: "RECEPCION" };

// Los casos de ADMIN y USER son los de antes de R12, sin cambios: la regla vale
// igual para contactos y oportunidades.
for (const capacidad of ["editar_cualquier_contacto", "editar_cualquier_oportunidad"] as const) {
  test(`ADMIN y USER: lo mismo de siempre (${capacidad})`, () => {
    for (const actor of [ADMIN, VENDEDOR]) {
      const editarCon = (registro: { ownerId: string | null }, owner: string | null | undefined) =>
        assertPuedeEditarCon(actor, registro, owner, capacidad);
      if (actor === ADMIN) {
        assert.doesNotThrow(() => editarCon({ ownerId: "vendedor-2" }, "vendedor-1"));
      } else {
        assert.throws(() => editarCon({ ownerId: "vendedor-2" }, undefined));
      }
    }
  });
}

const assertPuedeEditar = (
  actor: Actor,
  registro: { ownerId: string | null },
  ownerIdPedido: string | null | undefined,
) => assertPuedeEditarCon(actor, registro, ownerIdPedido, "editar_cualquier_contacto");

function es403(mensaje: string) {
  return (err: unknown) =>
    err instanceof AppError && err.statusCode === 403 && err.message === mensaje;
}

test("al crear: lo de un USER queda a su nombre; no puede pedir otro dueño", () => {
  assert.equal(ownerAlCrear(VENDEDOR, undefined), "vendedor-1");
  assert.equal(ownerAlCrear(VENDEDOR, "vendedor-1"), "vendedor-1");
  assert.throws(() => ownerAlCrear(VENDEDOR, "vendedor-2"), es403(MENSAJE_USER_NO_ASIGNA_A_OTRO));
});

test("al crear: un ADMIN asigna a quien pida, o deja que el service decida", () => {
  assert.equal(ownerAlCrear(ADMIN, "vendedor-2"), "vendedor-2");
  assert.equal(ownerAlCrear(ADMIN, undefined), undefined);
});

test("al editar: un USER solo lo que tiene asignado", () => {
  assert.doesNotThrow(() => assertPuedeEditar(VENDEDOR, { ownerId: "vendedor-1" }, undefined));
  for (const ownerId of ["vendedor-2", "admin-1", null]) {
    assert.throws(
      () => assertPuedeEditar(VENDEDOR, { ownerId }, undefined),
      es403(MENSAJE_USER_SOLO_EDITA_LO_SUYO),
    );
  }
});

test("al editar: un USER no reasigna lo suyo ni lo deja sin dueño; dejarlo a su nombre no es reasignar", () => {
  const propio = { ownerId: "vendedor-1" };
  assert.doesNotThrow(() => assertPuedeEditar(VENDEDOR, propio, "vendedor-1"));
  assert.throws(
    () => assertPuedeEditar(VENDEDOR, propio, "vendedor-2"),
    es403(MENSAJE_USER_NO_ASIGNA_A_OTRO),
  );
  assert.throws(
    () => assertPuedeEditar(VENDEDOR, propio, null),
    es403(MENSAJE_USER_NO_ASIGNA_A_OTRO),
  );
});

test("al editar: un ADMIN no tiene ninguna de esas restricciones", () => {
  assert.doesNotThrow(() => assertPuedeEditar(ADMIN, { ownerId: "vendedor-2" }, "vendedor-1"));
  assert.doesNotThrow(() => assertPuedeEditar(ADMIN, { ownerId: null }, undefined));
});

// ---------------------------------------------------------------------------
// R12 (docs/rubros.md §11.2): Recepción edita cualquier contacto (en una
// clínica nadie es dueño de un paciente) pero no reasigna, y las oportunidades
// como un USER.
// ---------------------------------------------------------------------------

test("Recepción: edita cualquier contacto, asignado a otro o a nadie", () => {
  for (const ownerId of ["vendedor-2", "admin-1", null, "recepcion-1"]) {
    assert.doesNotThrow(() =>
      assertPuedeEditarCon(RECEPCION, { ownerId }, undefined, "editar_cualquier_contacto"),
    );
  }
});

test("Recepción: no reasigna un contacto a otra persona ni lo deja sin dueño", () => {
  assert.throws(
    () =>
      assertPuedeEditarCon(RECEPCION, { ownerId: null }, "vendedor-2", "editar_cualquier_contacto"),
    es403(MENSAJE_USER_NO_ASIGNA_A_OTRO),
  );
  assert.throws(
    () =>
      assertPuedeEditarCon(RECEPCION, { ownerId: "admin-1" }, null, "editar_cualquier_contacto"),
    es403(MENSAJE_USER_NO_ASIGNA_A_OTRO),
  );
  assert.throws(() => ownerAlCrear(RECEPCION, "vendedor-2"), es403(MENSAJE_USER_NO_ASIGNA_A_OTRO));
  assert.equal(ownerAlCrear(RECEPCION, undefined), "recepcion-1");
});

test("Recepción: una oportunidad ajena no la edita (como un USER)", () => {
  assert.throws(
    () =>
      assertPuedeEditarCon(
        RECEPCION,
        { ownerId: "vendedor-2" },
        undefined,
        "editar_cualquier_oportunidad",
      ),
    es403(MENSAJE_USER_SOLO_EDITA_LO_SUYO),
  );
});
