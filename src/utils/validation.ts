import { z } from "zod";
import { AppError } from "./AppError";
import { mapaDeErroresEnEspanol } from "./erroresDeZod";
import { esZonaHorariaValida } from "./timezone";

// Parsea `data` con un schema de Zod; si falla, lanza el mismo AppError(400)
// que ya usaba onboarding.controller.ts, ahora compartido para no repetir
// el bloque safeParse/issues.join en cada controller nuevo.
//
// EL TYPE PARAM DE INPUT DE ZodType (el segundo en zod 4; en zod 3 era el
// tercero) VA EN `unknown`: ni `T` ni `any`.
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
//
// Los mensajes de error (en español y diciendo qué campo, FABLE-I-06) viven
// en erroresDeZod.ts, junto con la compatibilidad con los textos de zod 3.

export function parseOrThrow<T>(schema: z.ZodType<T, unknown>, data: unknown): T {
  // Con el mapa en español: lo usa solo lo que el schema no trae con su
  // propio mensaje (ver mapaDeErroresEnEspanol).
  const parsed = schema.safeParse(data, { error: mapaDeErroresEnEspanol });

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

// ¿Como mucho centavos? 12.5 y 12.34 sí; 12.345 no. Se compara contra el
// redondeo a dos decimales con una tolerancia de punto flotante (0.1 + 0.2).
export function tieneComoMuchoDosDecimales(valor: number): boolean {
  return Math.abs(Math.round(valor * 100) - valor * 100) < 1e-6;
}

// ---------------------------------------------------------------------------
// FECHAS (NEG-VAL-1, NEG-VAL-2, QA-A-06 de docs-privados/auditoria-2026-10-21,
// local). Un solo lugar para lo que antes repetía cada controller con
// z.coerce.date():
//
//   - coerce convierte null en 1970-01-01. Por eso los dos schemas aceptan
//     null explícito (= sin fecha) en vez de coercionarlo.
//   - una fecha SOLA (columna @db.Date: "válida hasta el 30") que llega como
//     instante con zona se guarda un día antes o después. fechaSoloSchema
//     exige AAAA-MM-DD y que el día exista de verdad: new Date("2026-02-30")
//     no falla, corre al 2 de marzo.
//   - años absurdos (0202, 1970 por un null, 9999): las dos rechazan lo que
//     cae fuera de RANGO_DE_FECHAS.
// ---------------------------------------------------------------------------
export const RANGO_DE_FECHAS = {
  desde: new Date("1900-01-01T00:00:00.000Z"),
  hasta: new Date("2100-12-31T23:59:59.999Z"),
} as const;

function dentroDelRango(fecha: Date): boolean {
  return fecha >= RANGO_DE_FECHAS.desde && fecha <= RANGO_DE_FECHAS.hasta;
}

const MENSAJE_FUERA_DE_RANGO = (campo: string) => `${campo} tiene que estar entre 1900 y 2100`;

// Fecha sola: "AAAA-MM-DD" -> Date a la medianoche UTC de ese día. null pasa
// tal cual (borra la fecha).
export function fechaSoloSchema(campo: string) {
  return z
    .string({ error: () => `${campo} debe ser una fecha AAAA-MM-DD` })
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${campo} debe ser una fecha AAAA-MM-DD`)
    .transform((valor, ctx) => {
      const fecha = new Date(`${valor}T00:00:00.000Z`);
      if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== valor) {
        ctx.addIssue({ code: "custom", message: `${campo} no es una fecha válida` });
        return z.NEVER;
      }
      if (!dentroDelRango(fecha)) {
        ctx.addIssue({ code: "custom", message: MENSAJE_FUERA_DE_RANGO(campo) });
        return z.NEVER;
      }
      return fecha;
    })
    .nullable();
}

// Al CREAR, null y ausente son lo mismo: sin fecha. Esto lo deja como
// undefined, que es lo que esperan los inputs de alta de los services.
export function sinFechaComoUndefined<T>(valor: T | null | undefined): T | undefined {
  return valor ?? undefined;
}

// Instante (fecha con hora, ISO). null pasa tal cual (borra la fecha).
export function instanteSchema(campo: string) {
  return z.coerce
    .date({ error: () => `${campo} inválida` })
    .refine(dentroDelRango, MENSAJE_FUERA_DE_RANGO(campo))
    .nullable();
}
