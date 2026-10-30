// ---------------------------------------------------------------------------
// EL DESPERTADOR DE LAS COLAS (ancho de banda, decisión de Rocco del
// 2026-10-30).
//
// Los workers que sondean la base esperan cada vez más cuando no encuentran
// trabajo (workers/temporizadorDeSondeo.ts). Para que eso no haga más lento lo
// que el usuario está esperando, el código que ENCOLA avisa: `despertar(cola)`
// hace que el worker de esa cola mire en el acto y vuelva a su ritmo normal
// por un rato.
//
// Solo avisa al proceso donde se encoló. Si algún día corren dos servidores
// procesando colas, el otro se entera en su próxima pasada (como mucho, el
// tope de la espera). Hoy procesa uno solo.
//
// Vive en lib/ y no en workers/ porque lo llaman los repositorios: así el
// repositorio no depende del worker, solo de este registro.
// ---------------------------------------------------------------------------

export type Cola = "agente" | "ingesta" | "lotes" | "fotos" | "outbox";

const oyentes = new Map<Cola, () => void>();

// Se puede llamar dentro de una transacción todavía abierta: el worker no
// encuentra la fila hasta el COMMIT, pero queda atento un rato
// (VENTANA_DESPIERTA_MS) y la ve en su pasada siguiente.
export function despertar(cola: Cola): void {
  oyentes.get(cola)?.();
}

// Un oyente por cola (un worker por cola en el proceso). Devuelve la baja.
export function alDespertar(cola: Cola, oyente: () => void): () => void {
  oyentes.set(cola, oyente);
  return () => {
    if (oyentes.get(cola) === oyente) oyentes.delete(cola);
  };
}
