import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ENCABEZADO_INDICACIONES,
  ENCABEZADO_KNOWLEDGE_BASE,
  armarSystemPrompt,
} from "../services/agentOrchestration.service";
import { CAMPOS_DE_CLINICA, sinCamposDeClinica } from "./camposDeClinica";
import { clasificarMensajeDeSalud } from "./guardrailsDeSalud";
import { desenlaceDeClinica } from "./reglasDeClinica";
import {
  REGLA_INDICACIONES_TEXTUALES,
  TOOL_DE_INDICACIONES,
  textoDeLasIndicaciones,
  toolsDeIndicaciones,
} from "./toolDeIndicaciones";
import type { ToolCallDelTurno } from "../services/agentOrchestration.service";
import type { ContextoDeEjecucionDeTool } from "../services/agentTools.service";

// ---------------------------------------------------------------------------
// R18 (docs/rubros.md §5.4), sin base: las indicaciones van en su propio
// bloque del prompt, SOLO CON SUS TÍTULOS (desde la prueba de la Clínica
// Demo: el texto lo manda la tool del sistema, tal cual); lo GENERAL queda
// como siempre; y una consulta de salud la sigue derivando la capa 1 antes
// del modelo.
// ---------------------------------------------------------------------------

const agente = { instructions: "Sos el asistente.", tone: null, guardrails: {} };

const INDICACION = "Venir con la zona rasurada.\nSin cremas ni desodorante.";
const ENTRADAS = [
  { title: "Horarios", content: "Lunes a viernes de 9 a 18.", kind: "GENERAL" as const },
  { title: "Antes de la depilación láser", content: INDICACION, kind: "INDICACIONES" as const },
  { title: "Después del peeling", content: "Protector solar.", kind: "INDICACIONES" as const },
];

test("las indicaciones van en su bloque con sus títulos, sin el texto, y nombran la tool", () => {
  const prompt = armarSystemPrompt(agente, ENTRADAS);
  const kb = prompt.indexOf(ENCABEZADO_KNOWLEDGE_BASE);
  const ind = prompt.indexOf(ENCABEZADO_INDICACIONES);
  assert.ok(kb >= 0 && ind > kb);
  assert.ok(ENCABEZADO_INDICACIONES.includes(TOOL_DE_INDICACIONES));
  assert.match(ENCABEZADO_INDICACIONES, /TAL CUAL/);
  const bloqueGeneral = prompt.slice(kb, ind);
  assert.doesNotMatch(bloqueGeneral, /depilación láser/);
  assert.match(prompt.slice(ind), /- Antes de la depilación láser\n- Después del peeling/);
  assert.ok(!prompt.includes("Venir con la zona rasurada"), "el texto no va al modelo");
  assert.ok(!prompt.includes("Protector solar"));
});

// ---------------------------------------------------------------------------
// La tool del sistema y el desenlace (prueba de la Clínica Demo)
// ---------------------------------------------------------------------------

const contexto = {} as ContextoDeEjecucionDeTool;

test("la tool de indicaciones solo existe si la sede tiene alguna", () => {
  assert.deepEqual(toolsDeIndicaciones([ENTRADAS[0]]), []);
  assert.deepEqual(toolsDeIndicaciones([]), []);
  const [tool] = toolsDeIndicaciones(ENTRADAS);
  assert.equal(tool.definition.name, TOOL_DE_INDICACIONES);
});

test("la tool devuelve el texto exacto, por título exacto, sin tildes o con un título recortado", async () => {
  const [tool] = toolsDeIndicaciones(ENTRADAS);
  for (const titulo of [
    "Antes de la depilación láser",
    "antes de la depilacion laser",
    "depilación láser",
  ]) {
    const r = await tool.ejecutar({ titulo }, contexto);
    assert.deepEqual(
      r,
      {
        ok: true,
        data: { titulo: "Antes de la depilación láser", enviada: true, texto: INDICACION },
      },
      titulo,
    );
  }
});

test("un título que no está (o que coincide con dos) da la lista, y nunca el texto de una general", async () => {
  const [tool] = toolsDeIndicaciones(ENTRADAS);
  for (const titulo of ["Horarios", "Antes de la limpieza facial", "de"]) {
    const r = await tool.ejecutar({ titulo }, contexto);
    assert.equal(r.ok, false, titulo);
    assert.match(r.ok ? "" : r.error, /"Antes de la depilación láser", "Después del peeling"/);
  }
  const vacio = await tool.ejecutar({ titulo: "  " }, contexto);
  assert.equal(vacio.ok, false);
  assert.match(vacio.ok ? "" : vacio.error, /al paciente/);
});

function llamada(name: string, result: ToolCallDelTurno["result"]): ToolCallDelTurno {
  return { id: `c-${name}`, name, arguments: {}, allowed: true, result };
}

test("el desenlace manda el texto de cada indicación pedida, en orden y sin repetir", () => {
  const una = llamada(TOOL_DE_INDICACIONES, {
    ok: true,
    data: { titulo: "A", enviada: true, texto: "Texto A" },
  });
  const otra = llamada(TOOL_DE_INDICACIONES, {
    ok: true,
    data: { titulo: "B", enviada: true, texto: "Texto B" },
  });
  const fallida = llamada(TOOL_DE_INDICACIONES, { ok: false, error: "No hay" });
  assert.equal(textoDeLasIndicaciones([una, fallida, otra, una]), "Texto A\n\nTexto B");
  assert.equal(textoDeLasIndicaciones([fallida]), null);
  assert.deepEqual(desenlaceDeClinica([una], { nombreDeLaOrganizacion: "Clínica" }), {
    tipo: "textual",
    regla: REGLA_INDICACIONES_TEXTUALES,
    mensaje: "Texto A",
  });
  assert.equal(desenlaceDeClinica([fallida], { nombreDeLaOrganizacion: "Clínica" }), null);
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
