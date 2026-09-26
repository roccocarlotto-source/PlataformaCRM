import assert from "node:assert/strict";
import { test } from "node:test";
import { leerMensaje, MARCADOR_DE_AUDIO, MARCADOR_DE_IMAGEN } from "./whatsappWebhook.service";

// ---------------------------------------------------------------------------
// Qué mensajes del webhook de WhatsApp se procesan y cómo se leen, sin base.
// El recorrido completo (persistir, encolar, el worker) está en
// src/controllers/whatsappWebhook.controller.integration-test.ts.
// ---------------------------------------------------------------------------

test("leerMensaje: un texto se lee con su cuerpo y sin media", () => {
  assert.deepEqual(
    leerMensaje({ from: "598991", id: "wamid.1", type: "text", text: { body: "Hola" } }),
    { wamid: "wamid.1", waId: "598991", texto: "Hola" },
  );
});

test("leerMensaje: un audio (ítem 162) se lee con el marcador y el id + mime_type del media", () => {
  assert.deepEqual(
    leerMensaje({
      from: "598991",
      id: "wamid.2",
      timestamp: "1",
      type: "audio",
      audio: { id: "1234567890", mime_type: "audio/ogg; codecs=opus", voice: true },
    }),
    {
      wamid: "wamid.2",
      waId: "598991",
      texto: MARCADOR_DE_AUDIO,
      media: { id: "1234567890", mimeType: "audio/ogg; codecs=opus" },
    },
  );
});

test("leerMensaje: un audio sin id de media no se procesa", () => {
  assert.equal(
    leerMensaje({
      from: "598991",
      id: "wamid.3",
      type: "audio",
      audio: { mime_type: "audio/ogg" },
    }),
    null,
  );
});

test("leerMensaje: una imagen sin caption (ítem 163) se lee con el marcador y el id + mime_type del media", () => {
  assert.deepEqual(
    leerMensaje({
      from: "598991",
      id: "wamid.5",
      timestamp: "1",
      type: "image",
      image: { id: "987654321", mime_type: "image/jpeg", sha256: "x" },
    }),
    {
      wamid: "wamid.5",
      waId: "598991",
      texto: MARCADOR_DE_IMAGEN,
      media: { id: "987654321", mimeType: "image/jpeg" },
    },
  );
});

test("leerMensaje: una imagen con caption usa el caption como texto, con el media igual", () => {
  assert.deepEqual(
    leerMensaje({
      from: "598991",
      id: "wamid.6",
      type: "image",
      image: { id: "987654321", mime_type: "image/jpeg", caption: "¿Tienen este modelo?" },
    }),
    {
      wamid: "wamid.6",
      waId: "598991",
      texto: "¿Tienen este modelo?",
      media: { id: "987654321", mimeType: "image/jpeg" },
    },
  );
});

test("leerMensaje: un caption vacío o de puros espacios cuenta como sin caption", () => {
  for (const caption of ["", "   "]) {
    assert.equal(
      leerMensaje({
        from: "598991",
        id: "wamid.7",
        type: "image",
        image: { id: "987654321", mime_type: "image/png", caption },
      })?.texto,
      MARCADOR_DE_IMAGEN,
      JSON.stringify(caption),
    );
  }
});

test("leerMensaje: una imagen sin id de media no se procesa", () => {
  assert.equal(
    leerMensaje({
      from: "598991",
      id: "wamid.8",
      type: "image",
      image: { mime_type: "image/jpeg" },
    }),
    null,
  );
});

test("leerMensaje: los tipos que todavía no se procesan (ubicación, sticker, reacción) devuelven null", () => {
  for (const tipo of ["location", "sticker", "reaction"]) {
    assert.equal(
      leerMensaje({ from: "598991", id: "wamid.4", type: tipo, [tipo]: { id: "x" } }),
      null,
      tipo,
    );
  }
});
