-- ---------------------------------------------------------------------------
-- Ítem 57. Limpieza del backfill del §56 cuando no representaba nada real.
--
-- El backfill de `20260922120000_agregar_guardrails_text_a_agent` volcó
-- `guardrails::text` en `guardrails_text` para no dejar en blanco lo que un
-- agente ya tenía configurado. Pero cuando ese JSON no usaba NINGUNA de las
-- seis claves que docs/ai-agent-architecture.md §6 documenta
-- (temasProhibidos, accionesProhibidas, infoNoModificable,
-- condicionesDeDerivacion, promesasProhibidas, datosRequeridosAntesDeAccion),
-- esa configuración nunca tuvo ningún efecto —ni en puedeEjecutarTool() ni en
-- armarSystemPrompt()— y mostrarla como "esto es lo que configuraste" es peor
-- que mostrar el campo vacío: parece una regla real y no lo es. El caso real
-- que lo disparó fue un agente con {"maxTurns": 20}, una clave que ningún
-- código lee.
--
-- Este UPDATE solo toca las filas donde `guardrails_text` SIGUE SIENDO
-- exactamente el volcado que hizo aquel backfill: si el ADMIN ya lo reescribió
-- con sus palabras, la igualdad con `guardrails::text` deja de ser cierta y la
-- fila no se toca. En las que sí toca, limpia los dos campos: `guardrails_text`
-- a '' y `guardrails` a '{}' —semánticamente idéntico a lo que ya regía, cero
-- comportamiento distinto: solo se saca la basura que nunca hizo nada.
-- ---------------------------------------------------------------------------
UPDATE "agents"
SET "guardrails" = '{}'::jsonb,
    "guardrails_text" = ''
WHERE "guardrails_text" = "guardrails"::text
  AND NOT (
    "guardrails" ? 'temasProhibidos'
    OR "guardrails" ? 'accionesProhibidas'
    OR "guardrails" ? 'infoNoModificable'
    OR "guardrails" ? 'condicionesDeDerivacion'
    OR "guardrails" ? 'promesasProhibidas'
    OR "guardrails" ? 'datosRequeridosAntesDeAccion'
  );
