-- ISSUE-010 de la QA de la primera clínica (2026-11-21): el nombre del
-- contacto lo puso el canal (el perfil de WhatsApp) y nadie lo tocó todavía.
-- Aditiva, con default false: los contactos que ya existen quedan como si el
-- nombre lo hubiera cargado una persona (nada cambia para ellos).
ALTER TABLE "contacts" ADD COLUMN "name_set_by_channel" BOOLEAN NOT NULL DEFAULT false;
