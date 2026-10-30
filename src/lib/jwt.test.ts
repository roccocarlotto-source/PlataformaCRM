import assert from "node:assert/strict";
import { mock, test } from "node:test";
import {
  SignJWT,
  errors as joseErrors,
  exportJWK,
  generateKeyPair,
  type JSONWebKeySet,
  type CryptoKey,
  type JWTVerifyGetKey,
} from "jose";
import { AppError } from "../utils/AppError";
import {
  conRespaldoDelJwksConocido,
  esErrorDelToken,
  RECARGA_TRAS_FALLO_MS,
  verifySupabaseJwtWith,
  type JwksRemoto,
} from "./jwt";
import { logger } from "./logger";

// A-3 — la clasificación de errores de verifySupabaseJwt, sin red y sin
// Supabase.
//
// POR QUÉ UNITARIO Y NO DE INTEGRACIÓN: la premisa que hay que probar es "el
// JWKS de Supabase no responde", y contra un stack real eso exige tumbarle el
// endpoint al GoTrue de CI en el medio de la suite. verifySupabaseJwtWith
// recibe el resolutor de claves por parámetro justamente para esto: acá se le
// pasa una clave local para los casos de token, y una función que falla como
// fallaría el JWKS remoto (verificado contra jose@6.2.3, remote.js) para los
// de infraestructura.
//
// LO QUE ESTÁ BAJO PRUEBA ES LA FRONTERA 401 / 503. Un 401 de más es el
// deslogueo masivo del hallazgo; un 503 de más es un atacante recibiendo una
// respuesta distinta. Cada test de abajo fija de qué lado cae cada clase.

const USER_ID = "11111111-1111-1111-1111-111111111111";

async function parDeClaves() {
  return generateKeyPair("ES256");
}

// `aud` por defecto "authenticated", como TODO token de sesión que emite
// Supabase Auth (claim obligatorio en @supabase/auth-js, RequiredClaims). Desde
// V-7 verifySupabaseJwtWith lo exige, así que el camino feliz tiene que
// firmarlo. `aud: null` firma un token SIN el claim, para probar ese rechazo.
async function firmar(
  privateKey: CryptoKey,
  opciones: {
    alg?: string;
    exp?: string;
    sub?: string;
    nbf?: string;
    aud?: string | string[] | null;
  } = {},
) {
  const jwt = new SignJWT({})
    .setProtectedHeader({ alg: opciones.alg ?? "ES256" })
    .setIssuedAt()
    .setExpirationTime(opciones.exp ?? "1h");
  if (opciones.aud !== null) {
    jwt.setAudience(opciones.aud ?? "authenticated");
  }
  if (opciones.sub !== undefined) {
    jwt.setSubject(opciones.sub);
  }
  if (opciones.nbf) {
    jwt.setNotBefore(opciones.nbf);
  }
  return jwt.sign(privateKey);
}

async function capturar(token: string, getKey: JWTVerifyGetKey): Promise<AppError> {
  try {
    await verifySupabaseJwtWith(token, getKey);
  } catch (err) {
    assert.ok(err instanceof AppError, `debe ser AppError, no un error crudo: ${String(err)}`);
    return err;
  }
  assert.fail("verifySupabaseJwtWith debía lanzar");
}

// Espía sobre logger.error, restaurado al final de cada test que lo usa: la
// exigencia del hallazgo no es solo el 503, es que el error original QUEDE
// EN EL LOG — antes se perdía por completo.
function espiarLoggerError() {
  const espia = mock.method(logger, "error", () => undefined);
  return {
    llamadas: () => espia.mock.calls.length,
    errLogueado: () => (espia.mock.calls[0]?.arguments[0] as { err?: unknown } | undefined)?.err,
    restaurar: () => espia.mock.restore(),
  };
}

// ---------------------------------------------------------------------------
// Camino feliz
// ---------------------------------------------------------------------------

test("un token ES256 válido devuelve el payload con el sub", async () => {
  const { privateKey, publicKey } = await parDeClaves();
  const token = await firmar(privateKey, { sub: USER_ID });

  const payload = await verifySupabaseJwtWith(token, async () => publicKey);
  assert.equal(payload.sub, USER_ID);
  assert.ok(payload.exp > 0);
});

// ---------------------------------------------------------------------------
// El token es inválido → 401, sin log de error
// ---------------------------------------------------------------------------

test("un token vencido es 401 con su mensaje propio, y no se loguea como error", async () => {
  const { privateKey, publicKey } = await parDeClaves();
  const token = await firmar(privateKey, { sub: USER_ID, exp: "-1h" });
  const espia = espiarLoggerError();
  try {
    const err = await capturar(token, async () => publicKey);
    assert.equal(err.statusCode, 401);
    assert.equal(err.message, "El token expiró");
    assert.equal(espia.llamadas(), 0, "un token vencido no es un error del servidor");
  } finally {
    espia.restaurar();
  }
});

test("un token firmado con OTRA clave es 401 (JWSSignatureVerificationFailed)", async () => {
  const { privateKey } = await parDeClaves();
  const { publicKey: otraPublica } = await parDeClaves();
  const token = await firmar(privateKey, { sub: USER_ID });

  const err = await capturar(token, async () => otraPublica);
  assert.equal(err.statusCode, 401);
  assert.equal(err.message, "Token inválido");
});

test("un token HS256 —la anon key legacy— es 401 (JOSEAlgNotAllowed), no 503", async () => {
  const secreto = new TextEncoder().encode("un-secreto-compartido-de-32-bytes!!");
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(USER_ID)
    .setExpirationTime("1h")
    .sign(secreto);
  const { publicKey } = await parDeClaves();

  const err = await capturar(token, async () => publicKey);
  assert.equal(err.statusCode, 401);
});

test("una cadena que no es un JWT es 401 (JWSInvalid), no 503", async () => {
  const { publicKey } = await parDeClaves();
  const err = await capturar("esto-no-es-un-jwt", async () => publicKey);
  assert.equal(err.statusCode, 401);
});

test("un token con nbf en el futuro es 401 (JWTClaimValidationFailed)", async () => {
  const { privateKey, publicKey } = await parDeClaves();
  const token = await firmar(privateKey, { sub: USER_ID, nbf: "1h" });
  const err = await capturar(token, async () => publicKey);
  assert.equal(err.statusCode, 401);
});

// V-7 — el claim `aud` se exige y se compara. Ambos casos son
// JWTClaimValidationFailed (verificado en jose@6.2.3, lib/jwt_claims_set.js:
// 'missing required "aud" claim' y 'unexpected "aud" claim value'), o sea la
// clase que ya estaba en ERRORES_DEL_TOKEN: 401 "Token inválido", sin log.
// Antes de V-7 los dos tokens de abajo PASABAN la verificación.
test('un token con `aud` distinto de "authenticated" es 401 (JWTClaimValidationFailed), no 503', async () => {
  const { privateKey, publicKey } = await parDeClaves();
  const token = await firmar(privateKey, { sub: USER_ID, aud: "otro-proposito" });
  const espia = espiarLoggerError();
  try {
    const err = await capturar(token, async () => publicKey);
    assert.equal(err.statusCode, 401);
    assert.equal(err.message, "Token inválido");
    assert.equal(espia.llamadas(), 0, "un aud ajeno es culpa del token, no del servidor");
  } finally {
    espia.restaurar();
  }
});

test("un token SIN `aud` es 401 (JWTClaimValidationFailed): Supabase siempre lo emite, su ausencia no es un token de sesión", async () => {
  const { privateKey, publicKey } = await parDeClaves();
  const token = await firmar(privateKey, { sub: USER_ID, aud: null });
  const err = await capturar(token, async () => publicKey);
  assert.equal(err.statusCode, 401);
  assert.equal(err.message, "Token inválido");
});

test('un `aud` en forma de array que incluye "authenticated" pasa (semántica de jose; RequiredClaims lo tipa string | string[])', async () => {
  const { privateKey, publicKey } = await parDeClaves();
  const token = await firmar(privateKey, { sub: USER_ID, aud: ["otro", "authenticated"] });
  const payload = await verifySupabaseJwtWith(token, async () => publicKey);
  assert.equal(payload.sub, USER_ID);
});

test("un token válido pero sin `sub` es 401", async () => {
  const { privateKey, publicKey } = await parDeClaves();
  const token = await firmar(privateKey);
  const err = await capturar(token, async () => publicKey);
  assert.equal(err.statusCode, 401);
  assert.equal(err.message, "Token inválido: falta el identificador del usuario");
});

// ---------------------------------------------------------------------------
// No se pudo verificar → 503, con el error original en el log
// ---------------------------------------------------------------------------

// Cada caso simula EXACTAMENTE lo que jose@6.2.3 lanza en esa situación,
// verificado en dist/webapi/jwks/remote.js: fetchJwks convierte solo el
// TimeoutError en JWKSTimeout, relanza crudo cualquier otro fallo del fetch,
// y envuelve el non-200 y el JSON inválido en un JOSEError genérico.
const FALLOS_DE_INFRAESTRUCTURA: { nombre: string; error: () => Error }[] = [
  {
    nombre: "JWKSTimeout — el endpoint JWKS no respondió dentro del timeout",
    error: () => new joseErrors.JWKSTimeout(),
  },
  {
    nombre: "TypeError 'fetch failed' — red caída, DNS, conexión rechazada (jose lo relanza crudo)",
    error: () => new TypeError("fetch failed"),
  },
  {
    nombre: "JOSEError genérico — el JWKS respondió algo que no es 200",
    error: () =>
      new joseErrors.JOSEError("Expected 200 OK from the JSON Web Key Set HTTP response"),
  },
  {
    nombre: "JWKSNoMatchingKey — kid desconocido después de la recarga (rotación en curso)",
    error: () => new joseErrors.JWKSNoMatchingKey(),
  },
  {
    nombre: "JWKSInvalid — el JWKS publicado está roto",
    error: () => new joseErrors.JWKSInvalid(),
  },
];

for (const caso of FALLOS_DE_INFRAESTRUCTURA) {
  test(`${caso.nombre} → 503 y el error original queda en el log`, async () => {
    const { privateKey } = await parDeClaves();
    const token = await firmar(privateKey, { sub: USER_ID });
    const original = caso.error();
    const espia = espiarLoggerError();
    try {
      const err = await capturar(token, async () => {
        throw original;
      });

      assert.equal(err.statusCode, 503, "antes esto era un 401 que deslogueaba a todo el mundo");
      assert.notEqual(err.message, "Token inválido");
      assert.equal(espia.llamadas(), 1, "el fallo de infraestructura tiene que quedar logueado");
      assert.equal(
        espia.errLogueado(),
        original,
        "lo que va al log es el error ORIGINAL, no el AppError de reemplazo",
      );
    } finally {
      espia.restaurar();
    }
  });
}

test("un AppError que venga del resolutor (por ejemplo SUPABASE_URL ausente) sale tal cual, no como 401 ni 503", async () => {
  // Es lo que garantiza que getJwks() pueda fallar con su propio 500 de
  // configuración aunque alguien lo vuelva a meter adentro del try.
  const { privateKey } = await parDeClaves();
  const token = await firmar(privateKey, { sub: USER_ID });
  const espia = espiarLoggerError();
  try {
    const err = await capturar(token, async () => {
      throw new AppError("SUPABASE_URL no está configurado en el servidor", 500);
    });
    assert.equal(err.statusCode, 503);
    assert.equal(espia.llamadas(), 1);
  } finally {
    espia.restaurar();
  }
});

// ---------------------------------------------------------------------------
// La tabla de clasificación, fijada
// ---------------------------------------------------------------------------

test("esErrorDelToken: las clases de 'token inválido' son exactamente esas, y las de JWKS no están", () => {
  const delToken = [
    new joseErrors.JWTClaimValidationFailed("x", {}),
    new joseErrors.JWTInvalid("x"),
    new joseErrors.JWSInvalid("x"),
    new joseErrors.JWSSignatureVerificationFailed(),
    new joseErrors.JOSEAlgNotAllowed("x"),
    new joseErrors.JOSENotSupported("x"),
  ];
  for (const err of delToken) {
    assert.equal(esErrorDelToken(err), true, err.constructor.name);
  }

  const deInfraestructura = [
    new joseErrors.JWKSTimeout(),
    new joseErrors.JWKSNoMatchingKey(),
    new joseErrors.JWKSInvalid(),
    new joseErrors.JWKSMultipleMatchingKeys(),
    new joseErrors.JOSEError("genérico"),
    new TypeError("fetch failed"),
    new Error("cualquier cosa"),
  ];
  for (const err of deInfraestructura) {
    assert.equal(esErrorDelToken(err), false, err.constructor.name);
  }
});

// ---------------------------------------------------------------------------
// OPS-04: Supabase Auth caído → se verifica con el JWKS que ya funcionó
// ---------------------------------------------------------------------------

// Un JWKS remoto de mentira: responde con la clave mientras `caido` es false,
// y falla como fallaría el fetch de jose cuando es true.
async function jwksRemotoDePrueba() {
  const { privateKey, publicKey } = await parDeClaves();
  const jwk = { ...(await exportJWK(publicKey)), alg: "ES256" };
  const estado = { caido: false, llamadas: 0, error: new TypeError("fetch failed") as Error };
  let bajado: JSONWebKeySet | undefined;
  const remoto = Object.assign(
    async () => {
      estado.llamadas++;
      if (estado.caido) throw estado.error;
      bajado ??= { keys: [jwk] };
      return publicKey;
    },
    { jwks: () => bajado },
  ) as JwksRemoto;
  return { privateKey, remoto, estado };
}

function espiarLoggerWarn() {
  const espia = mock.method(logger, "warn", () => undefined);
  return { llamadas: () => espia.mock.calls.length, restaurar: () => espia.mock.restore() };
}

test("OPS-04: con el JWKS caído, un token válido se verifica con las claves que ya se conocían (un solo warn)", async () => {
  const { privateKey, remoto, estado } = await jwksRemotoDePrueba();
  let ahora = 0;
  const getKey = conRespaldoDelJwksConocido(remoto, () => ahora);
  const token = await firmar(privateKey, { sub: USER_ID });
  await verifySupabaseJwtWith(token, getKey);

  estado.caido = true;
  const warn = espiarLoggerWarn();
  try {
    for (let i = 0; i < 3; i++) {
      const payload = await verifySupabaseJwtWith(token, getKey);
      assert.equal(payload.sub, USER_ID);
      ahora += 1_000;
    }
    assert.equal(warn.llamadas(), 1, "una línea por caída, no una por request");
    assert.equal(estado.llamadas, 2, "durante la espera no se vuelve a pedir el JWKS");

    // Pasada la espera, se vuelve a probar el remoto; si respondió, sigue por ahí.
    ahora += RECARGA_TRAS_FALLO_MS;
    estado.caido = false;
    await verifySupabaseJwtWith(token, getKey);
    assert.equal(estado.llamadas, 3);
  } finally {
    warn.restaurar();
  }
});

test("OPS-04: con el JWKS caído, un token firmado con OTRA clave sigue siendo 401", async () => {
  const { privateKey, remoto, estado } = await jwksRemotoDePrueba();
  const getKey = conRespaldoDelJwksConocido(remoto);
  await verifySupabaseJwtWith(await firmar(privateKey, { sub: USER_ID }), getKey);

  estado.caido = true;
  const warn = espiarLoggerWarn();
  try {
    const otra = await parDeClaves();
    const err = await capturar(await firmar(otra.privateKey, { sub: USER_ID }), getKey);
    assert.equal(err.statusCode, 401);
  } finally {
    warn.restaurar();
  }
});

test("OPS-04: sin ningún JWKS conocido (primer arranque con Auth caído) sigue siendo 503", async () => {
  const { privateKey, remoto, estado } = await jwksRemotoDePrueba();
  estado.caido = true;
  const espia = espiarLoggerError();
  try {
    const err = await capturar(
      await firmar(privateKey, { sub: USER_ID }),
      conRespaldoDelJwksConocido(remoto),
    );
    assert.equal(err.statusCode, 503);
  } finally {
    espia.restaurar();
  }
});

test("OPS-04: un kid que el JWKS remoto no tiene (JWKSNoMatchingKey) no usa el respaldo: 503 como antes", async () => {
  const { privateKey, remoto, estado } = await jwksRemotoDePrueba();
  const getKey = conRespaldoDelJwksConocido(remoto);
  const token = await firmar(privateKey, { sub: USER_ID });
  await verifySupabaseJwtWith(token, getKey);

  estado.caido = true;
  estado.error = new joseErrors.JWKSNoMatchingKey();
  const espia = espiarLoggerError();
  try {
    const err = await capturar(token, getKey);
    assert.equal(err.statusCode, 503);
  } finally {
    espia.restaurar();
  }
});
