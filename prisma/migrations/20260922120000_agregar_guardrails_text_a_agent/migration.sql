-- ---------------------------------------------------------------------------
-- `agents.guardrails_text`: los guardrails en LENGUAJE NATURAL
-- (docs/frontend-cambios-pendientes.md §56).
--
-- QUÉ HABÍA. El §55 estrenó el CRUD de agentes con un campo "Guardrails
-- (JSON)": un textarea donde el ADMIN escribía a mano el objeto de
-- docs/ai-agent-architecture.md §6. Decisión explícita de Rocco para arrancar
-- rápido.
--
-- QUÉ PASA AHORA. El ADMIN escribe en sus palabras y el sistema traduce ese
-- texto a ese MISMO objeto, con un panel de confirmación antes de guardar.
-- Esta columna guarda el texto: es lo que la pantalla muestra y vuelve a
-- editar.
--
-- LO QUE NO CAMBIA, Y ES EL PUNTO: `guardrails` (Json) sigue siendo la única
-- fuente del enforcement. puedeEjecutarTool() y armarSystemPrompt() no leen
-- esta columna ni la van a leer — un texto libre no puede decidir si una tool
-- se ejecuta. Por eso es NOT NULL con default '' y no reemplaza a nada:
-- declarar "ningún guardrail" es '', igual que es {} del otro lado.
-- ---------------------------------------------------------------------------
ALTER TABLE "agents" ADD COLUMN "guardrails_text" TEXT NOT NULL DEFAULT '';

-- BACKFILL de los agentes que ya existen — ver ítem 56.
--
-- Es un volcado CRUDO del JSON como texto, no una traducción a prosa: no hay
-- forma de reconstruir la frase original del ADMIN a partir del objeto. Y
-- dejarlo en blanco sería peor que feo: el ADMIN abriría el formulario, vería
-- el campo vacío y creería que su agente no tiene ningún guardrail declarado,
-- cuando `guardrails` sigue haciendo cumplir lo que tenía. Con el volcado ve
-- ALGO y lo reescribe con sus palabras la próxima vez que edite ese agente.
UPDATE "agents"
SET "guardrails_text" = "guardrails"::text
WHERE "guardrails"::text <> '{}';
