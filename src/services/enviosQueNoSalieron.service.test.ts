import assert from "node:assert/strict";
import { test } from "node:test";
import { motivoLegible } from "./enviosQueNoSalieron.service";

// El motivo que ve el negocio nunca es el error crudo (puede traer ids o la
// respuesta de Meta): siempre una de estas frases.
test("motivoLegible traduce los errores conocidos a una frase", () => {
  assert.equal(
    motivoLegible("WhatsApp Graph API returned 401: (#190) Error validating access token"),
    "La conexión con WhatsApp venció o se revocó",
  );
  assert.equal(
    motivoLegible("WhatsApp Graph API returned 400: (#131047) Re-engagement message"),
    "Pasaron más de 24 horas desde el último mensaje del cliente",
  );
  assert.equal(
    motivoLegible("WhatsApp Graph API returned 404: Template name does not exist"),
    "La plantilla de WhatsApp no está disponible",
  );
  assert.equal(
    motivoLegible("WhatsApp Graph API returned 503: upstream"),
    "WhatsApp no respondió después de varios intentos",
  );
  assert.equal(
    motivoLegible("WhatsApp Graph API returned 400: (#100) Invalid parameter"),
    "WhatsApp rechazó el envío",
  );
  assert.equal(
    motivoLegible(
      "Agotó sus 5 intentos sin terminar (el proceso que lo tomaba no llegó a cerrarlo)",
    ),
    "El envío se cortó varias veces sin terminar",
  );
  assert.equal(
    motivoLegible(
      '1 de 1 automatizaciones fallaron para el evento 11111111-1111-1111-1111-111111111111 (x): "Regla" [id]: boom',
    ),
    "La automatización falló después de varios intentos",
  );
});

test("motivoLegible: lo desconocido es un error técnico, sin el texto crudo", () => {
  const crudo = "Invalid `prisma.contact.update()` invocation: column contacts.phone";
  const motivo = motivoLegible(crudo);
  assert.equal(motivo, "Error técnico: avisale al soporte de la plataforma");
  assert.equal(motivoLegible(null), motivo);
});
