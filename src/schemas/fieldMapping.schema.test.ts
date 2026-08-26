import assert from "node:assert/strict";
import { test } from "node:test";
import { CAMPOS_DE_CONTACTO } from "./ingestContact.schema";
import { MAX_COLUMNAS_MAPEADAS, fieldMappingSchema } from "./fieldMapping.schema";

test("acepta un mapa de encabezado de archivo a campo de Contact", () => {
  const mapa = fieldMappingSchema.parse({
    Nombre: "firstName",
    Apellido: "lastName",
    "Correo electrónico": "email",
  });

  assert.deepEqual(mapa, {
    Nombre: "firstName",
    Apellido: "lastName",
    "Correo electrónico": "email",
  });
});

test("los destinos son EXACTAMENTE los campos que reconoce ingestContactSchema", () => {
  for (const campo of CAMPOS_DE_CONTACTO) {
    assert.equal(
      fieldMappingSchema.safeParse({ Col: campo }).success,
      true,
      `${campo} tiene que ser un destino válido`,
    );
  }
});

test("un destino que no es un campo reconocido se rechaza", () => {
  // El caso peligroso: `id` y `organizationId` son columnas REALES de contacts.
  // Si el mapeo no restringiera destinos, una planilla podría escribirlas.
  for (const destino of [
    "id",
    "organizationId",
    "lifecycleStage",
    "ownerId",
    "deletedAt",
    "noExiste",
  ]) {
    assert.equal(
      fieldMappingSchema.safeParse({ Col: destino }).success,
      false,
      `${destino} no puede ser un destino: cambia el contrato de Contact por la puerta de atrás`,
    );
  }
});

test("dos columnas al mismo destino se rechazan: cuál gana dependería del orden de las claves", () => {
  const r = fieldMappingSchema.safeParse({
    Mail: "email",
    "E-mail": "email",
  });

  assert.equal(r.success, false);
  assert.match(
    r.error?.issues.map((i) => i.message).join(" ") ?? "",
    /email/,
    "el mensaje tiene que decir qué destino está repetido",
  );
});

test("un objeto vacío se rechaza: para no mapear nada se omite o se manda null", () => {
  assert.equal(fieldMappingSchema.safeParse({}).success, false);
});

test("un encabezado de origen vacío se rechaza", () => {
  assert.equal(fieldMappingSchema.safeParse({ "": "firstName" }).success, false);
  assert.equal(fieldMappingSchema.safeParse({ "   ": "firstName" }).success, false);
});

test(`no se aceptan más de ${MAX_COLUMNAS_MAPEADAS} columnas`, () => {
  // Todos los destinos serían el mismo, así que este caso además se solapa con
  // el de destinos repetidos: se comprueba solo que NO pase, que es lo que
  // importa para el tope.
  const enorme: Record<string, string> = {};
  for (let i = 0; i < MAX_COLUMNAS_MAPEADAS + 1; i++) {
    enorme[`col${i}`] = "firstName";
  }

  assert.equal(fieldMappingSchema.safeParse(enorme).success, false);
});

test("un valor que no es string se rechaza (control de tipos, no solo de nombres)", () => {
  assert.equal(fieldMappingSchema.safeParse({ Col: 42 }).success, false);
  assert.equal(fieldMappingSchema.safeParse({ Col: null }).success, false);
  assert.equal(fieldMappingSchema.safeParse({ Col: { destino: "firstName" } }).success, false);
});
