import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { createBranch, getBranchById, updateBranch } from "./branch.service";
import { desmontar, montar, type Escenario } from "./vehicle.test-helper";

// ---------------------------------------------------------------------------
// El teléfono al que el agente de voz transfiere una llamada (PR 7), contra
// Postgres real: se guarda en formato internacional con el país por defecto
// de la organización, un número que no se puede normalizar es un 400, y el
// contrato del PATCH es el de siempre (undefined no toca, null vacía). La
// forma del campo está en branch.controller.test.ts; que solo un ADMIN puede
// escribir una sucursal, en branch.routes.test.ts.
// ---------------------------------------------------------------------------

let e: Escenario;

before(async () => {
  e = await montar("branch-transfer-phone");
  await prisma.organization.update({
    where: { id: e.organizationId },
    data: { defaultPhoneCountryCode: "598" },
  });
});

after(async () => {
  await desmontar(e);
});

async function telefonoGuardado(): Promise<string | null> {
  return (await getBranchById(e.organizationId, e.branchId)).transferPhone;
}

test("un número local se guarda con el código de país de la organización", async () => {
  await updateBranch(e.organizationId, e.branchId, { transferPhone: "099 123 456" });
  assert.equal(await telefonoGuardado(), "+59899123456");
});

test("uno internacional se guarda normalizado, null lo vacía y sin la clave no se toca", async () => {
  await updateBranch(e.organizationId, e.branchId, { transferPhone: "+54 9 11 2345-6789" });
  assert.equal(await telefonoGuardado(), "+5491123456789");
  await updateBranch(e.organizationId, e.branchId, { name: "Centro" });
  assert.equal(await telefonoGuardado(), "+5491123456789");
  await updateBranch(e.organizationId, e.branchId, { transferPhone: null });
  assert.equal(await telefonoGuardado(), null);
});

test("un número que no se puede normalizar es un 400 y no cambia nada", async () => {
  await updateBranch(e.organizationId, e.branchId, { transferPhone: "+59899123456" });
  for (const malo of ["abc", "12", "+0 99 123"]) {
    await assert.rejects(
      updateBranch(e.organizationId, e.branchId, { transferPhone: malo }),
      (err: unknown) =>
        err instanceof AppError && err.statusCode === 400 && /transferPhone/.test(err.message),
    );
  }
  assert.equal(await telefonoGuardado(), "+59899123456");
});

test("también al crear la sucursal", async () => {
  const sucursal = await createBranch(e.organizationId, {
    name: "Norte",
    timezone: "America/Montevideo",
    transferPhone: "2900 1234",
  });
  assert.equal(sucursal.transferPhone, "+59829001234");
});
