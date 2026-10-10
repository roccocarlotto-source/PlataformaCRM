-- ---------------------------------------------------------------------------
-- PR R20 de docs/rubros.md (§15, §11.2, §11.4, §11.5, D19): usuarios por sede.
--
-- TODO ADITIVO. No toca ni reescribe ninguna fila existente:
--   - dos tablas nuevas, vacías: user_branches e invitation_branches;
--   - activities.branch_id, NULLABLE, sin default y sin backfill: todas las
--     tareas de hoy quedan en NULL, que es "sin sede" (las ve cualquier
--     Recepción de la organización, y para una automotora no significa nada);
--   - un UNIQUE (organization_id, id) en invitations, que ya es único por id:
--     no puede fallar con los datos que haya. Solo existe para que la FK
--     compuesta de invitation_branches (C-3) tenga a qué apuntar.
--
-- Solo las clínicas escriben estas filas y esta columna. Una automotora no
-- tiene filas en user_branches, y sedesDelActor (src/services/permisos.ts)
-- devuelve "todas" para ella sin leer la tabla.
--
-- ON DELETE CASCADE en las FKs de las tablas nuevas (excepción declarada en la
-- fila 14 de docs/auditoria-2026-08-21-diagnostico.sql): una fila es una
-- asignación, no un dato de negocio. users y branches usan soft delete, así
-- que en la práctica solo corre al purgar una organización de test.
-- activities.branch_id es nullable: NO ACTION, la regla de 20260821140200.
--
-- ORDEN DE DESPLIEGUE: esta migración va ANTES del código. El código viejo no
-- lee ni las tablas nuevas ni la columna (Prisma ignora una columna que su
-- cliente no conoce); el código nuevo sí selecciona activities.branch_id.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "activities" ADD COLUMN "branch_id" UUID;

-- CreateTable
CREATE TABLE "user_branches" (
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_branches_pkey" PRIMARY KEY ("user_id","branch_id")
);

-- CreateTable
CREATE TABLE "invitation_branches" (
    "organization_id" UUID NOT NULL,
    "invitation_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_branches_pkey" PRIMARY KEY ("invitation_id","branch_id")
);

-- CreateIndex
CREATE INDEX "user_branches_organization_id_user_id_idx" ON "user_branches"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "user_branches_organization_id_branch_id_idx" ON "user_branches"("organization_id", "branch_id");

-- CreateIndex
CREATE INDEX "invitation_branches_organization_id_invitation_id_idx" ON "invitation_branches"("organization_id", "invitation_id");

-- CreateIndex
CREATE INDEX "invitation_branches_organization_id_branch_id_idx" ON "invitation_branches"("organization_id", "branch_id");

-- CreateIndex
CREATE INDEX "activities_organization_id_branch_id_idx" ON "activities"("organization_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_organization_id_id_key" ON "invitations"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_organization_id_user_id_fkey" FOREIGN KEY ("organization_id", "user_id") REFERENCES "users"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_branches" ADD CONSTRAINT "invitation_branches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_branches" ADD CONSTRAINT "invitation_branches_organization_id_invitation_id_fkey" FOREIGN KEY ("organization_id", "invitation_id") REFERENCES "invitations"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_branches" ADD CONSTRAINT "invitation_branches_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: la política uniforme de aislamiento (fila 5 del diagnóstico).
alter table public.user_branches enable row level security;
drop policy if exists user_branches_isolation on public.user_branches;
create policy user_branches_isolation on public.user_branches
  for all using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.invitation_branches enable row level security;
drop policy if exists invitation_branches_isolation on public.invitation_branches;
create policy invitation_branches_isolation on public.invitation_branches
  for all using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
