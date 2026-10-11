import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ENCABEZADO_INDICACIONES,
  ENCABEZADO_KNOWLEDGE_BASE,
  armarSystemPrompt,
} from "../services/agentOrchestration.service";
import { CAMPOS_DE_CLINICA, sinCamposDeClinica } from "./camposDeClinica";
import { clasificarMensajeDeSalud } from "./guardrailsDeSalud";

// ---------------------------------------------------------------------------
// R18 (docs/rubros.md §5.4), sin base: las indicaciones van en su propio
// bloque del prompt con la instrucción de transcribir; lo GENERAL queda como
// siempre; y una consulta de salud la sigue derivando la capa 1 antes del
// modelo.
// ---------------------------------------------------------------------------

const agente = { instructions: "Sos el asistente.", tone: null, guardrails: {} };

test("las indicaciones van en su bloque, con la instrucción de transcribir", () => {
  const prompt = armarSystemPrompt(agente, [
    { title: "Horarios", content: "Lunes a viernes de 9 a 18.", kind: "GENERAL" },
    {
      title: "Antes de la depilación láser",
      content: "Venir con la zona rasurada.",
      kind: "INDICACIONES",
    },
  ]);
  const kb = prompt.indexOf(ENCABEZADO_KNOWLEDGE_BASE);
  const ind = prompt.indexOf(ENCABEZADO_INDICACIONES);
  assert.ok(kb >= 0 && ind > kb);
  assert.match(ENCABEZADO_INDICACIONES, /TRANSCRIBILA tal cual/);
  assert.match(ENCABEZADO_INDICACIONES, /no adaptes nada a su caso|ni adaptes nada a su caso/);
  const bloqueGeneral = prompt.slice(kb, ind);
  assert.doesNotMatch(bloqueGeneral, /depilación láser/);
  assert.match(prompt.slice(ind), /### Antes de la depilación láser\nVenir con la zona rasurada\./);
});

test("sin indicaciones el prompt es el de siempre (entradas sin kind o GENERAL)", () => {
  const sinKind = armarSystemPrompt(agente, [{ title: "Horarios", content: "9 a 18." }]);
  const general = armarSystemPrompt(agente, [
    { title: "Horarios", content: "9 a 18.", kind: "GENERAL" },
  ]);
  assert.equal(general, sinKind);
  assert.doesNotMatch(sinKind, /Indicaciones de la clínica/);
});

test("una pregunta de síntomas o «¿es normal que…?» deriva antes del modelo aunque haya una indicación parecida", () => {
  for (const frase of [
    "¿Es normal que me arda después de la depilación láser?",
    "me quedó roja la zona después del láser",
  ]) {
    assert.equal(clasificarMensajeDeSalud(frase), "CLINICA", frase);
  }
  assert.equal(
    clasificarMensajeDeSalud("¿Qué tengo que hacer antes de la depilación láser?"),
    "NINGUNO",
  );
});

test("una automotora no ve el kind en sus entradas", () => {
  const entrada = { id: "e1", title: "Horarios", kind: "GENERAL" };
  assert.deepEqual(
    Object.keys(sinCamposDeClinica(entrada, "AUTOMOTORA", CAMPOS_DE_CLINICA.knowledgeBaseEntry)),
    ["id", "title"],
  );
});
