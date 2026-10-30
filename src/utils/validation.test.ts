import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { mensajesDeTipo } from "./erroresDeZod";
import { AppError } from "./AppError";
import {
  fechaSoloSchema,
  instanteSchema,
  parseOrThrow,
  tieneComoMuchoDosDecimales,
} from "./validation";

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
    id: z.string().guid(),
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
    branchId: z.string().guid("branchId inválido"),
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
    guardrails: z.record(
      z.string(),
      z.unknown(),
      mensajesDeTipo({
        requerido: "guardrails es requerido",
        tipo: "guardrails debe ser un objeto JSON",
      }),
    ),
    granularity: z.enum(["month", "week", "day"], {
      error: () => "granularity debe ser month, week o day",
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

test("tieneComoMuchoDosDecimales: centavos sí, milésimos no, sin errores de punto flotante", () => {
  for (const ok of [0, 12, 12.5, 12.34, 0.1 + 0.2, -1000.01, 999_999_999_999.99]) {
    assert.equal(tieneComoMuchoDosDecimales(ok), true, String(ok));
  }
  for (const malo of [12.345, 0.001, -0.105]) {
    assert.equal(tieneComoMuchoDosDecimales(malo), false, String(malo));
  }
});

// Fechas (NEG-VAL-1, NEG-VAL-2, QA-A-06): null es "sin fecha" y nunca 1970;
// una fecha sola exige AAAA-MM-DD de un día que existe; fuera de 1900-2100 no.
test("fechaSoloSchema: AAAA-MM-DD a medianoche UTC, null pasa, lo demás no", () => {
  const schema = fechaSoloSchema("validUntil");
  assert.equal(schema.parse("2026-10-30")?.toISOString(), "2026-10-30T00:00:00.000Z");
  assert.equal(schema.parse(null), null);
  for (const malo of [
    "2026-10-30T23:00:00-03:00",
    "2026-02-30",
    "30/10/2026",
    "",
    "0202-10-30",
    "2101-01-01",
  ]) {
    assert.equal(schema.safeParse(malo).success, false, malo);
  }
  const error = schema.safeParse("2026-02-30");
  assert.match(JSON.stringify(error.error?.issues), /validUntil no es una fecha válida/);
  assert.match(JSON.stringify(schema.safeParse("1899-12-31").error?.issues), /entre 1900 y 2100/);
});

test("instanteSchema: null es sin fecha, no 1970; fuera de rango no", () => {
  const schema = instanteSchema("dueDate");
  assert.equal(schema.parse(null), null);
  assert.equal(schema.parse("2026-10-30T15:00:00.000Z")?.toISOString(), "2026-10-30T15:00:00.000Z");
  assert.equal(schema.safeParse("no es una fecha").success, false);
  assert.equal(schema.safeParse("2200-01-01T00:00:00Z").success, false);
});
