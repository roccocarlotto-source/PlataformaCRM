-- ---------------------------------------------------------------------------
-- R16 (docs/rubros.md §8.1): el aviso de privacidad de una clínica, una vez por
-- contacto, antes de la primera respuesta del agente.
--
-- contacts.privacy_notice_sent_at: cuándo se mandó. Nullable y sin default: no
-- reescribe la tabla. Solo es una fecha: no guarda ningún dato del paciente ni
-- un motivo clínico (§8.2). Lo escribe solo código de clínicas.
--
-- MessageNoticeType.PRIVACY_NOTICE: el aviso es un Message de AUTOMATION con
-- ese tipo (messages_notice_type_automation_check ya lo exige). Así el worker
-- de WhatsApp lo encuentra y lo manda antes de la respuesta, también en un
-- reintento. ADD VALUE sin usar el valor en esta migración (como R14).
--
-- Los textos (clinic_settings.privacy_notice_text y privacy_policy_url) ya
-- existen desde R3. Sin CHECK ni FK nuevas: el diagnóstico no cambia.
-- ---------------------------------------------------------------------------

-- AlterEnum
ALTER TYPE "MessageNoticeType" ADD VALUE 'PRIVACY_NOTICE';

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN "privacy_notice_sent_at" TIMESTAMP(3);
