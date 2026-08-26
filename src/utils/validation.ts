import type { z } from "zod";
import { AppError } from "./AppError";

// Parsea `data` con un schema de Zod; si falla, lanza el mismo AppError(400)
// que ya usaba onboarding.controller.ts, ahora compartido para no repetir
// el bloque safeParse/issues.join en cada controller nuevo.
//
// El tercer type param de ZodType (Input) se deja en `any` a propósito: con
// z.coerce/.default() el Input real difiere del Output (ej. query params
// llegan como string, se coaccionan a number) — fijar T también en la
// posición de Input rompía la inferencia y perdía la no-opcionalidad que
// aportan los .default().
export function parseOrThrow<T>(schema: z.ZodType<T, z.ZodTypeDef, any>, data: unknown): T {
  const parsed = schema.safeParse(data);

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(", ");
    throw new AppError(message, 400);
  }

  return parsed.data;
}
