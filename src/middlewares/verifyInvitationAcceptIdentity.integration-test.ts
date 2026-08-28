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
//
// SE ESPERA A `next`, NO AL RETORNO DEL MIDDLEWARE, y la distinción no es
// estilística: asyncHandler devuelve `void`, no la promesa interna
// (`Promise.resolve(handler(...)).catch(next)` sin `return`). Un `await` sobre
// la llamada resuelve de inmediato, antes de que el middleware haya hecho nada,
// y las aserciones corren contra un estado vacío. La primera versión de este
// archivo tenía ese bug y el CI lo encontró: fallaba con "el middleware siempre
// debe terminar llamando a next()" incluso en el camino feliz.
//
// La única señal confiable de que terminó es que `next` haya sido llamado, así
// que se espera exactamente eso. El timeout evita que un cuelgue se manifieste
// como un test que nunca termina.
async function correrMiddleware(accessToken: string) {
  const req = {
    headers: { authorization: `Bearer ${accessToken}` },
  } as unknown as Request;

  let capturado: unknown;

  const termino = new Promise<void>((resolve, reject) => {
    const temporizador = setTimeout(() => {
      reject(new Error("el middleware nunca llamó a next()"));
    }, 10_000);

    const next: NextFunction = ((err?: unknown) => {
      clearTimeout(temporizador);
      capturado = err;
      resolve();
    }) as NextFunction;

    verifyInvitationAcceptIdentity(req, {} as Response, next);
  });

  await termino;
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

// EL ORDEN ES: confirmar, iniciar sesión, y RECIÉN DESPUÉS dejar la identidad
// sin confirmar. No al revés, y la primera versión de este test se equivocó.
//
// Lo intuitivo es crear el usuario con `email_confirm: false` e iniciar sesión.
// No funciona en ningún entorno: GoTrue rechaza `signInWithPassword` de un
// usuario sin confirmar con "Email not confirmed", así que el test se salteaba
// SIEMPRE — incluido el CI, donde un comentario anterior afirmaba que no. La
// rama central de ALTO-3 quedaba sin una sola aserción.
//
// El camino que sí construye la premisa es cambiarle el email por la Admin API
// con `email_confirm: false` DESPUÉS de tener el token en la mano. El token
// sigue siendo criptográficamente válido —se emitió antes— y `getUserById`
// ahora reporta una identidad no confirmada. Es además un escenario realista y
// no un truco de laboratorio: alguien con sesión abierta cambia su email y esa
// dirección nueva todavía no está probada.
test("un email SIN CONFIRMAR es rechazado con 401 — el agujero de ALTO-3", async (t) => {
  const email = emailDePrueba("sin-confirmar");
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`setup falló: ${error?.message ?? ""}`);
  const authUserId = data.user.id;

  try {
    const { accessToken, motivo } = await tokenDe(email);
    assert.ok(accessToken, `setup falló al iniciar sesión: ${motivo ?? ""}`);

    // Ya con el token emitido: la identidad pasa a tener un email sin confirmar.
    const emailNuevo = emailDePrueba("sin-confirmar-nuevo");
    const { error: cambioError } = await getSupabaseAdmin().auth.admin.updateUserById(authUserId, {
      email: emailNuevo,
      email_confirm: false,
    });
    if (cambioError) throw new Error(`no se pudo cambiar el email: ${cambioError.message}`);

    // Se verifica la premisa en vez de darla por hecha: si el proyecto
    // autoconfirmó igual el email nuevo, este test no puede probar nada y lo
    // dice, en vez de pasar por la razón equivocada.
    const { data: releido } = await getSupabaseAdmin().auth.admin.getUserById(authUserId);
    if (releido.user?.email_confirmed_at) {
      t.skip(
        "el proyecto autoconfirmó el email nuevo, así que no se puede construir una identidad no confirmada con un token válido",
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
