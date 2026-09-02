import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { NextFunction, Request, Response } from "express";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { AppError } from "../utils/AppError";
import {
  resolveInvitationAcceptIdentity,
  verifyInvitationAcceptToken,
} from "./verifyInvitationAcceptIdentity";

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

    // Las dos etapas de V-8 en secuencia, sin el limiter del medio: lo que
    // este archivo prueba es el cableado JWT -> Admin API -> request; el
    // orden con el limiter lo fija verifyInvitationAcceptIdentity.chain.test.ts.
    const despuesDeLaFirma: NextFunction = ((err?: unknown) => {
      if (err) {
        next(err);
        return;
      }
      resolveInvitationAcceptIdentity(req, {} as Response, next);
    }) as NextFunction;

    verifyInvitationAcceptToken(req, {} as Response, despuesDeLaFirma);
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

// LA RAMA DE "SIN CONFIRMAR" NO ESTÁ ACÁ, Y NO ES UN OLVIDO.
//
// Necesitaría un JWT válido de una identidad no confirmada, y eso NO EXISTE:
// GoTrue no emite sesión para una identidad sin confirmar. Se probaron los dos
// caminos y los dos fallan por diseño del proveedor, no por el test:
//
//   - crear con email_confirm: false e iniciar sesión -> "Email not confirmed",
//     con el toggle de confirmación encendido Y apagado;
//   - iniciar sesión y después cambiar el email por la Admin API con
//     email_confirm: false -> GoTrue autoconfirma igual el email nuevo, porque
//     una edición de administrador es autoritativa.
//
// La versión anterior de este archivo tenía un test para eso que se salteaba
// SIEMPRE, con un comentario que además afirmaba que en CI no. Esa rama vive
// ahora en verifyInvitationAcceptIdentity.test.ts, sobre la función pura
// resolverIdentidadDeInvitacion, donde se puede cubrir entera y sin red.
//
// Lo que este archivo sí prueba, y el unitario no puede, es el CABLEADO real:
// que un JWT emitido por Supabase de verdad termina resolviendo la identidad
// contra la Admin API y dejándola en el request.
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
