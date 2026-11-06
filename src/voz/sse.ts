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

export function chunkDeCierre(datos: DatosDelStream): string {
  return chunk(datos, {}, "stop");
}
