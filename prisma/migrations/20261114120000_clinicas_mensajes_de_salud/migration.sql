-- ---------------------------------------------------------------------------
-- Mensajes de salud configurables por el ADMIN de una clínica (docs/rubros.md
-- §5.3, D11 revisada el 2026-10-12).
--
-- clinic_settings: el texto de urgencia y el de consulta clínica (NULL = el
-- texto por defecto del código), y los términos que la clínica suma al
-- detector de la capa 1 (vacío = solo los del código). Columnas nullables o
-- con default constante: no reescriben la tabla. Las automotoras no tienen
-- fila en clinic_settings.
--
-- clinic_health_settings_changes: tabla nueva y vacía, append-only. Quién
-- cambió los mensajes y los términos, cuándo y qué. La escribe solo el service
-- de clínicas. RLS con la política uniforme de aislamiento (fila 5 del
-- diagnóstico).
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "clinic_settings"
  ADD COLUMN "urgency_message_text"  VARCHAR(500),
  ADD COLUMN "clinical_message_text" VARCHAR(500),
  ADD COLUMN "extra_urgency_terms"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "extra_clinical_terms"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "clinic_settings"
  ADD CONSTRAINT "clinic_settings_extra_urgency_terms_max_check"
    CHECK (cardinality(extra_urgency_terms) <= 100),
  ADD CONSTRAINT "clinic_settings_extra_clinical_terms_max_check"
    CHECK (cardinality(extra_clinical_terms) <= 100);

-- CreateTable
CREATE TABLE "clinic_health_settings_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "changes" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinic_health_settings_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clinic_health_settings_changes_organization_id_created_at_idx" ON "clinic_health_settings_changes"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "clinic_health_settings_changes" ADD CONSTRAINT "clinic_health_settings_changes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (C-3): quien cambió es de la misma organización.
ALTER TABLE "clinic_health_settings_changes" ADD CONSTRAINT "clinic_health_settings_changes_changed_by_fkey" FOREIGN KEY ("organization_id", "changed_by_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: la política uniforme de aislamiento (fila 5 del diagnóstico).
alter table public.clinic_health_settings_changes enable row level security;
drop policy if exists clinic_health_settings_changes_isolation on public.clinic_health_settings_changes;
create policy clinic_health_settings_changes_isolation on public.clinic_health_settings_changes
  for all using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
