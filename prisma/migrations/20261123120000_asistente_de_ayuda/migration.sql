-- ---------------------------------------------------------------------------
-- El asistente "¿Cómo se hace?" (docs-privados/asistente-de-ayuda-diseno.md,
-- local; PR 2 de 5): ayuda sobre la guía de uso dentro de la app.
--
-- 1. organizations.help_assistant_enabled: prendido por defecto para todas,
--    las que ya existen incluidas (DEFAULT true, sin backfill aparte). Lo
--    apaga un platform admin si un cliente no lo quiere.
--
-- 2. help_assistant_questions: una fila por pregunta. La usa el endpoint (PR 3)
--    para el tope de 20 preguntas por usuario y por día y el freno de gasto
--    diario de la plataforma, y el informe de Plataforma (PR 5) para ver qué
--    pregunta la gente. La pregunta se guarda enmascarada y la respuesta no se
--    guarda; las filas se borran a los 90 días
--    (src/workers/helpAssistantPurgeWorker.ts).
--
--    Las dos FKs son ON DELETE CASCADE, como llm_turn_usages: es un registro
--    de uso, no un dato que alguien edite, y no tiene que trabar el borrado
--    de una organización (la purga de las de prueba, los tests) ni el de un
--    usuario. La del usuario es compuesta (organization_id, user_id), el
--    molde de las tablas que apuntan a users: el usuario es de la misma
--    organización por construcción.
--
--    RLS con la política uniforme (organization_id = current_organization_id()),
--    mismo molde que llm_turn_usages (20261023120000). Nace sin grants a
--    anon/authenticated: la fila 18 del diagnóstico lo verifica.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). El SQL de las tablas es el de `prisma migrate diff`. La valida
-- el job `integration` del CI.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "HelpAssistantOutcome" AS ENUM ('ANSWERED', 'NOT_COVERED', 'DATA_REDIRECT', 'OFF_TOPIC', 'ERROR');

-- CreateEnum
CREATE TYPE "HelpAssistantFeedback" AS ENUM ('UP', 'DOWN');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "help_assistant_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "help_assistant_questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "industry" "OrganizationIndustry" NOT NULL,
    "edition" "OrganizationEdition" NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "screen" VARCHAR(60),
    "question" VARCHAR(500) NOT NULL,
    "sources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "outcome" "HelpAssistantOutcome" NOT NULL,
    "feedback" "HelpAssistantFeedback",
    "model" VARCHAR(200) NOT NULL,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(12,6),
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "help_assistant_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "help_assistant_questions_user_id_created_at_idx" ON "help_assistant_questions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "help_assistant_questions_created_at_idx" ON "help_assistant_questions"("created_at");

-- AddForeignKey
ALTER TABLE "help_assistant_questions" ADD CONSTRAINT "help_assistant_questions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "help_assistant_questions" ADD CONSTRAINT "help_assistant_questions_organization_id_user_id_fkey" FOREIGN KEY ("organization_id", "user_id") REFERENCES "users"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security: la política uniforme por organización.
alter table public.help_assistant_questions enable row level security;

drop policy if exists help_assistant_questions_isolation on public.help_assistant_questions;
create policy help_assistant_questions_isolation on public.help_assistant_questions
  for all
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());
