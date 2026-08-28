-- ALTO-6 (docs/auditoria-2026-08-21.md, sección 4): ningún índice servía al
-- patrón de listado real de las 6 entidades de negocio.
--
-- Toda query de listado tiene exactamente esta forma:
--
--   WHERE organization_id = $1 AND deleted_at IS NULL
--   ORDER BY created_at DESC
--   LIMIT 20 OFFSET $2
--
-- y hasta acá ninguna de las 6 tablas tenía un índice que la sirviera:
-- ninguna incluía deleted_at pese a que TODAS las lecturas filtran por él, y
-- ninguna empezaba por (organization_id, created_at). El plan real era index
-- scan sobre (organization_id), heap fetch de todo el tenant, filtrado de
-- deleted_at y sort completo — para devolver 20 filas. Y se paga dos veces por
-- request, porque findMany y count corren en paralelo con el mismo `where`.
--
-- Con 200k contactos en un tenant eso es un sort de 200k filas por página. Es
-- invisible hoy y deja de serlo con la capa de ingesta cargando en volumen:
-- 200k por tenant es el escenario esperado, no el extremo.
--
-- ---------------------------------------------------------------------------
-- NO PARCIAL, y el motivo no es el tamaño
-- ---------------------------------------------------------------------------
--
-- La alternativa era un índice parcial
-- (organization_id, created_at) WHERE deleted_at IS NULL: más chico, porque no
-- indexa las filas borradas, y estrictamente mejor para este plan. Se descartó
-- igual.
--
-- El DSL de Prisma no expresa predicados parciales. Un índice parcial viviría
-- solo acá, invisible para schema.prisma — exactamente el estado que C-2
-- (20260821140000) vino a eliminar, y que ya obliga a que los 8 únicos
-- parciales del esquema se afirmen uno por uno en el diagnóstico para no
-- perderse. Sumar 6 objetos más a ese conjunto para ahorrar las filas borradas
-- de tablas que hoy casi no tienen borrados es cambiar una garantía por una
-- optimización.
--
-- Éste se declara con @@index en schema.prisma, viaja por esta migración
-- normal, y la fila 11 del diagnóstico lo afirma comparando las tres primeras
-- columnas clave contra pg_catalog.
--
-- ORDEN DE LAS COLUMNAS: (organization_id, deleted_at, created_at), no
-- (organization_id, created_at, deleted_at). Las dos primeras columnas son
-- igualdades (`= $1` y `IS NULL`), así que el índice las usa para acotar el
-- rango; created_at va al final porque es por lo que se ordena, y un btree
-- entrega ese tramo YA ordenado. Con created_at en el medio, deleted_at no
-- podría acotar nada y el sort volvería.
--
-- SIN sort: Desc en el DSL: un btree se recorre hacia atrás al mismo costo, y
-- declarar la dirección solo importaría para un ORDER BY de direcciones
-- mixtas, que ningún buildOrderBy genera. Mismo criterio ya aplicado en
-- api_keys (20260824120000).

-- CreateIndex
CREATE INDEX "companies_organization_id_deleted_at_created_at_idx" ON "companies"("organization_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "contacts_organization_id_deleted_at_created_at_idx" ON "contacts"("organization_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "pipelines_organization_id_deleted_at_created_at_idx" ON "pipelines"("organization_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "stages_organization_id_deleted_at_created_at_idx" ON "stages"("organization_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "opportunities_organization_id_deleted_at_created_at_idx" ON "opportunities"("organization_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "activities_organization_id_deleted_at_created_at_idx" ON "activities"("organization_id", "deleted_at", "created_at");
