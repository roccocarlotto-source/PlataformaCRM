-- ---------------------------------------------------------------------------
-- WA-1 de los pendientes post F1–F5 (docs-privados/prueba-en-vivo-2026-09-29.md (local, no está en GitHub)).
-- Parte 2 de 2: el CHECK del remitente acepta AUTOMATION.
--
-- messages_sender_user_id_consistency_check se escribió con las dos ramas
-- explícitas justamente para esto (ver 20260912130000): un valor nuevo del
-- enum queda rechazado hasta que alguien decida qué exige. AUTOMATION no es
-- una persona, así que exige sender_user_id NULL, igual que CONTACT y AGENT.
--
-- Va en su propia migración porque nombra el valor que agregó la anterior, y
-- Postgres no deja usarlo en la misma transacción (ver 20261011120000).
--
-- DROP + ADD en la misma transacción: no hay ventana en la que la tabla quede
-- sin el CHECK. El ADD revalida las filas existentes, que ya cumplen la
-- versión anterior (más estricta), así que no puede fallar.
--
-- Al diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) entra en este
-- mismo cambio: la expectativa de la fila 8 para este CHECK se transcribió de
-- lo que pg_get_constraintdef devolvió después de aplicar esta migración. El
-- conteo de CHECKs no cambia.
-- ---------------------------------------------------------------------------

alter table public.messages
  drop constraint messages_sender_user_id_consistency_check;

alter table public.messages
  add constraint messages_sender_user_id_consistency_check
  check (
    (sender_type = 'HUMAN' and sender_user_id is not null)
    or (sender_type in ('CONTACT', 'AGENT', 'AUTOMATION') and sender_user_id is null)
  );
