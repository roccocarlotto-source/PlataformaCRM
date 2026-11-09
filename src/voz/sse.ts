// ---------------------------------------------------------------------------
// Las piezas del stream que espera la plataforma de voz: Server-Sent Events con
// el formato de `chat.completion.chunk` de OpenAI.
// ---------------------------------------------------------------------------

export const FIN_DEL_STREAM = "data: [DONE]\n\n";

export interface DatosDelStream {
  id: string;
  modelo: string;
  creado: number;
}

function chunk(datos: DatosDelStream, delta: object, finishReason: string | null): string {
  const cuerpo = {
    id: datos.id,
    object: "chat.completion.chunk",
    created: datos.creado,
    model: datos.modelo,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
  return `data: ${JSON.stringify(cuerpo)}\n\n`;
}

export function chunkDeInicio(datos: DatosDelStream): string {
  return chunk(datos, { role: "assistant", content: "" }, null);
}

export function chunkDeTexto(datos: DatosDelStream, texto: string): string {
  return chunk(datos, { content: texto }, null);
}

// "tool_calls" cuando el turno termina pidiendo una herramienta de la
// plataforma (transferir o colgar).
export function chunkDeCierre(
  datos: DatosDelStream,
  motivo: "stop" | "tool_calls" = "stop",
): string {
  return chunk(datos, {}, motivo);
}

// Una llamada a una herramienta de la plataforma, entera en un solo trozo:
// `arguments` es el JSON como texto, igual que en OpenAI.
export function chunkDeHerramienta(
  datos: DatosDelStream,
  herramienta: { id: string; nombre: string; argumentos: string },
): string {
  return chunk(
    datos,
    {
      tool_calls: [
        {
          index: 0,
          id: herramienta.id,
          type: "function",
          function: { name: herramienta.nombre, arguments: herramienta.argumentos },
        },
      ],
    },
    null,
  );
}
