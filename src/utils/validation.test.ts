import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { AppError } from "./AppError";
import { parseOrThrow } from "./validation";

// ---------------------------------------------------------------------------
// FABLE-I-06 (docs-privados/auditoria-2026-10-05-FABLE.md, local): los errores
// de validación llegan a la pantalla, así que van en español y dicen qué
// campo. Antes los que no tenían mensaje propio salían con el texto por
// defecto de zod, en inglés.
// ---------------------------------------------------------------------------

function mensajeDe(schema: z.ZodTypeAny, dato: unknown): string {
  try {
    parseOrThrow(schema, dato);
  } catch (err) {
    assert.ok(err instanceof AppError);
    assert.equal(err.statusCode, 400);
    return err.message;
  }
  throw new Error("se esperaba un error de validación");
}

test("los dos casos que se vieron en producción: un valor fuera del enum y un campo desconocido", () => {
  const filtro = z.object({ channel: z.enum(["WHATSAPP", "WEB"]).optional() });
  assert.equal(
    mensajeDe(filtro, { channel: "TELEGRAM" }),
    '"channel" no es un valor válido. Las opciones son: WHATSAPP, WEB',
  );

  const estricto = z.object({ nombre: z.string() }).strict();
  assert.equal(
    mensajeDe(estricto, { nombre: "Ana", noExiste: 1, otro: 2 }),
    "Hay campos que no se reconocen: noExiste, otro",
  );
});

test("un campo que falta o de otro tipo dice cuál es y qué se esperaba", () => {
  const schema = z.object({
    title: z.string(),
    amount: z.number(),
    isActive: z.boolean(),
    tags: z.array(z.string()),
  });
  assert.equal(
    mensajeDe(schema, { amount: "mil", isActive: "sí", tags: "a" }),
    'Falta "title", "amount" tiene que ser un número, "isActive" tiene que ser verdadero o falso, "tags" tiene que ser una lista',
  );
  // El cuerpo entero ausente.
  assert.equal(mensajeDe(schema, undefined), "Falta el dato");
});

test("largos, rangos y formatos, sin una palabra en inglés", () => {
  const schema = z.object({
    nombre: z.string().min(1).max(5),
    codigo: z.string().min(3),
    edad: z.number().min(18).max(99),
    email: z.string().email(),
    id: z.string().uuid(),
    items: z.array(z.number()).min(1).max(2),
  });
  const mensaje = mensajeDe(schema, {
    nombre: "",
    codigo: "ab",
    edad: 5,
    email: "no-es-un-mail",
    id: "123",
    items: [],
  });
  assert.equal(
    mensaje,
    [
      '"nombre" no puede estar vacío',
      '"codigo" tiene que tener al menos 3 caracteres',
      '"edad" tiene que ser mayor o igual a 18',
      '"email" tiene que ser un email válido',
      '"id" tiene que ser un identificador válido',
      '"items" tiene que tener al menos 1 elemento',
    ].join(", "),
  );
  assert.equal(
    mensajeDe(schema, {
      nombre: "demasiado largo",
      codigo: "abc",
      edad: 120,
      email: "a@example.test",
      id: "11111111-1111-4111-8111-111111111111",
      items: [1, 2, 3],
    }),
    '"nombre" no puede tener más de 5 caracteres, "edad" tiene que ser menor o igual a 99, "items" no puede tener más de 2 elementos',
  );
});

test("un campo anidado se nombra con su ruta", () => {
  const schema = z.object({ contacto: z.object({ email: z.string().email() }) });
  assert.equal(
    mensajeDe(schema, { contacto: { email: "x" } }),
    '"contacto.email" tiene que ser un email válido',
  );
});

test("el mensaje que escribe el propio schema no se toca", () => {
  const schema = z.object({
    branchId: z.string().uuid("branchId inválido"),
    nombre: z.string().min(1, "El nombre es obligatorio"),
    rango: z.number().refine((n) => n % 2 === 0, { message: "Tiene que ser par" }),
  });
  assert.equal(
    mensajeDe(schema, { branchId: "x", nombre: "", rango: 3 }),
    "branchId inválido, El nombre es obligatorio, Tiene que ser par",
  );
});

test("tampoco se tocan los mensajes declarados con required_error, invalid_type_error o un errorMap del schema", () => {
  const schema = z.object({
    guardrails: z.record(z.unknown(), {
      required_error: "guardrails es requerido",
      invalid_type_error: "guardrails debe ser un objeto JSON",
    }),
    granularity: z.enum(["month", "week", "day"], {
      errorMap: () => ({ message: "granularity debe ser month, week o day" }),
    }),
  });
  assert.equal(
    mensajeDe(schema, { granularity: "year" }),
    "guardrails es requerido, granularity debe ser month, week o day",
  );
  assert.equal(
    mensajeDe(schema, { guardrails: "no", granularity: "day" }),
    "guardrails debe ser un objeto JSON",
  );
});

test("ningún texto por defecto de zod llega en inglés", () => {
  const schema = z.object({
    a: z.string(),
    b: z.enum(["X", "Y"]),
    c: z.number().int(),
    d: z.string().datetime(),
    e: z.union([z.string(), z.number()]),
    f: z.number().refine((n) => n > 0),
    g: z.literal("fijo"),
    h: z.coerce.date(),
  });
  const mensaje = mensajeDe(schema, {
    a: 1,
    b: "Z",
    c: 1.5,
    d: "ayer",
    e: true,
    f: -1,
    g: "otro",
    h: "no es una fecha",
  });
  assert.doesNotMatch(
    mensaje,
    /Invalid|Expected|Required|received|must|should|Unrecognized|Number|String/,
  );
});
