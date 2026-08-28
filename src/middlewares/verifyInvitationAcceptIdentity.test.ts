import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../utils/AppError";
import {
  resolverIdentidadDeInvitacion,
  type IdentidadDeAuth,
} from "./verifyInvitationAcceptIdentity";

// ALTO-3 — la decisión del middleware, sin red ni base.
//
// ESTE ARCHIVO EXISTE PORQUE EL DE INTEGRACIÓN NO PUEDE CUBRIR LA RAMA QUE
// IMPORTA. Se verificó empíricamente contra GoTrue, con "Confirm email"
// encendido y apagado: **nunca emite una sesión para una identidad sin
// confirmar**. Un test de integración no puede construir la premisa "token
// válido + email sin confirmar", así que se salteaba — y la rama central del
// hallazgo estuvo sin una sola aserción hasta que el `# skipped 1` de la salida
// del CI lo delató. Un test verde con skip es indistinguible de un test verde si
// nadie mira el conteo.
//
// La consecuencia de ese mismo dato, anotada donde corresponde: esta
// comprobación es defensa en profundidad. Lo que de verdad impide el escenario
// de ALTO-3 sigue siendo "Confirm email = ON" en el proyecto, porque con el
// toggle apagado GoTrue autoconfirma en el alta y el atacante llega con
// email_confirmed_at PUESTO. Lo que el arreglo sí cambia es que la confirmación
// se comprueba en vez de suponerse, y que el email sale de auth.users y no de un
// claim.

const CONFIRMADO = "2026-08-28T00:00:00.000Z";
const USER_ID = "11111111-1111-1111-1111-111111111111";

function identidad(overrides: Partial<IdentidadDeAuth> = {}): IdentidadDeAuth {
  return { email: "alguien@example.test", email_confirmed_at: CONFIRMADO, ...overrides };
}

function capturar(usuario: IdentidadDeAuth | null | undefined): AppError {
  try {
    resolverIdentidadDeInvitacion(USER_ID, usuario);
  } catch (err) {
    assert.ok(err instanceof AppError, `debe ser AppError, no un error crudo: ${String(err)}`);
    return err;
  }
  assert.fail("resolverIdentidadDeInvitacion debía lanzar");
}

test("una identidad confirmada resuelve, y el userId sale del `sub` del token", () => {
  const resultado = resolverIdentidadDeInvitacion(USER_ID, identidad());
  assert.deepEqual(resultado, { userId: USER_ID, email: "alguien@example.test" });
});

test("el email se normaliza a minúsculas y sin espacios — la comparación con Invitation.email es exacta", () => {
  const resultado = resolverIdentidadDeInvitacion(
    USER_ID,
    identidad({ email: "  Alguien@Example.TEST  " }),
  );
  assert.equal(resultado.email, "alguien@example.test");
});

// LA RAMA CENTRAL DE ALTO-3.
test("un email SIN CONFIRMAR es 401, con el mensaje que explica qué falta", () => {
  const err = capturar(identidad({ email_confirmed_at: null }));
  assert.equal(err.statusCode, 401);
  assert.equal(err.message, "Tenés que confirmar tu email antes de aceptar una invitación");
});

test("email_confirmed_at ausente (undefined) cuenta como sin confirmar — nunca se asume confirmado", () => {
  const err = capturar({ email: "alguien@example.test" });
  assert.equal(err.statusCode, 401);
  assert.equal(err.message, "Tenés que confirmar tu email antes de aceptar una invitación");
});

test("una cadena vacía en email_confirmed_at tampoco confirma", () => {
  const err = capturar(identidad({ email_confirmed_at: "" }));
  assert.equal(err.statusCode, 401);
});

test("una identidad sin email es 401, no un crash al normalizar", () => {
  const err = capturar(identidad({ email: undefined }));
  assert.equal(err.statusCode, 401);
  assert.equal(err.message, "El token no contiene un email válido");
});

test("un `sub` que la Admin API no resuelve es 401, nunca 500", () => {
  // Identidad borrada entre la emisión del token y el request, o un token de
  // otro proyecto. No es un fallo del servidor.
  for (const ausente of [null, undefined]) {
    const err = capturar(ausente);
    assert.equal(err.statusCode, 401);
    assert.equal(err.message, "No se pudo verificar la identidad del token");
  }
});

test("el orden de los chequeos: sin identidad gana sobre sin email, y sin email sobre sin confirmar", () => {
  // Importa porque los tres devuelven 401 con mensajes distintos, y el mensaje
  // es lo único que le dice a quien está del otro lado qué tiene que hacer.
  assert.equal(capturar(null).message, "No se pudo verificar la identidad del token");
  assert.equal(
    capturar({ email: undefined, email_confirmed_at: null }).message,
    "El token no contiene un email válido",
  );
  assert.equal(
    capturar(identidad({ email_confirmed_at: null })).message,
    "Tenés que confirmar tu email antes de aceptar una invitación",
  );
});
