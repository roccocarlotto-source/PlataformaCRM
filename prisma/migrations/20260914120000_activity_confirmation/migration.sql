-- ---------------------------------------------------------------------------
-- Confirmación del ADMIN sobre las tareas que el asignado marca como hechas
-- (docs/frontend-cambios-pendientes.md §29).
--
-- Dos columnas nuevas en activities, las dos nullable y sin default:
--
--   1. confirmed_at    — cuándo un ADMIN confirmó la tarea completada.
--   2. confirmed_by_id — qué usuario la confirmó. FK compuesta por
--      organización contra users(organization_id, id), exactamente igual que
--      assignee_id (20260821140200, C-3): ON DELETE NO ACTION porque es un
--      rastro de auditoría que no tiene que perderse si se borra el usuario,
--      y ON UPDATE CASCADE / MATCH SIMPLE por la regla uniforme que
--      verify:schema (fila 14) exige a toda FK entre tablas con
--      organization_id.
--
-- Tres estados derivados de dos columnas: pendiente (completed_at null) →
-- pendiente de confirmar (completed_at set, confirmed_at null) → confirmada
-- (las dos set). La invariante "confirmada implica completada" la sostiene
-- activity.service.ts en toda escritura, no un CHECK: un CHECK manual entra
-- al diagnóstico y a los contadores de verify:schema (misma decisión que
-- warranty_other en 20260911120000), y la única puerta de escritura es el
-- service.
--
-- Sin índice sobre confirmed_by_id: ningún listado filtra por quién confirmó.
-- Los filtros reales ("Mis tareas": assignee_id + confirmed_at IS NULL; la
-- cola del ADMIN: completed_at IS NOT NULL AND confirmed_at IS NULL) los sirve
-- el índice existente (assignee_id, completed_at) y el de listado
-- (organization_id, deleted_at, created_at).
--
-- Sin backfill: las tareas completadas antes de este cambio quedan como
-- "pendiente de confirmar" (completed_at set, confirmed_at null). Es
-- deliberado — son exactamente las que un ADMIN todavía no revisó — y
-- reversible fila por fila desde la pantalla "Actividades" (Confirmar).
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). Quien valida que aplica sobre una base vacía es el job
-- `integration` del CI, que reconstruye la base desde cero en cada corrida.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "activities"
  ADD COLUMN IF NOT EXISTS "confirmed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "confirmed_by_id" UUID;

-- AddForeignKey
ALTER TABLE "activities"
  ADD CONSTRAINT "activities_organization_id_confirmed_by_id_fkey"
  FOREIGN KEY ("organization_id", "confirmed_by_id")
  REFERENCES "users"("organization_id", "id")
  MATCH SIMPLE
  ON DELETE NO ACTION
  ON UPDATE CASCADE;
