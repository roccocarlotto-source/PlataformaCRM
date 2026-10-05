import { z } from "zod";
import { AppError } from "./AppError";
import { esZonaHorariaValida } from "./timezone";

// Parsea `data` con un schema de Zod; si falla, lanza el mismo AppError(400)
// que ya usaba onboarding.controller.ts, ahora compartido para no repetir
// el bloque safeParse/issues.join en cada controller nuevo.
//
// EL TERCER TYPE PARAM DE ZodType (Input) VA EN `unknown`: ni `T` ni `any`.
//
// NO puede ser `T`: con z.coerce/.default() el Input real difiere del Output
// —los query params llegan como string y se coaccionan a number—, así que fijar
// T también en la posición de Input rompe la inferencia y hace que un
// `.default()` devuelva `X | undefined`. Verificado con un probe de tipos, no
// supuesto: con `T`, un `page: z.coerce.number().default(1)` se infiere como
// `number | undefined` y deja de cumplir lo que el `.default()` promete.
//
// TAMPOCO hacía falta `any`, que es como estaba. `unknown` conserva la
// inferencia exactamente igual —los 66 call-sites y la no-opcionalidad de los
// `.default()` siguen intactos— sin apagar la verificación de tipos. El `any`
// era una barrera más ancha que el problema que resolvía.
// ---------------------------------------------------------------------------
// LOS ERRORES DE VALIDACIÓN, EN ESPAÑOL Y DICIENDO QUÉ CAMPO (FABLE-I-06 de
// docs-privados/auditoria-2026-10-05-FABLE.md, local).
//
// El mensaje de un 400 de validación llega tal cual a la pantalla. Los schemas
// que escriben su propio mensaje ya lo tienen en español, pero todo lo demás
// salía con el texto por defecto de zod: "Invalid enum value. Expected
// 'WHATSAPP' | 'WEB', received 'MESSENGER'", "Unrecognized key(s) in object:
// 'x'", "Required". En inglés, sin decir de qué campo, y a la vista del
// usuario final.
//
// Este mapa reemplaza SOLO esos textos por defecto. Zod le da prioridad al
// mensaje escrito en el schema, así que ninguno de los que ya estaban cambia.
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

function nombreDelCampo(ruta: (string | number)[]): string {
  return ruta.length > 0 ? `"${ruta.join(".")}"` : "El dato enviado";
}

function plural(cantidad: number | bigint, singular: string, enPlural: string): string {
  return `${String(cantidad)} ${Number(cantidad) === 1 ? singular : enPlural}`;
}

export const mapaDeErroresEnEspanol: z.ZodErrorMap = (issue, ctx) => {
  // Un mapa que se pasa al parsear le gana también a los mensajes que un
  // schema declara con required_error, invalid_type_error o su propio
  // errorMap ("guardrails es requerido", "granularity debe ser month, week o
  // day"). Esos no son los de zod: si lo que llega como mensaje por defecto ya
  // no es el texto original de la librería, alguien lo escribió a propósito y
  // se respeta.
  const originalDeZod = z.defaultErrorMap(issue, { data: ctx.data, defaultError: "" }).message;
  if (ctx.defaultError !== originalDeZod) {
    return { message: ctx.defaultError };
  }
  const campo = nombreDelCampo(issue.path);
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === "undefined" || issue.received === "null") {
        return { message: `Falta ${issue.path.length > 0 ? campo : "el dato"}` };
      }
      return {
        message: `${campo} tiene que ser ${TIPO_EN_ESPANOL[issue.expected] ?? "de otro tipo"}`,
      };
    case z.ZodIssueCode.invalid_enum_value:
      return {
        message: `${campo} no es un valor válido. Las opciones son: ${issue.options.join(", ")}`,
      };
    case z.ZodIssueCode.invalid_literal:
      return { message: `${campo} no es un valor válido` };
    case z.ZodIssueCode.unrecognized_keys:
      return {
        message: `Hay campos que no se reconocen: ${issue.keys.join(", ")}`,
      };
    case z.ZodIssueCode.invalid_string: {
      const formato: Record<string, string> = {
        email: "un email válido",
        uuid: "un identificador válido",
        url: "una dirección web válida",
        datetime: "una fecha y hora válidas",
        date: "una fecha válida",
        time: "una hora válida",
      };
      const esperado = typeof issue.validation === "string" ? formato[issue.validation] : undefined;
      return {
        message: `${campo} tiene que ser ${esperado ?? "un texto con el formato correcto"}`,
      };
    }
    case z.ZodIssueCode.invalid_date:
      return { message: `${campo} tiene que ser una fecha válida` };
    case z.ZodIssueCode.too_small:
      if (issue.type === "string") {
        return {
          message:
            Number(issue.minimum) <= 1
              ? `${campo} no puede estar vacío`
              : `${campo} tiene que tener al menos ${plural(issue.minimum, "carácter", "caracteres")}`,
        };
      }
      if (issue.type === "array" || issue.type === "set") {
        return {
          message: `${campo} tiene que tener al menos ${plural(issue.minimum, "elemento", "elementos")}`,
        };
      }
      return {
        message: `${campo} tiene que ser ${issue.inclusive ? "mayor o igual a" : "mayor que"} ${String(issue.minimum)}`,
      };
    case z.ZodIssueCode.too_big:
      if (issue.type === "string") {
        return {
          message: `${campo} no puede tener más de ${plural(issue.maximum, "carácter", "caracteres")}`,
        };
      }
      if (issue.type === "array" || issue.type === "set") {
        return {
          message: `${campo} no puede tener más de ${plural(issue.maximum, "elemento", "elementos")}`,
        };
      }
      return {
        message: `${campo} tiene que ser ${issue.inclusive ? "menor o igual a" : "menor que"} ${String(issue.maximum)}`,
      };
    case z.ZodIssueCode.not_multiple_of:
      return { message: `${campo} tiene que ser múltiplo de ${String(issue.multipleOf)}` };
    case z.ZodIssueCode.not_finite:
      return { message: `${campo} tiene que ser un número` };
    case z.ZodIssueCode.invalid_union:
    case z.ZodIssueCode.invalid_union_discriminator:
      return { message: `${campo} no es válido` };
    case z.ZodIssueCode.custom:
      // Un .refine() sin mensaje propio: zod diría "Invalid input".
      return { message: `${campo} no es válido` };
    default:
      return { message: ctx.defaultError };
  }
};

export function parseOrThrow<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  // Con el mapa en español: lo usa solo lo que el schema no trae con su
  // propio mensaje (ver mapaDeErroresEnEspanol).
  const parsed = schema.safeParse(data, { errorMap: mapaDeErroresEnEspanol });

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(", ");
    throw new AppError(message, 400);
  }

  return parsed.data;
}

// Tope de Decimal(14, 2): 12 dígitos enteros. Sin esto un monto más grande
// llegaría a Postgres y volvería como 500 ("numeric field overflow") en vez
// de un 400 legible. Nació en quote.controller.ts (§39) y se mudó acá en el
// §42, cuando el detalle de financiación de Opportunity lo necesitó también.
export const MAX_AMOUNT = 999_999_999_999.99;

// Código ISO 4217 de tres letras en mayúsculas. No hay enum de moneda en el
// schema (currency es VarChar(3) libre, a propósito: ISO 4217 tiene ~180
// códigos, no es un conjunto chico de estados de negocio como sí lo son
// LifecycleStage/OpportunityStatus) — se valida el formato, no una lista
// cerrada. Compartido entre Opportunity.currency y la configuración de
// moneda de la organización (Fase 2c), para que el mismo dato se valide de
// la misma forma en los dos lugares.
export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "currency debe ser un código ISO 4217 de 3 letras");

// Zona horaria IANA, validada contra el runtime y no contra una lista propia
// (ver utils/timezone.ts): una zona mal tipeada no falla al guardarse, falla
// después, con un turno a la hora equivocada o un "hoy" corrido en el
// dashboard como único síntoma. El tope de 50 es el VarChar(50) de las dos
// columnas que la usan. Compartido entre Branch.timezone y
// Organization.timezone, mismo criterio que currencySchema.
export const timezoneSchema = z
  .string()
  .trim()
  .min(1, "timezone es requerido")
  .max(50, "timezone no puede superar los 50 caracteres")
  .refine(esZonaHorariaValida, {
    message: "timezone debe ser una zona horaria IANA válida (ej. America/Argentina/Buenos_Aires)",
  });
