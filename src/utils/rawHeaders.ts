// B-25 de docs/auditoria-2026-08-29.md — detección de headers repetidos.
//
// req.headers NO sirve para esto: Node normaliza los headers ANTES de que
// ningún middleware los vea, y para casi todos los nombres une los valores
// repetidos con ", " en un solo string. El único header que se convierte en
// array es set-cookie (y un puñado —authorization, content-type,
// content-length, etc.— se queda con el PRIMER valor); x-external-id y
// x-api-key no están en ninguna de las dos listas especiales, así que caen en
// el caso general: join con ", ", nunca array. La única evidencia de que un
// header vino repetido en el wire es req.rawHeaders — el array plano
// [nombre1, valor1, nombre2, valor2, ...] del IncomingMessage, tal cual
// llegó, antes de cualquier normalización.
//
// Verificado empíricamente contra un servidor http de Node real: dos líneas
// "X-External-Id: a" y "X-External-Id: b" en el wire producen
// req.headers["x-external-id"] === "a, b" (typeof string) y un rawHeaders con
// los dos pares intactos.

// Cuenta cuántas veces aparece un header en rawHeaders, recorriendo de a
// pares (posiciones pares = nombres). Los nombres de header no son
// case-sensitive por HTTP, y rawHeaders conserva la capitalización del wire,
// así que la comparación baja los dos lados a minúsculas.
export function countRawHeaderOccurrences(rawHeaders: string[], headerName: string): number {
  const buscado = headerName.toLowerCase();
  let ocurrencias = 0;

  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i].toLowerCase() === buscado) {
      ocurrencias += 1;
    }
  }

  return ocurrencias;
}
