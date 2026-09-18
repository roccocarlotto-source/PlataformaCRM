// ---------------------------------------------------------------------------
// Los guardrails viajan como OBJETO JSON al backend, pero se editan como
// TEXTO. Este archivo es la frontera entre las dos formas, y vive aparte del
// formulario por la misma razón que fieldMapping.ts en features/source: es
// lógica pura, con casos borde que conviene probar sin montar una pantalla.
//
// POR QUÉ UN TEXTAREA DE JSON CRUDO y no un mini-formulario con un campo por
// cada clave de docs/ai-agent-architecture.md §6 (temas prohibidos, acciones
// prohibidas, info no modificable, condiciones de derivación, promesas
// prohibidas, datos requeridos antes de una acción): esa forma está
// DOCUMENTADA, no impuesta —ni por Postgres ni por Zod, que valida
// `z.record` y nada más, mismo criterio que Contact.customFields—. Un
// formulario con seis campos fijos le pondría a la pantalla una forma que el
// backend no garantiza, y dejaría sin manera de escribir una clave que el
// diseño todavía no previó. Es una decisión explícita de Rocco para este
// ítem, no un atajo: cuando la forma se estabilice, el mini-formulario se
// construye encima de este mismo campo.
//
// LA VALIDACIÓN DEL CLIENTE ES LA MISMA QUE LA DEL BACKEND, no una más
// estricta: guardrailsSchema es `z.record(z.string(), z.unknown())`, que
// acepta cualquier objeto plano y rechaza array, null y primitivos (para Zod
// no son parsedType "object"). El CONTENIDO no se valida en ningún lado.
// ---------------------------------------------------------------------------

export type ParseGuardrailsResult =
  { ok: true; guardrails: Record<string, unknown> } | { ok: false; error: string };

// Lo que muestra el textarea en creación. El backend exige el campo (NOT NULL
// sin default en el schema: un agente sin guardrails declarados no debería
// poder existir, aunque su valor sea {}), así que el default no puede ser
// vacío — tiene que ser un objeto válido.
export const EMPTY_GUARDRAILS_TEXT = "{}";

// Con indentación, no en una línea: es texto que una persona va a leer y
// editar, y un objeto de §6 en una sola línea es ilegible.
export function formatGuardrails(guardrails: Record<string, unknown>): string {
  return JSON.stringify(guardrails, null, 2);
}

export function parseGuardrails(text: string): ParseGuardrailsResult {
  // Un textarea vacío se toma como {} en vez de como un error. La intención es
  // evidente ("este agente no tiene guardrails declarados") y es exactamente
  // lo que el default de creación ya dice; hacerla fallar sería pedir que
  // escriba dos caracteres para decir lo mismo.
  if (text.trim() === "") {
    return { ok: true, guardrails: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    // El mensaje del motor se muestra tal cual porque dice DÓNDE está el
    // problema ("Unexpected token } in JSON at position 42"), que es lo único
    // accionable cuando un JSON a mano no cierra.
    return {
      ok: false,
      error: `Los guardrails tienen que ser un JSON válido${err instanceof Error ? `: ${err.message}` : "."}`,
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      error:
        'Los guardrails tienen que ser un objeto JSON, no una lista ni un valor suelto. Para no declarar ninguno, dejá "{}".',
    };
  }

  return { ok: true, guardrails: parsed as Record<string, unknown> };
}
