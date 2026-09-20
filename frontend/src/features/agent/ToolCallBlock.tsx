import { toolLabel } from "./tools";
import type { TestMessageToolCall } from "./types";

// ---------------------------------------------------------------------------
// Una tool call de un turno del agente. Bloque chico y legible, no una UI
// elaborada: esto es diagnóstico —qué pidió el modelo, si se le permitió y
// con qué resultado—, no algo que vea un cliente.
//
// Los argumentos y el dato del resultado van como JSON crudo a propósito:
// cada tool devuelve una forma distinta (ver CATALOGO_DE_TOOLS en
// agentTools.service.ts) y no hay ninguna que el frontend conozca. Un
// formateador por tool sería seis vistas para mantener, y un resumen genérico
// escondería justo lo que se vino a mirar.
//
// EN ARCHIVO PROPIO desde el ítem 66: nació dentro de AgentPlaygroundPage
// (ítem 65) y ahora lo usan dos pantallas —el probador, con las tool calls
// que devuelve el turno, y el detalle de una conversación, con las que
// quedaron guardadas en Message.toolCalls—. Es el MISMO dato: runAgentTurn
// persiste exactamente lo que devuelve. El marcado no cambió al mudarse.
// ---------------------------------------------------------------------------
export function ToolCallBlock({ llamada }: { llamada: TestMessageToolCall }) {
  return (
    <div className="ds-chat-tool">
      <p className="ds-chat-tool-head">
        <strong>{toolLabel(llamada.name)}</strong> <code>{llamada.name}</code>
      </p>
      <p className="ds-chat-tool-line">
        Argumentos: <code>{JSON.stringify(llamada.arguments)}</code>
      </p>
      {llamada.allowed ? null : (
        <p className="ds-chat-tool-line ds-chat-tool-line--blocked">
          Bloqueada por las reglas del agente
          {llamada.reason !== undefined ? `: ${llamada.reason}` : "."}
        </p>
      )}
      {llamada.result === undefined ? null : llamada.result.ok ? (
        <p className="ds-chat-tool-line">
          Resultado: <code>{JSON.stringify(llamada.result.data)}</code>
        </p>
      ) : (
        <p className="ds-chat-tool-line ds-chat-tool-line--blocked">
          Falló: {llamada.result.error}
        </p>
      )}
    </div>
  );
}
