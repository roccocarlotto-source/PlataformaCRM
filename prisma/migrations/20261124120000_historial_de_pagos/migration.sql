-- ---------------------------------------------------------------------------
-- Historial de pagos (PR-17b, decisión de Rocco del 30/10/2026): cada alta,
-- corrección y borrado de un pago deja una fila con quién, cuándo y el valor
-- de antes. Las decisiones de modelado están en prisma/schema.prisma, en el
-- comentario de PaymentChange; acá solo lo propio del DDL.
--
-- ADITIVA: un tipo y una tabla nuevos. No toca ninguna tabla ni fila
-- existente, y el código en uso no la conoce, así que va en un solo PR
-- (docs/deployment.md §2.2).
--
-- CÓMO SE GENERÓ: `prisma migrate diff --from-schema-datasource
-- --to-schema-datamodel --script` contra el Supabase local al día con
-- 20261123120000. Se quitaron, como siempre, los `DROP INDEX *_trgm_idx`
-- (índices manuales de 20260828120100) y un `RENAME INDEX` de
-- google_calendar_channels que el diff propone por un nombre truncado viejo:
-- ninguno de los dos es de este cambio.
--
-- ACCIONES REFERENCIALES: las de la regla de 20260821140200 (columna NOT NULL
-- -> RESTRICT), que la fila 14 del diagnóstico deriva sola. payment_id no
-- tiene FK a propósito: el pago se borra físicamente y su registro de borrado
-- tiene que sobrevivirle.
--
-- El bloque final (RLS + CHECK) es manual, mismo criterio que
-- 20260907120000: lo que el DSL no expresa va en la migración versionada. La
-- fila 5 del diagnóstico afirma la política y la fila 8, el CHECK.
--
-- VUELTA ATRÁS, si hiciera falta (borra el historial; los pagos no se
-- tocan):
--   drop table public.payment_changes;
--   drop type public."PaymentChangeAction";
--   delete from public._prisma_migrations
--     where migration_name = '20261124120000_historial_de_pagos';
-- y revertir el PR, para que el código no la escriba.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "PaymentChangeAction" AS ENUM ('CREATED', 'UPDATED', 'DELETED');

-- CreateTable
CREATE TABLE "payment_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "action" "PaymentChangeAction" NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "before_values" JSONB,
    "after_values" JSONB,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_changes_organization_id_opportunity_id_changed_at_idx" ON "payment_changes"("organization_id", "opportunity_id", "changed_at");

-- AddForeignKey
ALTER TABLE "payment_changes" ADD CONSTRAINT "payment_changes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_changes" ADD CONSTRAINT "payment_changes_organization_id_opportunity_id_fkey" FOREIGN KEY ("organization_id", "opportunity_id") REFERENCES "opportunities"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_changes" ADD CONSTRAINT "payment_changes_organization_id_changed_by_id_fkey" FOREIGN KEY ("organization_id", "changed_by_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- RLS — mismo patrón uniforme que el resto (prisma/sql/rls_policies.sql).
-- Defensa en profundidad: el backend se conecta con un rol BYPASSRLS.
-- ---------------------------------------------------------------------
alter table public.payment_changes enable row level security;
drop policy if exists payment_changes_isolation on public.payment_changes;
create policy payment_changes_isolation on public.payment_changes
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

-- ---------------------------------------------------------------------
-- CHECK: la foto que corresponde a cada acción. Un alta no tiene "antes", un
-- borrado no tiene "después", una corrección tiene las dos. El service ya lo
-- cumple; esto es el respaldo ante un camino de escritura que no pase por él.
-- ---------------------------------------------------------------------
alter table public.payment_changes
  add constraint payment_changes_values_match_action_check
  check (
    (action = 'CREATED' and before_values is null and after_values is not null)
    or (action = 'UPDATED' and before_values is not null and after_values is not null)
    or (action = 'DELETED' and before_values is not null and after_values is null)
  );
