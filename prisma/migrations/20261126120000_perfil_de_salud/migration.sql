-- ---------------------------------------------------------------------------
-- Perfil de salud de una clínica (docs/primera-clinica.md §4, PR2).
--
--   - HealthProfile: MEDICO (el detector de salud de siempre) o ESTETICA (un
--     centro de belleza: urgencia acotada, sin derivación por términos
--     clínicos y capa 3 relajada).
--   - clinic_settings.health_profile: NOT NULL DEFAULT 'MEDICO'. Las clínicas
--     que ya existen quedan en MEDICO, exactamente como estaban.
--
-- Aditiva: un tipo nuevo y una columna con default constante, que en Postgres
-- 11+ no reescribe la tabla. Sin backfill.
--
-- Escrita a mano, no generada por `prisma migrate dev` (la shadow database no
-- tiene el schema auth): es la salida de `prisma migrate diff` entre el
-- schema anterior y el nuevo. La valida el job `integration` del CI, que
-- reconstruye la base desde cero.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "HealthProfile" AS ENUM ('MEDICO', 'ESTETICA');

-- AlterTable
ALTER TABLE "clinic_settings" ADD COLUMN "health_profile" "HealthProfile" NOT NULL DEFAULT 'MEDICO';
