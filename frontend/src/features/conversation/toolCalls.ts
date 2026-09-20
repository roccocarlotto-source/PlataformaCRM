import type { TestMessageToolCall } from "../agent/types";

// ---------------------------------------------------------------------------
// Message.toolCalls es `Json?` en la base: lo escribe runAgentTurn con la
// forma de ToolCallDelTurno, pero eso es una convención del código y no algo
// que Postgres ni Zod impongan. Una fila vieja, una escritura directa a la
// tabla o un cambio futuro de esa forma llegan igual acá.
//
// Por eso esta función NO castea: reconoce la forma esperada o admite que no
// la reconoce. Lo mínimo que se exige para tratar una entrada como una tool
// call es un `name` que sea string — es lo único que la pantalla necesita para
// decir de qué tool habla. Todo lo demás se completa con lo que el bloque
// sabe mostrar vacío.
//
// `allowed` se lee como "bloqueada solo si dice explícitamente false": una
// entrada sin ese campo no se muestra como bloqueada, porque afirmar que las
// reglas del agente la frenaron cuando el dato no lo dice sería inventar un
// hecho.
//
// Devuelve null cuando el valor no es una lista de tool calls reconocible
// (incluida la lista vacía, que no tiene nada que mostrar). Quien llama
// decide qué hacer con eso; el detalle de la conversación muestra el JSON
// crudo, que sigue siendo más informativo que esconderlo.
// ---------------------------------------------------------------------------

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function aToolCall(valor: unknown, indice: number): TestMessageToolCall | null {
  if (!esObjeto(valor) || typeof valor.name !== "string") return null;

  const resultado =
    esObjeto(valor.result) && typeof valor.result.ok === "boolean"
      ? valor.result.ok
        ? { ok: true as const, data: valor.result.data }
        : { ok: false as const, error: String(valor.result.error ?? "") }
      : undefined;

  return {
    // El id solo se usa como key de React; si la fila no lo trae, la posición
    // alcanza — dentro de un mensaje el orden no cambia nunca.
    id: typeof valor.id === "string" ? valor.id : `tool-${indice}`,
    name: valor.name,
    arguments: esObjeto(valor.arguments) ? valor.arguments : {},
    allowed: valor.allowed !== false,
    ...(typeof valor.reason === "string" ? { reason: valor.reason } : {}),
    ...(resultado !== undefined ? { result: resultado } : {}),
  };
}

export function parseToolCalls(valor: unknown): TestMessageToolCall[] | null {
  if (!Array.isArray(valor) || valor.length === 0) return null;

  const llamadas = valor.map(aToolCall);
  // Todo o nada: con una sola entrada irreconocible se muestra el JSON crudo
  // completo. Mostrar tres de cuatro escondería en silencio justo la que no
  // se entendió, que es la que alguien querría ver.
  return llamadas.every((llamada): llamada is TestMessageToolCall => llamada !== null)
    ? llamadas
    : null;
}
