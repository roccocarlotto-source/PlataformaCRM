-- ---------------------------------------------------------------------------
-- Uso del modelo por turno del agente (B4, 06/10/2026): llm_turn_usages.
--
-- Una fila por turno con la organización, el agente, el canal, el modelo,
-- los tokens de entrada y salida y el costo si OpenRouter lo informó. Hasta
-- acá esto era solo una línea de log (FABLE-G-04); la tabla permite el gasto
-- por organización (la vista de plataforma) y, cuando se decida, el tope
-- diario (ver topeDiarioAlcanzado en llmUsage.service.ts).
--
-- agent_id y conversation_id SIN FK, a propósito: el gasto ya ocurrió y la
-- fila tiene que sobrevivir a que se borre la conversación o el agente; un
-- RESTRICT trabaría esos borrados. La única FK es la de la organización, y
-- es ON DELETE CASCADE (no RESTRICT como las tablas de negocio): es un
-- registro de consumo, no un dato que alguien edite, y el gasto de una
-- organización borrada no le importa a nadie. Con RESTRICT, cada borrado de
-- una organización (la purga de las de prueba, los tests de integración)
-- tendría que acordarse de vaciar esto antes.
--
-- RLS con la política uniforme (organization_id = current_organization_id()),
-- mismo molde que qr_follow_ups (20261002120000). La tabla nace sin grants a
-- anon/authenticated: la fila 18 del diagnóstico lo verifica.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). La valida el job `integration` del CI.
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "llm_turn_usages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "channel" "ConversationChannel" NOT NULL,
    "model" VARCHAR(200) NOT NULL,
    "calls" INTEGER NOT NULL,
    "prompt_tokens" INTEGER NOT NULL,
    "completion_tokens" INTEGER NOT NULL,
    "cost_usd" DECIMAL(12,6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_turn_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "llm_turn_usages_organization_id_created_at_idx" ON "llm_turn_usages"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "llm_turn_usages" ADD CONSTRAINT "llm_turn_usages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security: la política uniforme por organización.
alter table public.llm_turn_usages enable row level security;

drop policy if exists llm_turn_usages_isolation on public.llm_turn_usages;
create policy llm_turn_usages_isolation on public.llm_turn_usages
  for all
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());
