import type { z } from "zod";
import { AppError } from "./AppError";

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
export function parseOrThrow<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  const parsed = schema.safeParse(data);

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(", ");
    throw new AppError(message, 400);
  }

  return parsed.data;
}
