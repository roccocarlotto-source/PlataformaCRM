-- ---------------------------------------------------------------------------
-- Seguimiento sugerido por IA para oportunidades estancadas (ítem 76 de
-- docs/frontend-cambios-pendientes.md): el trigger opportunity.stale y la
-- acción agent.draft_follow_up. Dos columnas, las dos sin backfill.
--
-- 1) opportunities.last_stale_follow_up_drafted_at — EL ANTI-REDRAFT.
--
-- "Una oportunidad lleva N días sin movimiento" no es un evento que algo
-- dispare: es un estado que el worker de oportunidades estancadas va a buscar
-- una vez por día. Sin memoria de lo que ya hizo, una oportunidad que sigue
-- quieta cumpliría la condición MAÑANA también, y pasado, y generaría un
-- borrador de seguimiento nuevo cada día para siempre. Esta columna es esa
-- memoria: cuándo la acción dejó por última vez un borrador para la fila.
--
-- El worker solo emite el evento si, además de cumplir los días, la columna es
-- NULL o ANTERIOR a updated_at: es decir, si hubo un movimiento real DESPUÉS
-- del último borrador (aunque sea cambiarle el monto) y la oportunidad volvió a
-- estancarse. La escribe SOLO el handler de la acción, recién DESPUÉS de crear
-- la Activity — si el modelo o la Activity fallan, la fila no queda marcada y
-- la pasada del día siguiente la vuelve a intentar — y con un UPDATE crudo que
-- NO toca updated_at (el @updatedAt de Prisma lo movería, y la marca
-- quedaría siempre un instante ANTES del updated_at que ella misma causó: el
-- redraft diario que la columna existe para impedir).
--
-- NULLABLE, SIN DEFAULT Y SIN BACKFILL: "nunca se le redactó un seguimiento"
-- es exactamente el estado de todas las oportunidades existentes al aplicar
-- esto. Mismo criterio que conversations.brief (20260927120000).
--
-- SIN ÍNDICE: el worker filtra por organización, status y updated_at, y
-- compara esta columna contra updated_at de la misma fila — no es una columna
-- por la que se busque, se lee junto con la fila que el resto del filtro ya
-- eligió. El acceso real lo resuelve opportunities_organization_id_idx.
--
-- 2) automations.trigger_config — LA CONFIGURACIÓN DEL TRIGGER.
--
-- Hasta acá el único trigger (opportunity.won) no tenía nada que configurar y
-- la regla solo guardaba la config de la ACCIÓN. opportunity.stale necesita
-- daysWithoutActivity, que es del disparador y no de lo que se hace cuando
-- dispara. Mismo criterio que action_config: JSONB sin forma impuesta por
-- Postgres; cada trigger declara su schema zod en automationTriggers.ts y el
-- CRUD lo valida antes de guardar. NOT NULL con DEFAULT '{}': es la config
-- válida de opportunity.won, así que las reglas existentes quedan correctas
-- sin backfill y sin que la aplicación tenga que distinguir NULL de "{}".
--
-- No entra al diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql): no hay
-- tabla nueva (fila 5), ni CHECK (fila 8), ni FK (filas 14/16).
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). Los ALTER TABLE son exactamente lo que `prisma migrate diff`
-- deriva del schema, para que no aparezca drift.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "opportunities"
  ADD COLUMN IF NOT EXISTS "last_stale_follow_up_drafted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "automations"
  ADD COLUMN IF NOT EXISTS "trigger_config" JSONB NOT NULL DEFAULT '{}';
