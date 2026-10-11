-- ---------------------------------------------------------------------------
-- R18 (docs/rubros.md §5.4, D5): indicaciones antes y después de una prestación
-- en la base de conocimiento, solo en clínicas.
--
-- knowledge_base_entries.kind: GENERAL | INDICACIONES, NOT NULL con default
-- GENERAL. Con un default constante, Postgres 11+ agrega la columna sin
-- reescribir la tabla: todas las entradas existentes (las de las automotoras)
-- quedan GENERAL.
--
-- Sin CHECK ni FK nuevas: el diagnóstico no cambia.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "KnowledgeBaseEntryKind" AS ENUM ('GENERAL', 'INDICACIONES');

-- AlterTable
ALTER TABLE "knowledge_base_entries" ADD COLUMN "kind" "KnowledgeBaseEntryKind" NOT NULL DEFAULT 'GENERAL';
