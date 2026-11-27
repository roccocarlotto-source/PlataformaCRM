import assert from "node:assert/strict";
import { test } from "node:test";
import {
  esEntranteNoSoportado,
  leerCambioDeIdentidad,
  leerContactoDelPayload,
  leerMensaje,
  MARCADORES_NO_SOPORTADOS,
  MARCADOR_DE_AUDIO,
  MARCADOR_DE_IMAGEN,
  MARCADOR_DE_UBICACION,
  textoDeUbicacion,
} from "./whatsappWebhook.service";

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

test("leerMensaje: una ubicación con nombre y dirección (ítem 164) se lee como texto, sin media", () => {
  assert.deepEqual(
    leerMensaje({
      from: "598991",
      id: "wamid.9",
      timestamp: "1",
      type: "location",
      location: {
        latitude: -34.901112,
        longitude: -56.164532,
        name: "Concesionaria Norte",
        address: "Av. Italia 1234",
        url: "https://example.com",
      },
    }),
    {
      wamid: "wamid.9",
      waId: "598991",
      texto: "[ubicación] -34.901112, -56.164532 — Concesionaria Norte (Av. Italia 1234)",
    },
  );
});

test("leerMensaje: una ubicación solo con nombre lleva el nombre y no la dirección", () => {
  assert.equal(
    leerMensaje({
      from: "598991",
      id: "wamid.10",
      type: "location",
      location: { latitude: -34.901112, longitude: -56.164532, name: "Concesionaria Norte" },
    })?.texto,
    "[ubicación] -34.901112, -56.164532 — Concesionaria Norte",
  );
});

test("leerMensaje: una ubicación sin nombre ni dirección son solo las coordenadas", () => {
  assert.deepEqual(
    leerMensaje({
      from: "598991",
      id: "wamid.11",
      type: "location",
      location: { latitude: -34.901112, longitude: -56.164532 },
    }),
    { wamid: "wamid.11", waId: "598991", texto: `${MARCADOR_DE_UBICACION} -34.901112, -56.164532` },
  );
});

test("leerMensaje: una ubicación sin coordenadas numéricas no se procesa", () => {
  for (const location of [
    { longitude: -56.1 },
    { latitude: "-34.9", longitude: "-56.1" },
    { name: "Concesionaria Norte" },
  ]) {
    assert.equal(
      leerMensaje({ from: "598991", id: "wamid.12", type: "location", location }),
      null,
      JSON.stringify(location),
    );
  }
});

test("textoDeUbicacion: coordenadas fijas a 6 decimales; nombre o dirección vacíos cuentan como ausentes", () => {
  assert.equal(
    textoDeUbicacion({ latitude: -34.9, longitude: -56 }),
    "[ubicación] -34.900000, -56.000000",
  );
  assert.equal(
    textoDeUbicacion({ latitude: -34.9011123456, longitude: -56.1645329 }),
    "[ubicación] -34.901112, -56.164533",
  );
  assert.equal(
    textoDeUbicacion({ latitude: 1, longitude: 2, name: "  ", address: "Av. Italia 1234" }),
    "[ubicación] 1.000000, 2.000000 (Av. Italia 1234)",
  );
  assert.equal(
    textoDeUbicacion({ latitude: 1, longitude: 2, name: " Casa ", address: "" }),
    "[ubicación] 1.000000, 2.000000 — Casa",
  );
});

// B-09 residual (docs-privados/auditoria-2026-09-24-punta-a-punta.md, local).
test("leerMensaje: video, documento, sticker, contacto y 'unsupported' se leen con su marcador de respuesta fija", () => {
  for (const [tipo, marcador] of Object.entries(MARCADORES_NO_SOPORTADOS)) {
    const leido = leerMensaje({ from: "598991", id: "wamid.4", type: tipo, [tipo]: { id: "x" } });
    assert.deepEqual(leido, { wamid: "wamid.4", waId: "598991", texto: marcador }, tipo);
    assert.equal(esEntranteNoSoportado(marcador), true, tipo);
  }
});

test("leerMensaje: una reacción, o un tipo desconocido, se sigue ignorando sin respuesta", () => {
  for (const tipo of ["reaction", "system", "order"]) {
    assert.equal(
      leerMensaje({ from: "598991", id: "wamid.4", type: tipo, [tipo]: { emoji: "👍" } }),
      null,
      tipo,
    );
  }
});

test("leerMensaje: un botón o una respuesta interactiva se leen como el texto que tocó el cliente", () => {
  assert.deepEqual(
    leerMensaje({
      from: "598991",
      id: "wamid.5",
      type: "button",
      button: { text: "Sí, me interesa", payload: "SI" },
    }),
    { wamid: "wamid.5", waId: "598991", texto: "Sí, me interesa" },
  );
  assert.equal(
    leerMensaje({
      from: "598991",
      id: "wamid.6",
      type: "interactive",
      interactive: { type: "button_reply", button_reply: { id: "b1", title: "Agendar visita" } },
    })?.texto,
    "Agendar visita",
  );
  assert.equal(
    leerMensaje({
      from: "598991",
      id: "wamid.7",
      type: "interactive",
      interactive: { type: "list_reply", list_reply: { id: "l1", title: "Hilux SRV" } },
    })?.texto,
    "Hilux SRV",
  );
  // Sin texto legible: respuesta fija, como un tipo no soportado.
  const sinTexto = leerMensaje({ from: "598991", id: "wamid.8", type: "button", button: {} });
  assert.ok(sinTexto && esEntranteNoSoportado(sinTexto.texto));
});

test("esEntranteNoSoportado: un texto común, o uno que solo contiene un marcador, no", () => {
  assert.equal(esEntranteNoSoportado("Hola"), false);
  assert.equal(esEntranteNoSoportado("te mando el [video] ahora"), false);
  assert.equal(esEntranteNoSoportado(" [video] "), true);
});

// ---------------------------------------------------------------------------
// PR0 (docs/mensajes-con-opciones.md §10.1): el BSUID. Meta lo manda en todo
// mensaje como `from_user_id`; con los nombres de usuario de WhatsApp, el
// teléfono (`from`) puede no venir. Payloads con la forma de la documentación
// de Meta (business-scoped user IDs) y valores ficticios.
// ---------------------------------------------------------------------------

const BSUID = "UY.1234567890123456789";

test("leerMensaje: con teléfono y BSUID, el teléfono sigue siendo el remitente y el BSUID viaja aparte", () => {
  assert.deepEqual(
    leerMensaje({
      from: "598991",
      from_user_id: BSUID,
      id: "wamid.b1",
      type: "text",
      text: { body: "Hola" },
    }),
    { wamid: "wamid.b1", waId: "598991", bsuid: BSUID, texto: "Hola" },
  );
});

test("leerMensaje: sin teléfono, el BSUID es el remitente (antes el mensaje se descartaba)", () => {
  assert.deepEqual(
    leerMensaje({ from_user_id: BSUID, id: "wamid.b2", type: "text", text: { body: "Hola" } }),
    { wamid: "wamid.b2", waId: BSUID, bsuid: BSUID, texto: "Hola" },
  );
  // Todos los tipos: audio, imagen, ubicación, botón, no soportado.
  const audio = leerMensaje({
    from_user_id: BSUID,
    id: "wamid.b3",
    type: "audio",
    audio: { id: "media.1", mime_type: "audio/ogg" },
  });
  assert.equal(audio?.waId, BSUID);
  assert.equal(audio?.texto, MARCADOR_DE_AUDIO);
  const imagen = leerMensaje({
    from_user_id: BSUID,
    id: "wamid.b4",
    type: "image",
    image: { id: "media.2", mime_type: "image/jpeg" },
  });
  assert.equal(imagen?.waId, BSUID);
  const ubicacion = leerMensaje({
    from_user_id: BSUID,
    id: "wamid.b5",
    type: "location",
    location: { latitude: -34.9, longitude: -56.16 },
  });
  assert.equal(ubicacion?.waId, BSUID);
  const boton = leerMensaje({
    from_user_id: BSUID,
    id: "wamid.b6",
    type: "button",
    button: { text: "Confirmo", payload: "CONFIRMAR" },
    context: { id: "wamid.plantilla" },
  });
  assert.equal(boton?.waId, BSUID);
  assert.deepEqual(boton?.boton, { payload: "CONFIRMAR", contextId: "wamid.plantilla" });
  const video = leerMensaje({ from_user_id: BSUID, id: "wamid.b7", type: "video", video: {} });
  assert.equal(video?.texto, MARCADORES_NO_SOPORTADOS.video);
});

test("leerMensaje: sin teléfono ni BSUID, o con un BSUID mal formado, no se procesa", () => {
  assert.equal(leerMensaje({ id: "wamid.b8", type: "text", text: { body: "Hola" } }), null);
  assert.equal(
    leerMensaje({
      from_user_id: "no-es-bsuid",
      id: "wamid.b9",
      type: "text",
      text: { body: "Hola" },
    }),
    null,
  );
  // Con teléfono, un BSUID mal formado se ignora y el mensaje sigue por el teléfono.
  assert.deepEqual(
    leerMensaje({
      from: "598991",
      from_user_id: "no-es-bsuid",
      id: "wamid.b10",
      type: "text",
      text: { body: "Hola" },
    }),
    { wamid: "wamid.b10", waId: "598991", texto: "Hola" },
  );
});

test("leerMensaje: un mensaje de un grupo se ignora (fuera de alcance)", () => {
  assert.equal(
    leerMensaje({
      from: "598991",
      from_user_id: BSUID,
      group_id: "grupo.1",
      id: "wamid.b11",
      type: "text",
      text: { body: "Hola a todos" },
    }),
    null,
  );
});

test("leerContactoDelPayload: lee teléfono, BSUID, nombre y usuario; sin wa_id ya no se pierde", () => {
  assert.deepEqual(
    leerContactoDelPayload({ profile: { name: "Ana Pérez" }, wa_id: "598991", user_id: BSUID }),
    { waId: "598991", bsuid: BSUID, nombre: "Ana Pérez" },
  );
  assert.deepEqual(
    leerContactoDelPayload({ profile: { name: "Ana", username: "ana.perez" }, user_id: BSUID }),
    { bsuid: BSUID, nombre: "Ana", usuario: "ana.perez" },
  );
  assert.deepEqual(leerContactoDelPayload({ wa_id: "598991" }), { waId: "598991" });
  assert.equal(leerContactoDelPayload({ profile: { name: "Sin ids" } }), null);
  assert.equal(leerContactoDelPayload("basura"), null);
});

test("leerCambioDeIdentidad: cambio de número (user_changed_number)", () => {
  assert.deepEqual(
    leerCambioDeIdentidad({
      from: "598991",
      id: "wamid.s1",
      type: "system",
      system: {
        body: "User A changed from 598991 to 598992",
        wa_id: "598992",
        user_id: "UY.9999999999",
        previous_user_id: BSUID,
        type: "user_changed_number",
      },
    }),
    {
      wamid: "wamid.s1",
      tipo: "user_changed_number",
      waIdAnterior: "598991",
      bsuidAnterior: BSUID,
      waIdNuevo: "598992",
      bsuidNuevo: "UY.9999999999",
    },
  );
});

test("leerCambioDeIdentidad: cambio de BSUID sin teléfono (user_changed_user_id)", () => {
  assert.deepEqual(
    leerCambioDeIdentidad({
      id: "wamid.s2",
      type: "system",
      system: {
        body: "User changed from a to b",
        user_id: "UY.9999999999",
        previous_user_id: BSUID,
        type: "user_changed_user_id",
      },
    }),
    {
      wamid: "wamid.s2",
      tipo: "user_changed_user_id",
      bsuidAnterior: BSUID,
      bsuidNuevo: "UY.9999999999",
    },
  );
});

test("leerCambioDeIdentidad: otro tipo de sistema, o sin BSUID nuevo, no es un cambio de identidad", () => {
  assert.equal(
    leerCambioDeIdentidad({
      id: "wamid.s3",
      type: "system",
      system: { type: "customer_identity_changed" },
    }),
    null,
  );
  assert.equal(
    leerCambioDeIdentidad({
      id: "wamid.s4",
      type: "system",
      system: { type: "user_changed_number", wa_id: "598992" },
    }),
    null,
  );
  assert.equal(
    leerCambioDeIdentidad({ from: "598991", id: "wamid.s5", type: "text", text: { body: "x" } }),
    null,
  );
});
