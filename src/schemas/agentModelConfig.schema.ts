import { z } from "zod";
import { LLM_PROVIDER_NAMES, isLlmProviderName } from "../services/llmProvider.service";

// Extraído de agent.controller.ts (ítem 179): el agente de IA interno
// (internalAgent.controller.ts) configura modelo y tools con exactamente las
// mismas reglas que un Agent de atención a cliente — se comparten los objetos,
// no se redeclaran las reglas. Lo que es propio de cada uno (channels,
// guardrails, allowedOrigins…) queda en su controller.

// Sin duplicados: un agente con ["WEB", "WEB"] no es un error de negocio pero
// sí un dato sucio que cualquier consumidor tendría que limpiar. Se dedupe
// acá, una vez, conservando el orden.
export function sinDuplicados<T>(valores: T[]): T[] {
  return Array.from(new Set(valores));
}

// Los nombres de tools del catálogo de §7 son snake_case ("create_opportunity",
// "get_availability"). Se valida la FORMA, no la pertenencia al catálogo: el
// catálogo vive en código y recién existe en 2b — validar contra él acá sería
// acoplar el CRUD a un archivo que todavía no está. Un nombre que no esté en el
// catálogo simplemente nunca se ofrece al modelo (paso 2 de §4 filtra por
// intersección), así que un typo es inofensivo pero visible. Vale igual para el
// catálogo del agente interno (toolsHabilitadasInternas).
const toolNameSchema = z
  .string()
  .trim()
  .min(1, "enabledTools no admite nombres vacíos")
  .max(100, "un nombre de tool no puede superar los 100 caracteres")
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "cada tool de enabledTools debe ser snake_case (ej. create_opportunity)",
  );

export const enabledToolsSchema = z.array(toolNameSchema).transform(sinDuplicados);

// Agent.modelProvider es VarChar libre en la base; el borde valida contra los
// adaptadores que existen (LLM_PROVIDER_NAMES). Ver la nota en
// llmProvider.service.ts.
export const modelProviderSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(isLlmProviderName, {
    message: `modelProvider debe ser uno de: ${LLM_PROVIDER_NAMES.join(", ")}`,
  });

// modelName es libre a propósito: el catálogo de modelos cambia más rápido de
// lo que conviene versionar (comentario del schema y de OPENROUTER_MODEL). Un
// modelo inexistente falla con un 404 claro de OpenRouter al usarlo, no acá.
export const modelNameSchema = z
  .string()
  .trim()
  .min(1, "modelName es requerido")
  .max(100, "modelName no puede superar los 100 caracteres");
