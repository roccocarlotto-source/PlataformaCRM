import assert from "node:assert/strict";
import { test } from "node:test";
import { leerMensaje, MARCADOR_DE_AUDIO } from "./whatsappWebhook.service";

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

test("leerMensaje: los tipos que todavía no se procesan (imagen, ubicación, sticker) devuelven null", () => {
  for (const tipo of ["image", "location", "sticker", "reaction"]) {
    assert.equal(
      leerMensaje({ from: "598991", id: "wamid.4", type: tipo, [tipo]: { id: "x" } }),
      null,
      tipo,
    );
  }
});
