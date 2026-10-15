// ---------------------------------------------------------------------------
// Las columnas aditivas que solo usa el módulo Servicios no salen en las
// respuestas de una organización que no lo tiene activado (docs/servicios.md
// §0.3 y §13.1: sin el módulo, ninguna respuesta cambia). Es el mismo patrón
// que src/clinicas/camposDeClinica.ts, por módulo en vez de por rubro; lo
// fija src/clinicas/automotoraSinCambios.integration-test.ts.
//
// Un solo lugar para la lista de columnas por modelo: cada PR del plan que
// suma una columna del taller a un modelo compartido la agrega acá.
// ---------------------------------------------------------------------------

export const CAMPOS_DE_SERVICIOS = {
  // S6 (§6.3 y §8): el aviso del próximo service y la orden que originaron la tarea.
  activity: ["sourceNoticeId", "sourceServiceOrderId"],
} as const;

export function sinCamposDeServicios<T extends object>(
  fila: T,
  modulosActivados: readonly string[] | undefined,
  campos: readonly string[],
): T {
  if (modulosActivados?.includes("servicios")) return fila;
  const copia = { ...fila } as Record<string, unknown>;
  for (const campo of campos) delete copia[campo];
  return copia as T;
}
