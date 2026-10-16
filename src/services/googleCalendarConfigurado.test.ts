import assert from "node:assert/strict";
import { test } from "node:test";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";
import {
  MENSAJE_GOOGLE_SIN_CONFIGURAR,
  getClienteGoogleCalendar,
  googleCalendarConfigurado,
} from "./googleCalendar.service";

// ---------------------------------------------------------------------------
// Google Calendar sin configurar en la plataforma: la ficha de la sucursal
// pregunta googleCalendarConfigurado() (GET /api/integrations/google-calendar/
// estado) para no ofrecer "Conectar", y si igual se llama, el cliente responde
// un 503 que no nombra variables de entorno (M-11 b). Antes era un 500
// genérico.
//
// `env` es un objeto plano: se fijan las tres variables para cada caso y se
// restauran en el finally. getClienteGoogleCalendar() memoiza el cliente, así
// que solo se llama en el caso sin configurar (nunca llega a crearlo).
// ---------------------------------------------------------------------------

const VARIABLES = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"] as const;

function conVariables(
  valores: Partial<Record<(typeof VARIABLES)[number], string>>,
  fn: () => void,
) {
  const originales = VARIABLES.map((nombre) => env[nombre]);
  for (const nombre of VARIABLES) {
    (env as Record<string, unknown>)[nombre] = valores[nombre];
  }
  try {
    fn();
  } finally {
    VARIABLES.forEach((nombre, i) => {
      (env as Record<string, unknown>)[nombre] = originales[i];
    });
  }
}

test("configurado solo con las tres variables del OAuth", () => {
  conVariables(
    {
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secreto",
      GOOGLE_REDIRECT_URI: "https://api.example.com/api/integrations/google-calendar/callback",
    },
    () => assert.equal(googleCalendarConfigurado(), true),
  );
  conVariables({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secreto" }, () =>
    assert.equal(googleCalendarConfigurado(), false),
  );
  conVariables({}, () => assert.equal(googleCalendarConfigurado(), false));
});

test("sin configurar, el cliente responde 503 operacional y sin nombres de variables", () => {
  conVariables({}, () => {
    let capturado: unknown;
    try {
      getClienteGoogleCalendar();
    } catch (err) {
      capturado = err;
    }
    assert.ok(capturado instanceof AppError);
    assert.equal(capturado.statusCode, 503);
    assert.equal(capturado.isOperational, true);
    assert.equal(capturado.message, MENSAJE_GOOGLE_SIN_CONFIGURAR);
    assert.doesNotMatch(capturado.message, /GOOGLE_/);
  });
});
