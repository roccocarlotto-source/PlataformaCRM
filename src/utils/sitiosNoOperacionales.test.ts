import assert from "node:assert/strict";
import { test } from "node:test";
import { env } from "../config/env";
import { getSupabaseAnon } from "../lib/supabaseAnon";
import { renovarCanal } from "../services/googleCalendarConnection.service";
import { AppError } from "./AppError";
import { MASTER_KEY_BYTES, crearCifrador, getCifrador, resetCifradorParaTests } from "./encryption";
import { firmarState, resetClaveDeFirmaParaTests, type OAuthState } from "./oauthState";
import { firmarWebhookToken, resetClaveDeWebhookParaTests } from "./webhookToken";

// ---------------------------------------------------------------------------
// Los siete sitios de §28.7 de docs/bitacora-2026-08-29.md (M-11 b, segundo
// commit del PR #63): AppError(…, 500) que nombran variables de entorno o
// exponen un dato interno, reclasificados a isOperational: false.
//
// LO QUE ESTE ARCHIVO PRUEBA ES QUE EL SITIO CORRECTO QUEDÓ MARCADO, nada más.
// El mecanismo genérico —que un AppError no operacional responde el mensaje
// genérico y deja el real en el log— ya está probado de punta a punta en
// errorHandler.test.ts; repetirlo siete veces no sumaría nada. Acá cada test
// dispara el `throw` específico y lee la propiedad del AppError capturado.
//
// CÓMO SE DISPARAN SIN MOCKEAR EL PROCESO: `env` (config/env.ts) es un objeto
// plano, así que se anula la variable justo para la llamada y se restaura en
// el finally; los módulos que memoizan la clave tienen su reset…ParaTests.
// El séptimo sitio —"Rol desconocido" en auth.service— necesita una fila en la
// base y vive en services/auth.service.integration-test.ts.
// ---------------------------------------------------------------------------

function esNoOperacional(err: unknown): boolean {
  return err instanceof AppError && err.statusCode === 500 && err.isOperational === false;
}

// Anula una variable de `env` durante `fn` y la restaura pase lo que pase.
async function sinVariable<K extends keyof typeof env>(
  nombre: K,
  fn: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const original = env[nombre];
  (env as Record<string, unknown>)[nombre] = undefined;
  try {
    return await fn();
  } finally {
    (env as Record<string, unknown>)[nombre] = original;
  }
}

async function capturar(fn: () => unknown | Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error("se esperaba un throw y no hubo ninguno");
}

test("1. getSupabaseAnon sin SUPABASE_ANON_KEY: AppError 500 no operacional", async () => {
  const err = await sinVariable("SUPABASE_ANON_KEY", () => capturar(() => getSupabaseAnon()));

  assert.ok(esNoOperacional(err), String(err));
  assert.match((err as AppError).message, /SUPABASE_ANON_KEY/);
});

test("2. renovarCanal sin GOOGLE_WEBHOOK_URL: AppError 500 no operacional, antes de tocar la base", async () => {
  const err = await sinVariable("GOOGLE_WEBHOOK_URL", () =>
    capturar(() =>
      renovarCanal({
        organizationId: "00000000-0000-0000-0000-000000000000",
        branchId: "00000000-0000-0000-0000-000000000000",
        channelId: null,
        channelResourceId: null,
      }),
    ),
  );

  // Si esto fuera un error de Prisma, el chequeo de la variable no habría
  // corrido primero: el test también fija ese orden.
  assert.ok(esNoOperacional(err), String(err));
  assert.match((err as AppError).message, /GOOGLE_WEBHOOK_URL/);
});

test("3. un ciphertext manipulado (formato válido, tag de GCM rechazado): AppError 500 no operacional", async () => {
  const cifrador = crearCifrador(Buffer.alloc(MASTER_KEY_BYTES, 9));
  const partes = cifrador.encrypt("un refresh token").split(".");
  const ultimo = partes[3].at(-1) === "A" ? "B" : "A";
  partes[3] = partes[3].slice(0, -1) + ultimo;

  const err = await capturar(() => cifrador.decrypt(partes.join(".")));

  assert.ok(esNoOperacional(err), String(err));
  assert.match((err as AppError).message, /manipulado/);
});

test("4. getCifrador sin SECRET_ENCRYPTION_KEY: AppError 500 no operacional", async () => {
  resetCifradorParaTests();
  try {
    const err = await sinVariable("SECRET_ENCRYPTION_KEY", () => capturar(() => getCifrador()));

    assert.ok(esNoOperacional(err), String(err));
    assert.match((err as AppError).message, /SECRET_ENCRYPTION_KEY no está configurada/);
  } finally {
    resetCifradorParaTests();
  }
});

test("5. firmarState sin SECRET_ENCRYPTION_KEY: AppError 500 no operacional", async () => {
  resetClaveDeFirmaParaTests();
  try {
    const err = await sinVariable("SECRET_ENCRYPTION_KEY", () =>
      capturar(() =>
        firmarState({
          organizationId: "00000000-0000-0000-0000-000000000000",
          branchId: "00000000-0000-0000-0000-000000000000",
        } as OAuthState),
      ),
    );

    assert.ok(esNoOperacional(err), String(err));
    assert.match((err as AppError).message, /state del flujo OAuth/);
  } finally {
    resetClaveDeFirmaParaTests();
  }
});

test("6. firmarWebhookToken sin SECRET_ENCRYPTION_KEY: AppError 500 no operacional", async () => {
  resetClaveDeWebhookParaTests();
  try {
    const err = await sinVariable("SECRET_ENCRYPTION_KEY", () =>
      capturar(() =>
        firmarWebhookToken({
          organizationId: "00000000-0000-0000-0000-000000000000",
          branchId: "00000000-0000-0000-0000-000000000000",
          channelId: "00000000-0000-0000-0000-000000000000",
        }),
      ),
    );

    assert.ok(esNoOperacional(err), String(err));
    assert.match((err as AppError).message, /token del canal de notificaciones/);
  } finally {
    resetClaveDeWebhookParaTests();
  }
});
