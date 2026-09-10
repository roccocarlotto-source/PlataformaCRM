-- ---------------------------------------------------------------------------
-- "Ganada" y "Perdida" dejan de ser exclusivas por pipeline
-- (docs/frontend-cambios-pendientes.md §13, Parte A).
--
-- Hasta acá, dos índices únicos PARCIALES (nacidos en manual_constraints.sql y
-- versionados en 20260821140000_incorporate_manual_ddl_into_migrations, C-2)
-- garantizaban a lo sumo una etapa con is_won = true y a lo sumo una con
-- is_lost = true por pipeline. Decisión de Rocco: "Ganada" no significa "la
-- única etapa terminal de éxito del embudo" sino "esta etapa ya fue
-- superada en el proceso", así que es natural que varias etapas del mismo
-- pipeline la tengan marcada a la vez; por el mismo criterio, "Perdida"
-- tampoco es exclusiva. Stage.is_won/is_lost no tienen ninguna conexión
-- funcional con opportunities.status (campo propio e independiente:
-- OPEN/WON/LOST), así que sacar la exclusividad no afecta ninguna otra
-- lógica.
--
-- LO QUE NO SE TOCA: el CHECK stages_won_lost_exclusive_check, que impide
-- que UNA MISMA fila sea ganada y perdida a la vez. Es una restricción sobre
-- la fila individual, no sobre cuántas filas del pipeline llevan el flag, y
-- sigue teniendo sentido.
--
-- Los dos índices también salen de prisma/sql/manual_constraints.sql en el
-- mismo cambio: ese archivo se reaplica en cada deploy (npm run
-- migrate:deploy) y, si siguieran ahí, los volvería a crear y desharía esta
-- migración. IF EXISTS: la migración es segura en una base donde la red de
-- seguridad nunca llegó a crearlos.
-- ---------------------------------------------------------------------------

-- DropIndex
drop index if exists public.stages_pipeline_won_unique;

-- DropIndex
drop index if exists public.stages_pipeline_lost_unique;
