-- C-3 (docs/auditoria-2026-08-21.md, sección 2): las 19 FKs del modelo eran
-- de columna simple — Postgres verificaba que el UUID referenciado
-- existiera, no que perteneciera a la misma organización. De las 15
-- relaciones cruzadas entre entidades tenant-scoped, ninguna tenía esa
-- garantía a nivel de motor; dependían enteramente de los services.
--
-- Esta migración agrega UNIQUE (organization_id, id) a las 6 tablas padre y
-- reemplaza las 15 FKs cruzadas por su versión compuesta
-- (organization_id, x_id) REFERENCES padre(organization_id, id). Postgres
-- rechaza ahora, a nivel de motor, cualquier fila cuya columna
-- organization_id no coincida con la de la fila referenciada.
--
-- MATCH SIMPLE (el default, no MATCH FULL): con organization_id NOT NULL y
-- la otra columna de la FK nullable, MATCH SIMPLE no valida la FK cuando esa
-- columna nullable es NULL — el comportamiento correcto para las relaciones
-- opcionales (ej. Contact.companyId).
--
-- Las 9 FKs compuestas cuya columna referenciada es nullable (contacts ->
-- companies/users, companies -> users, opportunities -> companies/contacts,
-- activities -> users(assignee)/companies/contacts/opportunities) usan
-- ON DELETE NO ACTION, no SET NULL.
--
-- Opción evaluada y descartada: Postgres 15+ permite acotar SET NULL a una
-- columna ("ON DELETE SET NULL (columna)"), lo que hubiera preservado la
-- semántica original de cada FK sin arriesgar organization_id (NOT NULL,
-- y por lo tanto inelegible para un SET NULL sin acotar sobre la clave
-- compuesta completa). Se descartó porque el DSL de schema.prisma no tiene
-- forma de expresar un SET NULL acotado por columna — solo conoce
-- `onDelete: SetNull` para la relación entera — así que declarar SetNull en
-- schema.prisma mientras el SQL real hace SET NULL (columna) deja al schema
-- y a la migración diciendo cosas distintas. Un futuro `prisma migrate dev`
-- compara el estado que el schema implica (SET NULL sin acotar, que violaría
-- el NOT NULL de organization_id si Prisma lo llegara a generar) contra el
-- estado real (acotado), y propondría un diff para "corregir" la FK —
-- exactamente el problema que C-2 vino a eliminar en el resto del DDL.
--
-- NO ACTION es equivalente a SET NULL en la práctica: el proyecto usa soft
-- delete en las 6 entidades tenant-scoped y nada se borra físicamente jamás
-- (hallazgo ALTO-8 de la auditoría), así que estas acciones referenciales
-- nunca se disparan. La ventaja de NO ACTION sobre SET NULL es que
-- schema.prisma y este SQL quedan diciendo exactamente lo mismo (0 warnings
-- de `prisma validate`), y si alguna vez alguien introduce un borrado físico,
-- la operación falla de forma ruidosa en vez de anular columnas en silencio.

-- ---------------------------------------------------------------------------
-- 1. UNIQUE (organization_id, id) en las 6 tablas padre
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX "users_organization_id_id_key" ON "users"("organization_id", "id");

CREATE UNIQUE INDEX "companies_organization_id_id_key" ON "companies"("organization_id", "id");

CREATE UNIQUE INDEX "contacts_organization_id_id_key" ON "contacts"("organization_id", "id");

CREATE UNIQUE INDEX "opportunities_organization_id_id_key" ON "opportunities"("organization_id", "id");

CREATE UNIQUE INDEX "pipelines_organization_id_id_key" ON "pipelines"("organization_id", "id");

CREATE UNIQUE INDEX "stages_organization_id_id_key" ON "stages"("organization_id", "id");

-- ---------------------------------------------------------------------------
-- 2. Reemplazo de las 15 FKs cruzadas por su versión compuesta
-- ---------------------------------------------------------------------------

-- contacts -> companies
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_company_id_fkey";
ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_organization_id_company_id_fkey"
  FOREIGN KEY ("organization_id", "company_id")
  REFERENCES "companies"("organization_id", "id")
  MATCH SIMPLE
  ON DELETE NO ACTION
  ON UPDATE CASCADE;

-- contacts -> users (owner)
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_owner_id_fkey";
ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_organization_id_owner_id_fkey"
  FOREIGN KEY ("organization_id", "owner_id")
  REFERENCES "users"("organization_id", "id")
  MATCH SIMPLE
  ON DELETE NO ACTION
  ON UPDATE CASCADE;

-- companies -> users (owner)
ALTER TABLE "companies" DROP CONSTRAINT "companies_owner_id_fkey";
ALTER TABLE "companies"
  ADD CONSTRAINT "companies_organization_id_owner_id_fkey"
  FOREIGN KEY ("organization_id", "owner_id")
  REFERENCES "users"("organization_id", "id")
  MATCH SIMPLE
  ON DELETE NO ACTION
  ON UPDATE CASCADE;

-- opportunities -> companies
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_company_id_fkey";
ALTER TABLE "opportunities"
  ADD CONSTRAINT "opportunities_organization_id_company_id_fkey"
  FOREIGN KEY ("organization_id", "company_id")
  REFERENCES "companies"("organization_id", "id")
  MATCH SIMPLE
  ON DELETE NO ACTION
  ON UPDATE CASCADE;

-- opportunities -> contacts
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_contact_id_fkey";
ALTER TABLE "opportunities"
  ADD CONSTRAINT "opportunities_organization_id_contact_id_fkey"
  FOREIGN KEY ("organization_id", "contact_id")
  REFERENCES "contacts"("organization_id", "id")
  MATCH SIMPLE
  ON DELETE NO ACTION
  ON UPDATE CASCADE;

-- opportunities -> users (owner) — owner_id es NOT NULL, sin columna que
-- poner en NULL: mismo comportamiento que antes (RESTRICT bloquea el borrado
-- físico del User referenciado).
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_owner_id_fkey";
ALTER TABLE "opportunities"
  ADD CONSTRAINT "opportunities_organization_id_owner_id_fkey"
  FOREIGN KEY ("organization_id", "owner_id")
  REFERENCES "users"("organization_id", "id")
  MATCH SIMPLE
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

-- opportunities -> pipelines
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_pipeline_id_fkey";
ALTER TABLE "opportunities"
  ADD CONSTRAINT "opportunities_organization_id_pipeline_id_fkey"
  FOREIGN KEY ("organization_id", "pipeline_id")
  REFERENCES "pipelines"("organization_id", "id")
  MATCH SIMPLE
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

-- opportunities -> stages
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_stage_id_fkey";
ALTER TABLE "opportunities"
  ADD CONSTRAINT "opportunities_organization_id_stage_id_fkey"
  FOREIGN KEY ("organization_id", "stage_id")
  REFERENCES "stages"("organization_id", "id")
  MATCH SIMPLE
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

-- activities -> users (author) — author_id es NOT NULL.
ALTER TABLE "activities" DROP CONSTRAINT "activities_author_id_fkey";
ALTER TABLE "activities"
  ADD CONSTRAINT "activities_organization_id_author_id_fkey"
  FOREIGN KEY ("organization_id", "author_id")
  REFERENCES "users"("organization_id", "id")
  MATCH SIMPLE
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

-- activities -> users (assignee)
ALTER TABLE "activities" DROP CONSTRAINT "activities_assignee_id_fkey";
ALTER TABLE "activities"
  ADD CONSTRAINT "activities_organization_id_assignee_id_fkey"
  FOREIGN KEY ("organization_id", "assignee_id")
  REFERENCES "users"("organization_id", "id")
  MATCH SIMPLE
  ON DELETE NO ACTION
  ON UPDATE CASCADE;

-- activities -> companies
ALTER TABLE "activities" DROP CONSTRAINT "activities_company_id_fkey";
ALTER TABLE "activities"
  ADD CONSTRAINT "activities_organization_id_company_id_fkey"
  FOREIGN KEY ("organization_id", "company_id")
  REFERENCES "companies"("organization_id", "id")
  MATCH SIMPLE
  ON DELETE NO ACTION
  ON UPDATE CASCADE;

-- activities -> contacts
ALTER TABLE "activities" DROP CONSTRAINT "activities_contact_id_fkey";
ALTER TABLE "activities"
  ADD CONSTRAINT "activities_organization_id_contact_id_fkey"
  FOREIGN KEY ("organization_id", "contact_id")
  REFERENCES "contacts"("organization_id", "id")
  MATCH SIMPLE
  ON DELETE NO ACTION
  ON UPDATE CASCADE;

-- activities -> opportunities
ALTER TABLE "activities" DROP CONSTRAINT "activities_opportunity_id_fkey";
ALTER TABLE "activities"
  ADD CONSTRAINT "activities_organization_id_opportunity_id_fkey"
  FOREIGN KEY ("organization_id", "opportunity_id")
  REFERENCES "opportunities"("organization_id", "id")
  MATCH SIMPLE
  ON DELETE NO ACTION
  ON UPDATE CASCADE;

-- stages -> pipelines — pipeline_id es NOT NULL; CASCADE borra la fila
-- completa (no hay columna que poner en NULL), mismo comportamiento que
-- antes.
ALTER TABLE "stages" DROP CONSTRAINT "stages_pipeline_id_fkey";
ALTER TABLE "stages"
  ADD CONSTRAINT "stages_organization_id_pipeline_id_fkey"
  FOREIGN KEY ("organization_id", "pipeline_id")
  REFERENCES "pipelines"("organization_id", "id")
  MATCH SIMPLE
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- invitations -> users (invitedBy) — invited_by_id es NOT NULL.
ALTER TABLE "invitations" DROP CONSTRAINT "invitations_invited_by_id_fkey";
ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_organization_id_invited_by_id_fkey"
  FOREIGN KEY ("organization_id", "invited_by_id")
  REFERENCES "users"("organization_id", "id")
  MATCH SIMPLE
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
