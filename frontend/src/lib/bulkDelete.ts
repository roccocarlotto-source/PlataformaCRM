// ---------------------------------------------------------------------------
// Borrado en lote sobre el DELETE de a uno que ya existe.
//
// No hay (ni hizo falta crear) un endpoint de borrado masivo: el backend ya
// expone un DELETE por elemento, con su permiso y su aislamiento por
// organización resueltos, así que el lote es N llamadas a esa misma ruta. Un
// endpoint nuevo tendría que volver a decidir qué pasa cuando uno solo de los
// N falla, que es justamente lo que este helper deja explícito del lado del
// cliente.
//
// Promise.allSettled y NO Promise.all: con `all`, el primer rechazo corta el
// await y deja al usuario sin saber cuáles se borraron y cuáles no (las demás
// requests ya salieron igual — `all` no cancela nada). Con `allSettled` se
// espera a las N y se devuelve la lista partida en dos, que es lo que la
// pantalla necesita para dejar marcadas solo las que fallaron y decir cuántas
// fueron.
//
// El orden de `deleted`/`failed` es el de `ids` — las pantallas lo usan para
// devolverle a la selección los ids fallidos sin barajarlos.
// ---------------------------------------------------------------------------

export interface BulkDeleteOutcome {
  deleted: string[];
  failed: string[];
}

export async function deleteInBulk(
  ids: string[],
  deleteOne: (id: string) => Promise<unknown>,
): Promise<BulkDeleteOutcome> {
  const results = await Promise.allSettled(ids.map((id) => deleteOne(id)));

  const deleted: string[] = [];
  const failed: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") deleted.push(ids[index]);
    else failed.push(ids[index]);
  });

  return { deleted, failed };
}
