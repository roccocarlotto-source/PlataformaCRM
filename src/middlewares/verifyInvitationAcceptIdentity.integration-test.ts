import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { NextFunction, Request, Response } from "express";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { AppError } from "../utils/AppError";
import { verifyInvitationAcceptIdentity } from "./verifyInvitationAcceptIdentity";

// ALTO-3 — la aceptación de invitación ya no confía en el claim `email` del JWT.
//
// Antes, ese claim era la credencial COMPLETA para unirse a una organización con
// el rol que trajera la invitación, y el código nunca miraba email_verified ni
// email_confirmed_at. La seguridad del flujo quedaba apoyada en el toggle
// "Confirm email" del panel de Supabase: con ese toggle apagado, cualquiera
// hacía signup con el email del invitado, recibía una sesión ES256 válida, y
// aceptaba la invitación ajena.
//
// Ahora la identidad se resuelve con admin.getUserById(payload.sub) y se exige
// email_confirmed_at — la opción (B) del hallazgo, la que la auditoría marca
// como recomendada.
//
// ---------------------------------------------------------------------------
// SE INVOCA EL MIDDLEWARE DIRECTO, SIN LEVANTAR EXPRESS
// ---------------------------------------------------------------------------
//
// Es una función (req, res, next) y lo que se prueba es su decisión, no el
// transporte HTTP. asyncHandler ya garantiza que un throw llegue a `next`, así
// que capturar el argumento de `next` es exactamente lo que vería el
// errorHandler. Montar un router para esto agregaría partes móviles sin agregar
// una sola aserción.

const PASSWORD = "una-password-de-prueba-123";

function emailDePrueba(etiqueta: string): string {
  return `alto3-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
}

// Corre el middleware y devuelve { req, error }: `error` es lo que recibió
// `next`, o undefined si pasó limpio.
async function correrMiddleware(accessToken: string) {
  const req = {
    headers: { authorization: `Bearer ${accessToken}` },
  } as unknown as Request;

  let capturado: unknown;
  let llamoNext = false;

  const next: NextFunction = ((err?: unknown) => {
    llamoNext = true;
    capturado = err;
  }) as NextFunction;

  await verifyInvitationAcceptIdentity(req, {} as Response, next);

  assert.ok(llamoNext, "el middleware siempre debe terminar llamando a next()");
  return { req, error: capturado };
}

async function tokenDe(email: string) {
  const { data, error } = await getSupabaseAdmin().auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error || !data.session) {
    return { accessToken: undefined, motivo: error?.message ?? "sin sesión" };
  }
  return { accessToken: data.session.access_token, motivo: undefined };
}

test("un email CONFIRMADO pasa, y la identidad sale de la Admin API — no del claim del token", async () => {
  const email = emailDePrueba("confirmado");
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`setup falló: ${error?.message ?? ""}`);
  const authUserId = data.user.id;

  try {
    const { accessToken, motivo } = await tokenDe(email);
    assert.ok(accessToken, `no se pudo iniciar sesión con un usuario confirmado: ${motivo ?? ""}`);

    const { req, error: rechazo } = await correrMiddleware(accessToken);

    assert.equal(rechazo, undefined, "un email confirmado no debe ser rechazado");
    assert.equal(req.invitationAcceptIdentity?.userId, authUserId);
    assert.equal(req.invitationAcceptIdentity?.email, email.toLowerCase());
  } finally {
    await getSupabaseAdmin().auth.admin.deleteUser(authUserId);
  }
});

test("un email SIN CONFIRMAR es rechazado con 401 — el agujero de ALTO-3", async (t) => {
  const email = emailDePrueba("sin-confirmar");
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: false,
  });
  if (error || !data.user) throw new Error(`setup falló: ${error?.message ?? ""}`);
  const authUserId = data.user.id;

  try {
    const { accessToken, motivo } = await tokenDe(email);

    if (!accessToken) {
      // Este caso necesita un JWT válido de un usuario NO confirmado, y eso solo
      // se puede obtener si el proyecto permite iniciar sesión sin confirmar
      // (auth.email.enable_confirmations = false, que es como está el stack
      // local del CI). Contra un proyecto con "Confirm email" encendido no hay
      // forma de fabricar ese token — y ahí este escenario ya está cubierto por
      // el propio Supabase, que es justamente lo que ALTO-3 no quería que fuera
      // la ÚNICA defensa.
      //
      // Se salta con motivo explícito en vez de fallar: el test no puede
      // construir su premisa, no es que la afirmación sea falsa. En CI no se
      // saltea nunca.
      t.skip(
        `no se pudo obtener un token de un usuario sin confirmar (${motivo ?? ""}) — el proyecto exige confirmación para iniciar sesión`,
      );
      return;
    }

    const { req, error: rechazo } = await correrMiddleware(accessToken);

    assert.ok(rechazo instanceof AppError, "debe rechazar con AppError, no con un error crudo");
    assert.equal(rechazo.statusCode, 401);
    assert.equal(rechazo.message, "Tenés que confirmar tu email antes de aceptar una invitación");

    assert.equal(
      req.invitationAcceptIdentity,
      undefined,
      "no debe dejar identidad en el request cuando rechaza",
    );
  } finally {
    await getSupabaseAdmin().auth.admin.deleteUser(authUserId);
  }
});

test("un `sub` que la Admin API no resuelve es 401, no 500", async () => {
  // Se construye desde un usuario real que se borra ANTES de correr el
  // middleware: el token sigue siendo criptográficamente válido y su `sub` ya no
  // existe. Es el caso "identidad borrada entre la emisión del token y ahora".
  const email = emailDePrueba("borrado");
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`setup falló: ${error?.message ?? ""}`);

  const { accessToken, motivo } = await tokenDe(email);
  assert.ok(accessToken, `setup falló al iniciar sesión: ${motivo ?? ""}`);

  await getSupabaseAdmin().auth.admin.deleteUser(data.user.id);

  const { error: rechazo } = await correrMiddleware(accessToken);

  assert.ok(rechazo instanceof AppError, "debe ser AppError, no un error crudo de la Admin API");
  assert.equal(rechazo.statusCode, 401, "una identidad inexistente es 401, nunca 500");
});
