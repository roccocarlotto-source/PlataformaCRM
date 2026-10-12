-- ---------------------------------------------------------------------------
-- El lock del turno del agente por conversación, como lease (préstamo con
-- vencimiento): conLockDeConversacion en src/services/agentOrchestration.service.ts.
--
-- Antes era un pg_advisory_xact_lock sostenido por una transacción abierta
-- durante todo el turno —también mientras esperaba al modelo y a Meta—, así
-- que cada turno en curso ocupaba una conexión del pool. Ahora una fila por
-- clave (agente, contacto, canal) con un turno adentro: se toma con un INSERT
-- ... ON CONFLICT, se renueva mientras el turno corre, se borra al terminar y,
-- si el proceso muere, vence sola. Las conexiones se usan solo lo que dura
-- cada consulta.
--
-- Tabla nueva y vacía. Sin datos personales ni secretos: la clave es texto con
-- ids. Sin FK a contacts ni a agents, para no trabar la unión de contactos ni
-- la purga; la de organizations es CASCADE porque una fila de lease no es
-- historial. Lleva la política uniforme de aislamiento (fila 5 del
-- diagnóstico).
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "agent_turn_leases" (
    "lock_key" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "holder_id" UUID NOT NULL,
    "locked_until" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_turn_leases_pkey" PRIMARY KEY ("lock_key")
);

-- CreateIndex
CREATE INDEX "agent_turn_leases_organization_id_idx" ON "agent_turn_leases"("organization_id");

-- AddForeignKey
ALTER TABLE "agent_turn_leases" ADD CONSTRAINT "agent_turn_leases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: la política uniforme de aislamiento (fila 5 del diagnóstico).
alter table public.agent_turn_leases enable row level security;
drop policy if exists agent_turn_leases_isolation on public.agent_turn_leases;
create policy agent_turn_leases_isolation on public.agent_turn_leases
  for all using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
