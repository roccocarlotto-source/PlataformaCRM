import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "@prisma/client";
import { BRIEF_MAX_LENGTH, armarPromptDeBrief, armarTranscript } from "./conversationBrief.service";

// Unitarios, SIN RED Y SIN BASE: las dos funciones de acá son puras. Lo que
// necesita Postgres —que el brief quede guardado y que briefEditedByUserId
// vuelva a null— se prueba en conversationBrief.integration-test.ts, que es el
// único lugar donde eso se puede afirmar de verdad.

function mensaje(
  senderType: Message["senderType"],
  content: string,
  direction: Message["direction"] = "INBOUND",
): Message {
  return {
    id: "m",
    organizationId: "o",
    conversationId: "c",
    direction,
    senderType,
    senderUserId: null,
    content,
    toolCalls: null,
    externalMessageId: null,
    deliveryStatus: null,
    deliveryError: null,
    createdAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// El transcript
// ---------------------------------------------------------------------------

test("una línea por mensaje, con el rótulo de cada uno de los tres autores", () => {
  const transcript = armarTranscript([
    mensaje("CONTACT", "Hola, quiero el precio del Corolla"),
    mensaje("AGENT", "Te paso la lista", "OUTBOUND"),
    mensaje("HUMAN", "Sigo yo desde acá", "OUTBOUND"),
  ]);

  assert.equal(
    transcript,
    [
      "Cliente: Hola, quiero el precio del Corolla",
      "Agente: Te paso la lista",
      "Humano: Sigo yo desde acá",
    ].join("\n"),
  );
});

test("el rótulo sale de senderType y NO de direction: son ortogonales", () => {
  // Un mensaje del agente es OUTBOUND y uno de una persona también, pero no
  // los escribió el mismo autor. Si esto mirara `direction`, los dos dirían lo
  // mismo y el resumen no podría contar que hubo una derivación.
  const transcript = armarTranscript([
    mensaje("AGENT", "Respuesta automática", "OUTBOUND"),
    mensaje("HUMAN", "Respuesta de una persona", "OUTBOUND"),
  ]);

  assert.match(transcript, /^Agente: Respuesta automática$/m);
  assert.match(transcript, /^Humano: Respuesta de una persona$/m);
});

test("el orden recibido se respeta tal cual: el repositorio ya ordena por createdAt", () => {
  const transcript = armarTranscript([
    mensaje("CONTACT", "primero"),
    mensaje("AGENT", "segundo", "OUTBOUND"),
    mensaje("CONTACT", "tercero"),
  ]);

  const lineas = transcript.split("\n");
  assert.deepEqual(lineas, ["Cliente: primero", "Agente: segundo", "Cliente: tercero"]);
});

test("un mensaje vacío o en blanco no produce una línea huérfana", () => {
  const transcript = armarTranscript([
    mensaje("CONTACT", "Hola"),
    mensaje("AGENT", "   ", "OUTBOUND"),
    mensaje("AGENT", "", "OUTBOUND"),
    mensaje("CONTACT", "¿Me escuchás?"),
  ]);

  assert.deepEqual(transcript.split("\n"), ["Cliente: Hola", "Cliente: ¿Me escuchás?"]);
});

test("el contenido se trimea, para que el rótulo quede pegado al texto", () => {
  assert.equal(armarTranscript([mensaje("CONTACT", "  Hola  ")]), "Cliente: Hola");
});

test("sin mensajes, el transcript es la cadena vacía", () => {
  // Es lo que generarBriefDeConversacion usa para no gastar una llamada al
  // proveedor en una conversación sin nada que resumir.
  assert.equal(armarTranscript([]), "");
  assert.equal(armarTranscript([mensaje("CONTACT", "   ")]), "");
});

// ---------------------------------------------------------------------------
// El prompt
// ---------------------------------------------------------------------------

test("el prompt explica los tres rótulos que el transcript usa", () => {
  const prompt = armarPromptDeBrief();

  // Si alguien renombra un rótulo en armarTranscript y no acá, el modelo
  // recibe un transcript con etiquetas que su propio prompt no describe.
  for (const rotulo of ["Cliente", "Agente", "Humano"]) {
    assert.ok(prompt.includes(`"${rotulo}"`), `el prompt debería explicar el rótulo ${rotulo}`);
  }
});

test("el prompt pide las tres cosas que el brief tiene que contar", () => {
  const prompt = armarPromptDeBrief();

  assert.match(prompt, /2 a 4 oraciones/);
  assert.match(prompt, /Qué quería el cliente/);
  assert.match(prompt, /Qué se resolvió o qué acción se tomó/);
  assert.match(prompt, /se derivó a una persona, por qué/);
});

test("el prompt prohíbe inventar y pide solo el texto, sin envoltorio", () => {
  const prompt = armarPromptDeBrief();

  assert.match(prompt, /Respondé SOLO con el texto del resumen/);
  assert.match(prompt, /Sin títulos, sin viñetas, sin comillas/);
  assert.match(prompt, /No inventes nada/);
});

test("el prompt es fijo: no depende del agente, de la organización ni de la conversación", () => {
  // Resumir es una tarea de criterio fijo, no parte del comportamiento
  // configurable de ningún agente. Dos llamadas tienen que dar lo mismo.
  assert.equal(armarPromptDeBrief(), armarPromptDeBrief());
});

test("el tope de guardado es el que el controller reusa para el texto escrito a mano", () => {
  // No es una constante decorativa: el schema del PATCH la importa de acá para
  // que un brief escrito a mano y uno generado no tengan dos límites distintos.
  assert.equal(typeof BRIEF_MAX_LENGTH, "number");
  assert.ok(BRIEF_MAX_LENGTH > 0);
});
