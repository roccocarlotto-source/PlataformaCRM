-- ---------------------------------------------------------------------------
-- Sincronizar el stock con la base de conocimiento (ítem 70 de
-- docs/frontend-cambios-pendientes.md): el vínculo entre una entrada de
-- knowledge_base_entries y la unidad de vehicles que la generó, más el índice
-- que sirve a la consulta que esa sincronización hace.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). Las cuatro sentencias son exactamente lo que
-- `prisma migrate diff` deriva del schema, para que no aparezca drift.
--
-- SIN backfill: la columna nace NULL en todas las filas existentes, y NULL es
-- justamente lo que significa "entrada escrita a mano". Toda entrada anterior
-- a este ítem lo es.
--
-- SIN cambios de comportamiento por sí sola: hasta que alguien aprieta
-- "Sincronizar stock" en la pantalla de la Base de conocimiento, nada escribe
-- esta columna. La sincronización es manual y por sucursal (ver §70).
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "knowledge_base_entries" ADD COLUMN     "source_vehicle_id" UUID;

-- CreateIndex
-- Una entrada por vehículo. NULLABLE-SAFE: Postgres no compara dos NULL entre
-- sí en un UNIQUE, así que las entradas escritas a mano —todas con NULL— no
-- chocan entre ellas; la restricción aplica solo a las generadas.
--
-- NO ES PARCIAL a propósito (sin `where deleted_at is null`, y por eso no
-- entra a la fila 7 del diagnóstico): una entrada dada de baja sigue ocupando
-- el par, y la sincronización REVIVE esa misma fila cuando la unidad vuelve a
-- calificar, en vez de insertar una segunda. Así la entrada conserva su id.
CREATE UNIQUE INDEX "knowledge_base_entries_organization_id_source_vehicle_id_key" ON "knowledge_base_entries"("organization_id", "source_vehicle_id");

-- CreateIndex
-- El WHERE exacto de la sincronización: las unidades de UNA sucursal que están
-- publicadas Y disponibles. Es la primera consulta real que filtra por
-- publish_on_website, y el comentario de esa columna en schema.prisma lo
-- anticipaba textualmente ("un índice se agrega cuando hay una consulta que lo
-- use"). No parcial, mismo criterio que el resto de los índices de vehicles
-- (20260828120000): por eso no entra a la fila 17 del diagnóstico.
CREATE INDEX "vehicles_organization_id_branch_id_publish_on_website_statu_idx" ON "vehicles"("organization_id", "branch_id", "publish_on_website", "status");

-- AddForeignKey
-- FK COMPUESTA (organization_id, source_vehicle_id) -> vehicles(organization_id, id),
-- el estándar del proyecto desde C-3, apoyada en el UNIQUE (organization_id, id)
-- que vehicles ya tiene. La fila 14 del diagnóstico la deriva sola; entra
-- además a la fila 16, que es lo único que un chequeo estructural no puede
-- saber (a qué padre debe apuntar): 54 -> 55 FKs conocidas.
--
-- NO ACTION porque la columna referenciante es NULLABLE (regla de
-- 20260821140200). Un vehículo borrado no tumba la entrada: de la baja se
-- encarga la propia sincronización, con soft delete, en cuanto la unidad deja
-- de calificar.
ALTER TABLE "knowledge_base_entries" ADD CONSTRAINT "knowledge_base_entries_organization_id_source_vehicle_id_fkey" FOREIGN KEY ("organization_id", "source_vehicle_id") REFERENCES "vehicles"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
