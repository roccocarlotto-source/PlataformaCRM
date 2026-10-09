-- ---------------------------------------------------------------------------
-- PR 2 de docs/ediciones.md (§10): las columnas de las ediciones y del nivel
-- de participación de la IA. Ningún código de la aplicación las lee todavía;
-- el gate de módulos y el filtro del agente son los PR 3 y 6.
--
-- 1. organizations.edition: COMPLETA (todo lo que existía) o ESENCIAL. Default
--    COMPLETA, sin backfill: las organizaciones existentes quedan como estaban.
--
-- 2. agents.participation: cuánto hace la IA. Nullable y SIN DEFAULT A
--    PROPÓSITO (D3): NULL = "sin elegir", y solo puede pasar en ESENCIAL. Lo
--    completa el trigger del punto 4 al insertar. Los agentes existentes pasan
--    a AUTONOMA (punto 3): todas sus organizaciones son COMPLETA y hoy
--    responden solos.
--
--    agents.participation_chosen_at: cuándo un ADMIN eligió o cambió el nivel.
--    Lo escribe solo el service de agentes (PR 6). Sin backfill.
--
--    agents.only_outside_business_hours: el interruptor "solo fuera de
--    horario" de PRIMER_CONTACTO. Default false.
--
-- 3. El UPDATE a AUTONOMA va ANTES del CHECK del punto 5: el CHECK revalida
--    todas las filas al agregarse, y un agente activo todavía en NULL lo haría
--    fallar. Prisma corre cada migración dentro de una transacción, así que si
--    algo falla no queda nada a medias. El UPDATE incluye a los agentes dados
--    de baja (deleted_at): el CHECK también los mira.
--
-- 4. Trigger trg_agents_nivel_por_defecto (BEFORE INSERT): si el nivel viene
--    NULL y la organización es COMPLETA, lo completa con AUTONOMA; en ESENCIAL
--    lo deja NULL. Así cualquier camino que cree un agente sin decir el nivel
--    (el service, scripts, tests con prisma.agent.create) se comporta como
--    antes en COMPLETA, y en ESENCIAL el agente nace sin nivel. Solo actúa al
--    insertar: cambiar la edición después no toca a los agentes. Se repite en
--    prisma/sql/manual_constraints.sql, que lo reaplica cada `npm run
--    migrate:deploy` (manual; el deploy de Render no corre ese script).
--
-- 5. CHECK agents_activo_requiere_nivel_check: un agente activo tiene nivel.
--    Va solo acá (B-15: los CHECK no se reaplican en migrate:deploy). Como is_active
--    tiene default true, un agente de ESENCIAL creado sin nivel por un camino
--    que no sea el service falla al insertar en lugar de quedar activo.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto desde 20260821 (la shadow database no tiene el schema auth). Enums y
-- columnas son lo que `prisma migrate diff --from-schema-datasource` deriva
-- del schema; el UPDATE, el trigger y el CHECK son lo que el DSL no expresa.
--
-- El nombre ordena DESPUÉS de 20261029120000_seguimiento_de_consultas, la
-- última, que ya tiene fecha futura: migrate deploy aplica en orden de nombre.
--
-- Al diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) entran en este
-- mismo cambio: el CHECK a la fila 8 y el trigger a la fila 9.
-- ---------------------------------------------------------------------------

-- 1 y 2. Enums y columnas.
CREATE TYPE "OrganizationEdition" AS ENUM ('COMPLETA', 'ESENCIAL');

CREATE TYPE "AgentParticipation" AS ENUM ('AUTONOMA', 'PRIMER_CONTACTO', 'SOLO_SEGUIMIENTO');

ALTER TABLE "organizations" ADD COLUMN "edition" "OrganizationEdition" NOT NULL DEFAULT 'COMPLETA';

ALTER TABLE "agents" ADD COLUMN "participation" "AgentParticipation",
ADD COLUMN "participation_chosen_at" TIMESTAMP(3),
ADD COLUMN "only_outside_business_hours" BOOLEAN NOT NULL DEFAULT false;

-- 3. Los agentes existentes, como están hoy.
UPDATE "agents" SET "participation" = 'AUTONOMA' WHERE "participation" IS NULL;

-- 4. Nivel por defecto según la edición (copia en manual_constraints.sql).
create or replace function public.agents_nivel_por_defecto()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.participation is null
     and (select o.edition from public.organizations o where o.id = new.organization_id) = 'COMPLETA' then
    new.participation := 'AUTONOMA';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_agents_nivel_por_defecto on public.agents;

create trigger trg_agents_nivel_por_defecto
before insert on public.agents
for each row
execute function public.agents_nivel_por_defecto();

-- 5. Un agente activo tiene nivel.
ALTER TABLE "agents" ADD CONSTRAINT "agents_activo_requiere_nivel_check"
  CHECK (NOT "is_active" OR "participation" IS NOT NULL);
