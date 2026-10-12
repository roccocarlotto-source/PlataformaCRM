-- ---------------------------------------------------------------------------
-- El WABA propio de una organización (docs/whatsapp-alta-clinica.md; decisión
-- de Rocco del 2026-10-12: cada clínica usa su propio número).
--
-- whatsapp_business_connections: tabla nueva y vacía, una fila por
-- organización. Sin token: la clínica nos agrega como socio de su WABA y la
-- plataforma opera con su token de siempre. Sin secretos, así que lleva la
-- política de aislamiento uniforme (fila 5 del diagnóstico). Sin fila, el
-- WABA global: las automotoras no cambian.
--
-- whatsapp_templates.waba_id: nullable y sin default, no reescribe la tabla.
-- NULL = el WABA global (todas las plantillas que ya existen).
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "whatsapp_business_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "waba_id" VARCHAR(64) NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_business_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_business_connections_organization_id_key" ON "whatsapp_business_connections"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_business_connections_waba_id_key" ON "whatsapp_business_connections"("waba_id");

-- AddForeignKey
ALTER TABLE "whatsapp_business_connections" ADD CONSTRAINT "whatsapp_business_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "whatsapp_templates" ADD COLUMN "waba_id" VARCHAR(64);

-- RLS: la política uniforme de aislamiento (fila 5 del diagnóstico).
alter table public.whatsapp_business_connections enable row level security;
drop policy if exists whatsapp_business_connections_isolation on public.whatsapp_business_connections;
create policy whatsapp_business_connections_isolation on public.whatsapp_business_connections
  for all using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
