import assert from "node:assert/strict";
import { test } from "node:test";
import {
  REQUEST_HUMAN_HANDOFF_TOOL,
  REQUEST_HUMAN_HANDOFF_TOOL_NAME,
  armarSystemPrompt,
} from "./agentOrchestration.service";

// Unitarios, sin base: armarSystemPrompt es pura. Lo que se verifica es que
// los tres guardrails "de lo que el modelo puede DECIR" (nota del paso 4 bajo
// §6, punto 3) lleguen al system prompt cuando están configurados, no lleguen
// cuando no, y que un guardrails mal formado no rompa nada.

const BASE = { instructions: "Sos el agente comercial.", tone: null };

test("sin guardrails: instructions + la instrucción base de derivación, y nada más", () => {
  const prompt = armarSystemPrompt({ ...BASE, guardrails: {} });

  assert.ok(prompt.startsWith("Sos el agente comercial."));
  assert.match(prompt, new RegExp(`Usá ${REQUEST_HUMAN_HANDOFF_TOOL_NAME} si el contacto pide`));
  assert.doesNotMatch(prompt, /No respondas ni opines/);
  assert.doesNotMatch(prompt, /Nunca prometas/);
  assert.doesNotMatch(prompt, /coincide con alguna de estas situaciones/);
  assert.doesNotMatch(prompt, /Tono de la conversación/);
});

test("el tono va como línea propia cuando existe", () => {
  const prompt = armarSystemPrompt({ ...BASE, tone: "  cercano ", guardrails: {} });
  assert.match(prompt, /Tono de la conversación: cercano\./);
});

test("temasProhibidos: lista + instrucción de derivar si preguntan", () => {
  const prompt = armarSystemPrompt({
    ...BASE,
    guardrails: { temasProhibidos: ["diagnósticos médicos", "asesoramiento legal"] },
  });
  assert.match(prompt, /No respondas ni opines sobre los siguientes temas:/);
  assert.match(prompt, /- diagnósticos médicos\n- asesoramiento legal/);
  assert.match(prompt, new RegExp(`derivá con ${REQUEST_HUMAN_HANDOFF_TOOL_NAME}`));
});

test("promesasProhibidas: lista de lo que nunca se promete", () => {
  const prompt = armarSystemPrompt({
    ...BASE,
    guardrails: { promesasProhibidas: ["descuentos no publicados"] },
  });
  assert.match(prompt, /Nunca prometas ni confirmes:\n- descuentos no publicados/);
});

test("condicionesDeDerivacion: lista + los dos disparadores que no dependen de configuración", () => {
  const prompt = armarSystemPrompt({
    ...BASE,
    guardrails: { condicionesDeDerivacion: ["reclamo o queja", "pide hablar con una persona"] },
  });
  assert.match(
    prompt,
    new RegExp(
      `Llamá a ${REQUEST_HUMAN_HANDOFF_TOOL_NAME} si la conversación coincide con alguna de estas situaciones:\n- reclamo o queja\n- pide hablar con una persona`,
    ),
  );
  assert.match(prompt, /También usá .* si el contacto pide explícitamente hablar con una persona/);
  assert.match(prompt, /una acción que necesitás no está disponible/);
});

test("los tres juntos aparecen, en orden, después de instructions y tono", () => {
  const prompt = armarSystemPrompt({
    instructions: "Instrucciones.",
    tone: "formal",
    guardrails: {
      temasProhibidos: ["política"],
      promesasProhibidas: ["plazos"],
      condicionesDeDerivacion: ["reclamo"],
    },
  });
  const orden = [
    prompt.indexOf("Instrucciones."),
    prompt.indexOf("Tono de la conversación"),
    prompt.indexOf("No respondas ni opines"),
    prompt.indexOf("Nunca prometas"),
    prompt.indexOf("Llamá a request_human_handoff"),
  ];
  assert.ok(
    orden.every((i) => i >= 0),
    `faltó alguna sección: ${orden.join(",")}`,
  );
  assert.deepEqual(
    orden,
    [...orden].sort((a, b) => a - b),
  );
});

test("guardrails mal formado o con entradas no textuales se trata como no configurado", () => {
  const casos: unknown[] = [
    null,
    "texto",
    [],
    { temasProhibidos: "política" },
    { promesasProhibidas: 42 },
    { condicionesDeDerivacion: { a: 1 } },
    { temasProhibidos: [1, null, "   "] },
  ];
  for (const guardrails of casos) {
    const prompt = armarSystemPrompt({ ...BASE, guardrails });
    assert.doesNotMatch(prompt, /No respondas ni opines/, JSON.stringify(guardrails));
    assert.doesNotMatch(prompt, /Nunca prometas/, JSON.stringify(guardrails));
    assert.doesNotMatch(prompt, /coincide con alguna/, JSON.stringify(guardrails));
  }
});

test("la tool del sistema exige reason y no pide nada más", () => {
  assert.equal(REQUEST_HUMAN_HANDOFF_TOOL.name, REQUEST_HUMAN_HANDOFF_TOOL_NAME);
  const parametros = REQUEST_HUMAN_HANDOFF_TOOL.parameters as {
    required: string[];
    properties: Record<string, unknown>;
  };
  assert.deepEqual(parametros.required, ["reason"]);
  assert.deepEqual(Object.keys(parametros.properties), ["reason"]);
});
