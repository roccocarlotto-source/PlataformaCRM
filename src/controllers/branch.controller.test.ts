import assert from "node:assert/strict";
import { test } from "node:test";
import { createBranchSchema, updateBranchSchema } from "./branch.controller";

// ---------------------------------------------------------------------------
// El borde de /api/branches: qué rechazan los schemas antes de llegar al
// service. Sin HTTP ni base, mismo criterio que payment.controller.test.ts.
//
// El archivo nace con el ítem 69 (vendedor por defecto por sucursal), que es lo
// primero que agrega un campo no trivial a este borde: un UUID opcional Y
// nullable, donde omitirlo y mandarlo en null significan cosas distintas. Los
// casos de name/timezone se cubren igual, porque el schema es uno solo y el
// campo nuevo entra por el mismo objeto compartido (branchFields).
// ---------------------------------------------------------------------------

const USER_ID = "7a6f1c1e-7c1a-4b2a-9d53-0d6b7e0a1f01";
const valido = { name: "Casa Central", timezone: "America/Montevideo" };

test("create: name y timezone alcanzan — defaultOwnerId es opcional y su ausencia no inventa la clave", () => {
  const parsed = createBranchSchema.parse(valido);
  assert.equal(parsed.name, "Casa Central");
  assert.equal(parsed.timezone, "America/Montevideo");
  // Que la clave NO aparezca es lo que hace que el service distinga "no vino"
  // de "vino en null": lo decide con `"defaultOwnerId" in input`.
  assert.equal("defaultOwnerId" in parsed, false);
});

test("create: defaultOwnerId acepta un UUID y acepta null explícito", () => {
  assert.equal(
    createBranchSchema.parse({ ...valido, defaultOwnerId: USER_ID }).defaultOwnerId,
    USER_ID,
  );
  assert.equal(createBranchSchema.parse({ ...valido, defaultOwnerId: null }).defaultOwnerId, null);
});

test("create: un defaultOwnerId que no es UUID es 400, con el nombre del campo en el mensaje", () => {
  for (const defaultOwnerId of ["", "no-soy-un-uuid", "123", 7, true, {}]) {
    const result = createBranchSchema.safeParse({ ...valido, defaultOwnerId });
    assert.equal(result.success, false, `defaultOwnerId ${JSON.stringify(defaultOwnerId)}`);
  }
  const result = createBranchSchema.safeParse({ ...valido, defaultOwnerId: "x" });
  assert.equal(result.success, false);
  assert.match(result.error.issues[0].message, /defaultOwnerId/);
});

test("create: name y timezone siguen siendo obligatorios, y una zona inventada es 400", () => {
  assert.equal(createBranchSchema.safeParse({ timezone: "America/Montevideo" }).success, false);
  assert.equal(createBranchSchema.safeParse({ name: "X" }).success, false);
  assert.equal(
    createBranchSchema.safeParse({ ...valido, timezone: "America/Nowhere" }).success,
    false,
  );
  // Un offset crudo tampoco es una zona IANA (esZonaHorariaValida).
  assert.equal(createBranchSchema.safeParse({ ...valido, timezone: "-03:00" }).success, false);
});

test("update: defaultOwnerId solo también alcanza — no hace falta reenviar name ni timezone", () => {
  const parsed = updateBranchSchema.parse({ defaultOwnerId: USER_ID });
  assert.deepEqual(parsed, { defaultOwnerId: USER_ID });
});

test("update: defaultOwnerId null es válido y es la forma de desvincularlo", () => {
  const parsed = updateBranchSchema.parse({ defaultOwnerId: null });
  assert.equal(parsed.defaultOwnerId, null);
  assert.equal("defaultOwnerId" in parsed, true, "la clave tiene que llegar al service");
});

test("update: un objeto vacío sigue siendo 400 — hay que mandar al menos un campo", () => {
  assert.equal(updateBranchSchema.safeParse({}).success, false);
});

test("update: un defaultOwnerId mal formado es 400 aunque el resto del body esté bien", () => {
  assert.equal(
    updateBranchSchema.safeParse({ name: "Casa Matriz", defaultOwnerId: "nope" }).success,
    false,
  );
});
