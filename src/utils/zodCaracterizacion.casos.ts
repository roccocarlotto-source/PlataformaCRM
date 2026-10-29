import { z } from "zod";
import { enumNativo, mensajesDeTipo } from "./erroresDeZod";

// Casos de la tabla de caracterización de zod (ver zodCaracterizacion.test.ts).
// Los casos se escribieron con la API de zod 3, se corrieron con zod 3.25.76
// para sacar los esperados, y después pasaron por la misma conversión que el
// resto del repo (mensajesDeTipo, enumNativo, error, .guid). Los esperados son
// el contrato: no se regraban.

enum Canal {
  WHATSAPP = "WHATSAPP",
  WEB = "WEB",
}

export interface CasoDeMensaje {
  nombre: string;
  schema: z.ZodType;
  dato: unknown;
}

const campo = <T extends z.ZodTypeAny>(schema: T) => z.object({ campo: schema });

export const CASOS_DE_MENSAJE: CasoDeMensaje[] = [
  { nombre: "texto ausente", schema: campo(z.string()), dato: {} },
  { nombre: "texto null", schema: campo(z.string()), dato: { campo: null } },
  { nombre: "texto con un número", schema: campo(z.string()), dato: { campo: 1 } },
  { nombre: "número con texto", schema: campo(z.number()), dato: { campo: "x" } },
  { nombre: "número NaN", schema: campo(z.number()), dato: { campo: Number.NaN } },
  { nombre: "entero con decimal", schema: campo(z.number().int()), dato: { campo: 1.5 } },
  { nombre: "booleano con texto", schema: campo(z.boolean()), dato: { campo: "sí" } },
  { nombre: "objeto con texto", schema: campo(z.object({})), dato: { campo: "x" } },
  { nombre: "lista con texto", schema: campo(z.array(z.string())), dato: { campo: "x" } },
  {
    nombre: "record con texto",
    schema: campo(z.record(z.string(), z.unknown())),
    dato: { campo: "x" },
  },
  { nombre: "cuerpo ausente", schema: campo(z.string()), dato: undefined },
  { nombre: "cuerpo que no es objeto", schema: campo(z.string()), dato: "x" },
  { nombre: "texto vacío con min(1)", schema: campo(z.string().min(1)), dato: { campo: "" } },
  { nombre: "texto corto con min(3)", schema: campo(z.string().min(3)), dato: { campo: "ab" } },
  { nombre: "texto largo con max(2)", schema: campo(z.string().max(2)), dato: { campo: "abc" } },
  { nombre: "texto largo con max(1)", schema: campo(z.string().max(1)), dato: { campo: "ab" } },
  { nombre: "texto con length(2)", schema: campo(z.string().length(2)), dato: { campo: "abc" } },
  { nombre: "número bajo min", schema: campo(z.number().min(5)), dato: { campo: 4 } },
  { nombre: "número alto max", schema: campo(z.number().max(5)), dato: { campo: 6 } },
  { nombre: "positive con 0", schema: campo(z.number().positive()), dato: { campo: 0 } },
  { nombre: "nonnegative con -1", schema: campo(z.number().nonnegative()), dato: { campo: -1 } },
  { nombre: "gt con igual", schema: campo(z.number().gt(3)), dato: { campo: 3 } },
  { nombre: "lt con igual", schema: campo(z.number().lt(3)), dato: { campo: 3 } },
  { nombre: "multipleOf", schema: campo(z.number().multipleOf(5)), dato: { campo: 7 } },
  { nombre: "lista corta", schema: campo(z.array(z.number()).min(2)), dato: { campo: [1] } },
  {
    nombre: "lista vacía con min(1)",
    schema: campo(z.array(z.number()).min(1)),
    dato: { campo: [] },
  },
  { nombre: "lista larga", schema: campo(z.array(z.number()).max(1)), dato: { campo: [1, 2] } },
  {
    nombre: "elemento de lista inválido",
    schema: campo(z.array(z.number())),
    dato: { campo: [1, "x"] },
  },
  { nombre: "enum fuera de rango", schema: campo(z.enum(["A", "B"])), dato: { campo: "C" } },
  { nombre: "enum con número", schema: campo(z.enum(["A", "B"])), dato: { campo: 1 } },
  { nombre: "enum ausente", schema: campo(z.enum(["A", "B"])), dato: {} },
  { nombre: "nativeEnum fuera de rango", schema: campo(enumNativo(Canal)), dato: { campo: "SMS" } },
  { nombre: "nativeEnum ausente", schema: campo(enumNativo(Canal)), dato: {} },
  { nombre: "literal distinto", schema: campo(z.literal("fijo")), dato: { campo: "otro" } },
  { nombre: "literal ausente", schema: campo(z.literal("fijo")), dato: {} },
  {
    nombre: "claves no reconocidas",
    schema: z.object({ a: z.string() }).strict(),
    dato: { a: "x", b: 1, c: 2 },
  },
  {
    nombre: "unión inválida",
    schema: campo(z.union([z.string(), z.number()])),
    dato: { campo: true },
  },
  {
    nombre: "refine sin mensaje",
    schema: campo(z.number().refine((n) => n > 0)),
    dato: { campo: -1 },
  },
  {
    nombre: "refine con mensaje",
    schema: campo(z.number().refine((n) => n > 0, { message: "Tiene que ser positivo" })),
    dato: { campo: -1 },
  },
  {
    nombre: "superRefine con addIssue custom",
    schema: campo(
      z.string().superRefine((valor, ctx) => {
        if (valor !== "ok") ctx.addIssue({ code: z.ZodIssueCode.custom, message: "No es ok" });
      }),
    ),
    dato: { campo: "no" },
  },
  {
    nombre: "superRefine con addIssue custom sin mensaje",
    schema: campo(
      z.string().superRefine((valor, ctx) => {
        if (valor !== "ok") ctx.addIssue({ code: z.ZodIssueCode.custom });
      }),
    ),
    dato: { campo: "no" },
  },
  { nombre: "email inválido", schema: campo(z.string().email()), dato: { campo: "no-es-un-mail" } },
  { nombre: "url inválida", schema: campo(z.string().url()), dato: { campo: "no es url" } },
  { nombre: "datetime inválido", schema: campo(z.string().datetime()), dato: { campo: "ayer" } },
  { nombre: "date inválido", schema: campo(z.string().date()), dato: { campo: "2026-13-45" } },
  { nombre: "regex sin mensaje", schema: campo(z.string().regex(/^\d+$/)), dato: { campo: "abc" } },
  {
    nombre: "regex con mensaje",
    schema: campo(z.string().regex(/^\d+$/, "Solo dígitos")),
    dato: { campo: "abc" },
  },
  { nombre: "startsWith", schema: campo(z.string().startsWith("+")), dato: { campo: "598" } },
  {
    nombre: "coerce.date inválido",
    schema: campo(z.coerce.date()),
    dato: { campo: "no es una fecha" },
  },
  { nombre: "coerce.number con texto", schema: campo(z.coerce.number()), dato: { campo: "abc" } },
  {
    nombre: "coerce.number entero",
    schema: campo(z.coerce.number().int()),
    dato: { campo: "1.5" },
  },
  {
    nombre: "min con mensaje propio",
    schema: campo(z.string().min(1, "Obligatorio")),
    dato: { campo: "" },
  },
  {
    nombre: "anidado",
    schema: z.object({ a: z.object({ b: z.array(z.object({ c: z.number() })) }) }),
    dato: { a: { b: [{ c: "x" }] } },
  },
  {
    nombre: "varios errores a la vez",
    schema: z.object({ a: z.string(), b: z.number().int().min(10), c: z.enum(["X"]) }),
    dato: { b: 5, c: "Y" },
  },
  {
    nombre: "int() y min() fallan a la vez",
    schema: campo(z.number().int().min(10)),
    dato: { campo: 0.5 },
  },
  { nombre: "nativeEnum con número", schema: campo(enumNativo(Canal)), dato: { campo: 1 } },
  { nombre: "nativeEnum con booleano", schema: campo(enumNativo(Canal)), dato: { campo: true } },
  { nombre: "nativeEnum null", schema: campo(enumNativo(Canal)), dato: { campo: null } },
  { nombre: "literal con número", schema: campo(z.literal("fijo")), dato: { campo: 1 } },
  { nombre: "uuid inválido", schema: campo(z.string().guid()), dato: { campo: "123" } },
  {
    nombre: "uuid con mensaje",
    schema: campo(z.string().guid("id inválido")),
    dato: { campo: "123" },
  },
  {
    nombre: "email con mensaje",
    schema: campo(z.string().email("email inválido")),
    dato: { campo: "x" },
  },
  // Lo que hacían required_error / invalid_type_error / errorMap.
  ...[
    ["ausente", {}],
    ["null", { campo: null }],
    ["de otro tipo", { campo: 1 }],
    ["corto (check sin mensaje)", { campo: "ab" }],
  ].map(([cual, dato]) => ({
    nombre: `required_error + invalid_type_error: ${String(cual)}`,
    schema: campo(
      z
        .string(mensajesDeTipo({ requerido: "campo es requerido", tipo: "campo debe ser texto" }))
        .min(3),
    ),
    dato,
  })),
  {
    nombre: "solo required_error: de otro tipo",
    schema: campo(z.string(mensajesDeTipo({ requerido: "campo es requerido" }))),
    dato: { campo: 1 },
  },
  {
    nombre: "solo invalid_type_error: ausente",
    schema: campo(z.string(mensajesDeTipo({ tipo: "campo debe ser texto" }))),
    dato: {},
  },
  {
    nombre: "invalid_type_error con int()",
    schema: campo(z.number(mensajesDeTipo({ tipo: "campo debe ser un número entero" })).int()),
    dato: { campo: 1.5 },
  },
  {
    nombre: "invalid_type_error con int() con mensaje",
    schema: campo(z.number(mensajesDeTipo({ tipo: "campo debe ser un número" })).int("entero!")),
    dato: { campo: 1.5 },
  },
  {
    nombre: "invalid_type_error en coerce.date inválida",
    schema: campo(z.coerce.date(mensajesDeTipo({ tipo: "fecha inválida" }))),
    dato: { campo: "no es fecha" },
  },
  {
    nombre: "invalid_type_error en coerce.date ausente",
    schema: campo(z.coerce.date(mensajesDeTipo({ tipo: "fecha inválida" }))),
    dato: {},
  },
  ...[
    ["ausente", {}],
    ["con número", { campo: 1 }],
    ["con booleano", { campo: true }],
    ["fuera del enum", { campo: "SMS" }],
  ].map(([cual, dato]) => ({
    nombre: `nativeEnum con required_error + invalid_type_error: ${String(cual)}`,
    schema: campo(
      enumNativo(
        Canal,
        mensajesDeTipo({ requerido: "canal es requerido", tipo: "canal inválido" }),
      ),
    ),
    dato,
  })),
  ...[
    ["ausente", {}],
    ["con número", { campo: 1 }],
    ["fuera del enum", { campo: "C" }],
  ].map(([cual, dato]) => ({
    nombre: `enum con errorMap: ${String(cual)}`,
    schema: campo(z.enum(["A", "B"], { error: () => "campo debe ser A o B" })),
    dato,
  })),
  {
    nombre: "nativeEnum con errorMap: con número",
    schema: campo(enumNativo(Canal, { error: () => "canal debe ser WHATSAPP o WEB" })),
    dato: { campo: 1 },
  },
  {
    nombre: "record con required_error: ausente",
    schema: campo(
      z.record(
        z.string(),
        z.unknown(),
        mensajesDeTipo({ requerido: "campo es requerido", tipo: "campo debe ser un objeto JSON" }),
      ),
    ),
    dato: {},
  },
  {
    nombre: "record con invalid_type_error: lista",
    schema: campo(
      z.record(
        z.string(),
        z.unknown(),
        mensajesDeTipo({ requerido: "campo es requerido", tipo: "campo debe ser un objeto JSON" }),
      ),
    ),
    dato: { campo: [] },
  },
  {
    nombre: "record con clave inválida (sin mensaje)",
    schema: campo(z.record(z.string().min(2).max(3), z.enum(["A"]))),
    dato: { campo: { abcd: "A" } },
  },
  {
    nombre: "record con clave inválida (con mensaje)",
    schema: campo(z.record(z.string().min(2, "clave corta"), z.enum(["A"]))),
    dato: { campo: { a: "A" } },
  },
  {
    nombre: "record con valor inválido",
    schema: campo(z.record(z.string(), z.enum(["A"]))),
    dato: { campo: { x: "B" } },
  },
  {
    nombre: "lista de enums con errorMap",
    schema: campo(z.array(z.enum(["A"], { error: () => "solo A" }))),
    dato: { campo: ["A", "B", 3] },
  },
];

// Qué se acepta y qué no. Un contacto o un id que hoy se guarda no puede
// empezar a fallar al editarlo o reimportarlo.
export const EMAILS_DE_PRUEBA = [
  "persona@example.com",
  "Persona.Apellido@Example.COM",
  "persona+etiqueta@example.com",
  "persona@mail.empresa.com.uy",
  "persona@empresa.uy",
  "p@e.uy",
  "nombre_apellido-2@sub-dominio.example.org",
  "o'neil@example.com",
  "1234@example.com",
  "persona@example.c",
  "persona@-example.com",
  "persona@example",
  ".persona@example.com",
  "persona.@example.com",
  "per..sona@example.com",
  "persona@@example.com",
  "persona example@example.com",
  "persona@exa_mple.com",
  "persona@123.123.123.123",
  "persona@[127.0.0.1]",
  "pérsona@example.com",
  "persona@exámple.com",
  "persona@example.com ",
  "",
];

export const IDS_DE_PRUEBA = [
  "11111111-1111-4111-8111-111111111111",
  "11111111-1111-1111-1111-111111111111",
  "00000000-0000-0000-0000-000000000000",
  "ffffffff-ffff-ffff-ffff-ffffffffffff",
  "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
  "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "11111111111141118111111111111111",
  "11111111-1111-4111-8111-11111111111",
  "g1111111-1111-4111-8111-111111111111",
  "{11111111-1111-4111-8111-111111111111}",
  "",
];
