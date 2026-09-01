import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  createContactSchema,
  listContactsQuerySchema,
  updateContactSchema,
} from "./contact.controller";

// M-10 (docs/auditoria-2026-08-29.md) — PATCH tiene que poder vaciar los
// campos opcionales de Contact. email/phone/jobTitle/source/companyId eran
// `...optional()` sin `.nullable()` en un objeto compartido con create, así
// que `PATCH {"phone": null}` rebotaba con 400 de Zod antes de llegar al
// service. Para `email` (M-29 del 21/08) y `companyId` el schema es solo la
// mitad del fix: la otra mitad está en updateContact y se prueba contra
// Postgres real en contact.service.integration-test.ts.
//
// Sin base y sin HTTP: lo que está bajo prueba es la frontera del schema.
// Mismo criterio que opportunity.controller.test.ts (M-9).

const CAMPOS_ANULABLES = ["email", "phone", "jobTitle", "source", "companyId"] as const;

test("M-10: PATCH acepta null en email/phone/jobTitle/source/companyId y lo conserva como null", () => {
  for (const campo of CAMPOS_ANULABLES) {
    const resultado = updateContactSchema.safeParse({ [campo]: null });
    assert.equal(resultado.success, true, `${campo}: null se rechazaba con 400`);
    assert.equal(resultado.success && resultado.data[campo], null);
  }
});

test("M-10: PATCH sigue validando el formato cuando el valor NO es null", () => {
  assert.equal(updateContactSchema.safeParse({ email: "no-es-un-email" }).success, false);
  assert.equal(updateContactSchema.safeParse({ companyId: "no-es-un-uuid" }).success, false);
  assert.equal(updateContactSchema.safeParse({ companyId: randomUUID() }).success, true);
  assert.equal(updateContactSchema.safeParse({}).success, false);
});

// Comportamiento existente, sin cambios: no se puede CREAR un contacto con
// estos campos explícitamente en null (se omiten).
test("M-10: create sigue rechazando null en email/phone/jobTitle/source/companyId", () => {
  for (const campo of CAMPOS_ANULABLES) {
    const resultado = createContactSchema.safeParse({
      firstName: "Ana",
      lastName: "Pérez",
      [campo]: null,
    });
    assert.equal(resultado.success, false, `create con ${campo}: null tiene que seguir siendo 400`);
  }
});

test("M-10: create sin esos campos sigue funcionando", () => {
  assert.equal(
    createContactSchema.safeParse({ firstName: "Ana", lastName: "Pérez" }).success,
    true,
  );
});

// ownerId, firstName, lastName y lifecycleStage quedan fuera de M-10 a
// propósito: no cambian de nulabilidad.
test("M-10: ownerId/firstName/lastName/lifecycleStage NO admiten null en update", () => {
  for (const campo of ["ownerId", "firstName", "lastName", "lifecycleStage"]) {
    assert.equal(
      updateContactSchema.safeParse({ [campo]: null }).success,
      false,
      `${campo}: null no es parte de M-10`,
    );
  }
});

// ---------------------------------------------------------------------------
// B-21 (docs/auditoria-2026-08-29.md) — `page` con tope, igual que `pageSize`.
// Sin `.max()`, ?page=999999999 se aceptaba y llegaba a Postgres como un
// OFFSET gigante que el motor igual recorre. Mismo 10.000 que ingestionEvent
// (S2-5). Sin base y sin HTTP: la frontera del schema, como M-10.
// ---------------------------------------------------------------------------

test("B-21: page por encima de 10.000 se rechaza", () => {
  const resultado = listContactsQuerySchema.safeParse({ page: "10001" });
  assert.equal(resultado.success, false);
  assert.ok(
    !resultado.success && resultado.error.issues.some((i) => i.path[0] === "page"),
    "el rechazo tiene que ser por page, no por otro campo",
  );
});

test("B-21: page = 10.000 exacto sigue siendo válido (el borde no se corrió de más)", () => {
  const resultado = listContactsQuerySchema.safeParse({ page: "10000" });
  assert.equal(resultado.success, true);
  assert.equal(resultado.success && resultado.data.page, 10_000);
});

// El criterio que ya existía para pageSize, como referencia de que page ahora
// se trata igual.
test("B-21: pageSize por encima de 100 se sigue rechazando", () => {
  assert.equal(listContactsQuerySchema.safeParse({ pageSize: "101" }).success, false);
  assert.equal(listContactsQuerySchema.safeParse({ pageSize: "100" }).success, true);
});
