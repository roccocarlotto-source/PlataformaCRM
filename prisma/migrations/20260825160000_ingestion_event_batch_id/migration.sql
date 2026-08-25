-- Ítem 5 — el identificador de lote que la nota 9.2 dejó escrito como deuda
-- ABIERTA de este ítem, no del 2.
--
-- 9.2 lo planteó así: §5 exige que el resultado de una importación sea
-- consultable ("cuántos entraron, cuántos se promovieron, cuántos fallaron y
-- por qué"), pero un IngestionEvent conoce su Source, no la importación
-- concreta que lo trajo — "dos archivos subidos en días distintos contra la
-- misma Source son indistinguibles, salvo por ventana de tiempo".
--
-- UNA COLUMNA, NO UN MODELO APARTE. Las dos formas estaban sobre la mesa:
--
--   a) columna nullable acá, y los contadores se derivan con un GROUP BY;
--   b) modelo IngestionBatch con sus propios contadores.
--
-- Se eligió (a) por una razón que no es de comodidad: en (b) los contadores
-- serían un SEGUNDO lugar donde vive un número que ya es derivable, y el worker
-- tendría que incrementarlos transaccionalmente en cada promoción. Eso agrega
-- escrituras al camino caliente y, peor, crea la posibilidad de que el
-- contador y las filas digan cosas distintas. Un GROUP BY no puede desincronizarse
-- de los datos que agrupa.
--
-- Argumento secundario, pero concreto: un modelo aparte traería una FK
-- compuesta (organization_id, batch_id) más, y la fila 14 del diagnóstico
-- afirma las 18 existentes con FULL OUTER JOIN — "que falten, SOBREN o hayan
-- cambiado". Una columna suelta sin FK no toca esa afirmación; se verificó
-- leyendo la consulta, no se supuso.
--
-- NULL significa algo: "este evento no vino de un lote". Los eventos del
-- webhook (ítem 4) llegan de a uno y quedan en NULL para siempre.
--
-- Columna nullable sin default: en Postgres moderno no reescribe la tabla — el
-- mismo argumento con el que 9.2 se permitió diferirla hasta acá.
ALTER TABLE public.ingestion_events
  ADD COLUMN IF NOT EXISTS "batch_id" UUID;

-- El endpoint de resultado consulta WHERE organization_id = ? AND batch_id = ?
-- sobre la tabla de mayor volumen del esquema. Sin índice eso es un seq scan.
--
-- Índice COMÚN y declarado en el DSL de Prisma, no parcial. Un parcial
-- (WHERE batch_id IS NOT NULL) ahorraría las filas del webhook, pero Prisma no
-- expresa predicados parciales: viviría solo en la migración, invisible para el
-- schema, y pasaría a ser un objeto de esquema más que nadie afirma. La
-- visibilidad vale más que las filas ahorradas.
CREATE INDEX IF NOT EXISTS "ingestion_events_organization_id_batch_id_idx"
  ON public.ingestion_events ("organization_id", "batch_id");
