import { z } from "zod";

// ---------------------------------------------------------------------------
// LOS MENSAJES DE VALIDACIÓN, IGUALES A LOS DE ZOD 3.
//
// El mensaje de un 400 de validación llega tal cual a la pantalla, y los
// workers lo guardan en eventos que también se muestran. Zod 4 cambió los
// códigos de los errores (invalid_enum_value → invalid_value, invalid_string →
// invalid_format, ...) y todos sus textos por defecto ("Required" → "Invalid
// input: expected string, received undefined"). Para que la migración no
// cambie lo que ve nadie, todo pasa por un solo traductor, `comoIssueDeZod3`,
// que describe cada error de zod 4 con la forma que tenía en zod 3. Encima de
// esa forma se arman:
//
//   - mapaDeErroresEnEspanol: el de parseOrThrow (FABLE-I-06), sin cambios de
//     texto respecto de zod 3.
//   - mensajeEnInglesDeZod3: los textos por defecto de zod 3 (copiados de
//     zod/v3/locales/en.js), instalados como mapa global con z.config. Los usa
//     lo que valida con safeParse directo, sin el mapa en español.
//   - mensajesDeTipo: lo que hacían required_error/invalid_type_error.
//
// La tabla de src/utils/zodCaracterizacion.test.ts fija todos estos textos con
// los valores que daba zod 3.25.76.
// ---------------------------------------------------------------------------

type ValidacionDeTexto =
  string | { startsWith: string } | { endsWith: string } | { includes: string; position?: number };

type IssueDeZod3 =
  | { code: "invalid_type"; expected: string; received: string }
  | { code: "invalid_literal"; expected: unknown }
  | { code: "invalid_enum_value"; options: readonly unknown[]; received: unknown }
  | { code: "unrecognized_keys"; keys: readonly string[] }
  | { code: "invalid_union" }
  | { code: "invalid_date" }
  | { code: "invalid_string"; validation: ValidacionDeTexto }
  | {
      code: "too_small" | "too_big";
      type: string;
      limite: number | bigint;
      inclusive: boolean;
      exact: boolean;
    }
  | { code: "not_multiple_of"; multipleOf: number | bigint }
  | { code: "custom" }
  | { code: "otro" };

// util.getParsedType de zod 3: el "received" de sus mensajes.
function tipoRecibido(dato: unknown): string {
  switch (typeof dato) {
    case "number":
      return Number.isNaN(dato) ? "nan" : "number";
    case "object":
      if (Array.isArray(dato)) return "array";
      if (dato === null) return "null";
      if (
        typeof (dato as { then?: unknown }).then === "function" &&
        typeof (dato as { catch?: unknown }).catch === "function"
      ) {
        return "promise";
      }
      if (dato instanceof Map) return "map";
      if (dato instanceof Set) return "set";
      if (dato instanceof Date) return "date";
      return "object";
    default:
      return typeof dato;
  }
}

// util.joinValues de zod 3.
function unirValores(valores: readonly unknown[], separador = " | "): string {
  return valores.map((v) => (typeof v === "string" ? `'${v}'` : String(v))).join(separador);
}

// z.nativeEnum de zod 3 aceptaba texto o número como TIPO y recién después
// miraba si el valor estaba en el enum; z.enum aceptaba solo texto. Zod 4 los
// unificó y ya no se pueden distinguir mirando el schema, así que los nativos
// se registran acá. Por eso los schemas usan enumNativo() y no z.nativeEnum().
const ENUMS_NATIVOS = new WeakSet<object>();

export function enumNativo<const T extends Readonly<Record<string, string | number>>>(
  valores: T,
  params?: Parameters<typeof z.nativeEnum>[1],
) {
  const schema = z.nativeEnum(valores, params);
  ENUMS_NATIVOS.add(schema);
  return schema;
}

const FORMATO_A_VALIDACION: Record<string, string> = {
  guid: "uuid",
  ipv4: "ip",
  ipv6: "ip",
};

export function comoIssueDeZod3(issue: z.core.$ZodRawIssue): IssueDeZod3 {
  switch (issue.code) {
    case "invalid_type": {
      // z.date()/z.coerce.date() con una fecha inválida: en zod 3 era otro código.
      if (issue.expected === "date" && issue.input instanceof Date) {
        return { code: "invalid_date" };
      }
      const recibido = tipoRecibido(issue.input);
      if (issue.expected === "int") {
        return {
          code: "invalid_type",
          expected: "integer",
          received: recibido === "number" ? "float" : recibido,
        };
      }
      const esperado =
        issue.expected === "record"
          ? "object"
          : issue.expected === "tuple"
            ? "array"
            : issue.expected;
      return { code: "invalid_type", expected: esperado, received: recibido };
    }
    case "invalid_value": {
      const tipoDelSchema = (issue.inst as z.core.$ZodType | undefined)?._zod.def.type;
      if (tipoDelSchema === "literal") {
        return { code: "invalid_literal", expected: issue.values[0] };
      }
      const tipo = typeof issue.input;
      const tipoAceptado =
        tipo === "string" ||
        (tipo === "number" && issue.inst !== undefined && ENUMS_NATIVOS.has(issue.inst));
      if (!tipoAceptado) {
        return {
          code: "invalid_type",
          expected: unirValores(issue.values),
          received: tipoRecibido(issue.input),
        };
      }
      return { code: "invalid_enum_value", options: issue.values, received: issue.input };
    }
    case "invalid_format": {
      switch (issue.format) {
        case "starts_with":
          return { code: "invalid_string", validation: { startsWith: String(issue.prefix) } };
        case "ends_with":
          return { code: "invalid_string", validation: { endsWith: String(issue.suffix) } };
        case "includes":
          return { code: "invalid_string", validation: { includes: String(issue.includes) } };
        default:
          return {
            code: "invalid_string",
            validation: FORMATO_A_VALIDACION[issue.format] ?? issue.format,
          };
      }
    }
    case "too_small":
    case "too_big":
      return {
        code: issue.code,
        type: issue.origin === "int" ? "number" : issue.origin,
        limite: issue.code === "too_small" ? issue.minimum : issue.maximum,
        inclusive: issue.inclusive ?? false,
        exact: issue.exact ?? false,
      };
    case "not_multiple_of":
      return { code: "not_multiple_of", multipleOf: issue.divisor };
    case "unrecognized_keys":
      return { code: "unrecognized_keys", keys: issue.keys };
    case "invalid_union":
      return { code: "invalid_union" };
    case "custom":
      return { code: "custom" };
    default:
      return { code: "otro" };
  }
}

// Una clave de z.record que no valida: zod 3 reportaba los errores de la clave
// tal cual, con la ruta hasta la clave; zod 4 los envuelve en un invalid_key ya
// resueltos con la ruta relativa a la clave. Se devuelven unidos como los une
// quien lee los issues. `conRuta` (solo el mapa en español nombra el campo)
// rehace con la ruta completa los mensajes que salieron de ese mismo mapa; los
// que escribió el schema quedan como están.
function mensajeDeClaveInvalida(
  issue: z.core.$ZodRawIssue,
  conRuta?: (interno: z.core.$ZodRawIssue) => string | undefined,
): string | undefined {
  if (issue.code !== "invalid_key" && issue.code !== "invalid_element") return undefined;
  return issue.issues
    .map((interno) => {
      if (!conRuta) return interno.message;
      const crudo = { ...interno, input: undefined } as z.core.$ZodRawIssue;
      if (conRuta(crudo) !== interno.message) return interno.message;
      return (
        conRuta({ ...crudo, path: [...(issue.path ?? []), ...interno.path] }) ?? interno.message
      );
    })
    .join(", ");
}

// ---------------------------------------------------------------------------
// Los textos por defecto de zod 3 (zod/v3/locales/en.js), en inglés.
// ---------------------------------------------------------------------------

function comoTexto(valor: number | bigint): string {
  return String(valor);
}

export const mensajeEnInglesDeZod3: z.core.$ZodErrorMap = (issueDeZod4) => {
  const deClave = mensajeDeClaveInvalida(issueDeZod4);
  if (deClave !== undefined) return deClave;
  const issue = comoIssueDeZod3(issueDeZod4);
  switch (issue.code) {
    case "invalid_type":
      return issue.received === "undefined"
        ? "Required"
        : `Expected ${issue.expected}, received ${issue.received}`;
    case "invalid_literal":
      return `Invalid literal value, expected ${JSON.stringify(issue.expected, (_, v: unknown) =>
        typeof v === "bigint" ? v.toString() : v,
      )}`;
    case "unrecognized_keys":
      return `Unrecognized key(s) in object: ${unirValores(issue.keys, ", ")}`;
    case "invalid_union":
    case "custom":
      return "Invalid input";
    case "invalid_enum_value":
      return `Invalid enum value. Expected ${unirValores(issue.options)}, received '${String(issue.received)}'`;
    case "invalid_date":
      return "Invalid date";
    case "invalid_string": {
      const v = issue.validation;
      if (typeof v === "object") {
        if ("includes" in v) {
          const base = `Invalid input: must include "${v.includes}"`;
          return typeof v.position === "number"
            ? `${base} at one or more positions greater than or equal to ${v.position}`
            : base;
        }
        if ("startsWith" in v) return `Invalid input: must start with "${v.startsWith}"`;
        return `Invalid input: must end with "${v.endsWith}"`;
      }
      return v !== "regex" ? `Invalid ${v}` : "Invalid";
    }
    case "too_small": {
      const { type, exact, inclusive } = issue;
      const n = comoTexto(issue.limite);
      if (type === "array")
        return `Array must contain ${exact ? "exactly" : inclusive ? "at least" : "more than"} ${n} element(s)`;
      if (type === "string")
        return `String must contain ${exact ? "exactly" : inclusive ? "at least" : "over"} ${n} character(s)`;
      if (type === "number" || type === "bigint")
        return `Number must be ${exact ? "exactly equal to " : inclusive ? "greater than or equal to " : "greater than "}${n}`;
      if (type === "date")
        return `Date must be ${exact ? "exactly equal to " : inclusive ? "greater than or equal to " : "greater than "}${String(new Date(Number(issue.limite)))}`;
      return "Invalid input";
    }
    case "too_big": {
      const { type, exact, inclusive } = issue;
      const n = comoTexto(issue.limite);
      if (type === "array")
        return `Array must contain ${exact ? "exactly" : inclusive ? "at most" : "less than"} ${n} element(s)`;
      if (type === "string")
        return `String must contain ${exact ? "exactly" : inclusive ? "at most" : "under"} ${n} character(s)`;
      if (type === "number")
        return `Number must be ${exact ? "exactly" : inclusive ? "less than or equal to" : "less than"} ${n}`;
      if (type === "bigint")
        return `BigInt must be ${exact ? "exactly" : inclusive ? "less than or equal to" : "less than"} ${n}`;
      if (type === "date")
        return `Date must be ${exact ? "exactly" : inclusive ? "smaller than or equal to" : "smaller than"} ${String(new Date(Number(issue.limite)))}`;
      return "Invalid input";
    }
    case "not_multiple_of":
      return `Number must be a multiple of ${comoTexto(issue.multipleOf)}`;
    default:
      return undefined;
  }
};

// Global: vale para todo safeParse/parse del proceso que no traiga su propio
// mapa. Se instala al importar este módulo (lo importan config/env.ts, que es
// lo primero que carga el servidor, y utils/validation.ts).
z.config({ customError: mensajeEnInglesDeZod3 });

// ---------------------------------------------------------------------------
// En español y diciendo qué campo (FABLE-I-06 de
// docs-privados/auditoria-2026-10-05-FABLE.md, local).
//
// El mensaje que escribe el propio schema (en un check, con mensajesDeTipo o
// con `error`) le gana a este mapa: en zod 4 esa es la precedencia de la
// librería, así que no hace falta detectarlo acá como en zod 3.
// ---------------------------------------------------------------------------

const TIPO_EN_ESPANOL: Record<string, string> = {
  string: "un texto",
  number: "un número",
  integer: "un número entero",
  boolean: "verdadero o falso",
  date: "una fecha",
  array: "una lista",
  object: "un objeto",
  bigint: "un número",
};

const FORMATO_EN_ESPANOL: Record<string, string> = {
  email: "un email válido",
  uuid: "un identificador válido",
  url: "una dirección web válida",
  datetime: "una fecha y hora válidas",
  date: "una fecha válida",
  time: "una hora válida",
};

function nombreDelCampo(ruta: readonly PropertyKey[]): string {
  return ruta.length > 0 ? `"${ruta.map(String).join(".")}"` : "El dato enviado";
}

function plural(cantidad: number | bigint, singular: string, enPlural: string): string {
  return `${String(cantidad)} ${Number(cantidad) === 1 ? singular : enPlural}`;
}

export const mapaDeErroresEnEspanol: z.core.$ZodErrorMap = (issueDeZod4) => {
  const deClave = mensajeDeClaveInvalida(issueDeZod4, (interno) => {
    const mensaje = mapaDeErroresEnEspanol(interno);
    return typeof mensaje === "string" ? mensaje : mensaje?.message;
  });
  if (deClave !== undefined) return deClave;
  const ruta = issueDeZod4.path ?? [];
  const campo = nombreDelCampo(ruta);
  const issue = comoIssueDeZod3(issueDeZod4);
  switch (issue.code) {
    case "invalid_type":
      if (issue.received === "undefined" || issue.received === "null") {
        return `Falta ${ruta.length > 0 ? campo : "el dato"}`;
      }
      return `${campo} tiene que ser ${TIPO_EN_ESPANOL[issue.expected] ?? "de otro tipo"}`;
    case "invalid_enum_value":
      return `${campo} no es un valor válido. Las opciones son: ${issue.options.map(String).join(", ")}`;
    case "invalid_literal":
      return `${campo} no es un valor válido`;
    case "unrecognized_keys":
      return `Hay campos que no se reconocen: ${issue.keys.join(", ")}`;
    case "invalid_string": {
      const esperado =
        typeof issue.validation === "string" ? FORMATO_EN_ESPANOL[issue.validation] : undefined;
      return `${campo} tiene que ser ${esperado ?? "un texto con el formato correcto"}`;
    }
    case "invalid_date":
      return `${campo} tiene que ser una fecha válida`;
    case "too_small":
      if (issue.type === "string") {
        return Number(issue.limite) <= 1
          ? `${campo} no puede estar vacío`
          : `${campo} tiene que tener al menos ${plural(issue.limite, "carácter", "caracteres")}`;
      }
      if (issue.type === "array" || issue.type === "set") {
        return `${campo} tiene que tener al menos ${plural(issue.limite, "elemento", "elementos")}`;
      }
      return `${campo} tiene que ser ${issue.inclusive ? "mayor o igual a" : "mayor que"} ${String(issue.limite)}`;
    case "too_big":
      if (issue.type === "string") {
        return `${campo} no puede tener más de ${plural(issue.limite, "carácter", "caracteres")}`;
      }
      if (issue.type === "array" || issue.type === "set") {
        return `${campo} no puede tener más de ${plural(issue.limite, "elemento", "elementos")}`;
      }
      return `${campo} tiene que ser ${issue.inclusive ? "menor o igual a" : "menor que"} ${String(issue.limite)}`;
    case "not_multiple_of":
      return `${campo} tiene que ser múltiplo de ${String(issue.multipleOf)}`;
    case "invalid_union":
    case "custom":
      // Un .refine() sin mensaje propio: zod diría "Invalid input".
      return `${campo} no es válido`;
    default:
      // Sin equivalente en español: el texto por defecto de zod 3.
      return undefined;
  }
};

// ---------------------------------------------------------------------------
// required_error / invalid_type_error de zod 3, con su regla exacta
// (processCreateParams en zod/v3/types.js): si el dato no vino, `requerido`;
// si vino con otro tipo, `tipo`; cualquier otro error del schema (un check
// sin mensaje, un valor fuera del enum) cae al mapa de siempre.
// ---------------------------------------------------------------------------

// El .strict(mensaje) de zod 3: zod 4 ya no recibe el mensaje en .strict().
// Se usa como `.apply(estricto("mensaje"))`; el mensaje vale solo para las
// claves no reconocidas, igual que antes.
export function estricto(mensaje: string) {
  return <T extends z.ZodObject>(schema: T) => {
    const sinMensaje = schema.strict();
    return sinMensaje.clone({
      ...sinMensaje._zod.def,
      error: (issue: z.core.$ZodRawIssue) =>
        issue.code === "unrecognized_keys" ? mensaje : undefined,
    }) as ReturnType<T["strict"]>;
  };
}

export function mensajesDeTipo(mensajes: { requerido?: string; tipo?: string }) {
  return {
    error: (issue: z.core.$ZodRawIssue) => {
      if (issue.input === undefined) return mensajes.requerido;
      return comoIssueDeZod3(issue).code === "invalid_type" ? mensajes.tipo : undefined;
    },
  };
}
