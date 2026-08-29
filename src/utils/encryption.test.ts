import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { AppError } from "./AppError";
import { MASTER_KEY_BYTES, crearCifrador, deriveKey, parseMasterKey } from "./encryption";

// Unitarios, sin base, sin red y SIN VARIABLES DE ENTORNO: se prueba la factory
// (crearCifrador) con una clave propia, no el singleton que lee el entorno. Es
// exactamente para lo que existe la factory — ver el comentario de rateLimit.ts
// sobre el mismo patrón.

const CLAVE = randomBytes(MASTER_KEY_BYTES);
const OTRA_CLAVE = randomBytes(MASTER_KEY_BYTES);

// Un refresh token de Google tiene esta forma: prefijo, y una cadena larga con
// guiones y guiones bajos. Se usa uno realista para que el round-trip pase por
// los mismos caracteres que va a ver en producción.
const TOKEN = "1//0eXaMpLe-refresh_token.Con-Guiones_Y.Puntos-1234567890abcdefGHIJKL";

// ---------------------------------------------------------------------------
// El round-trip, que es la promesa central del módulo
// ---------------------------------------------------------------------------

test("lo que se cifra se recupera idéntico", () => {
  const cifrador = crearCifrador(CLAVE);

  assert.equal(cifrador.decrypt(cifrador.encrypt(TOKEN)), TOKEN);
});

test("el ciphertext no contiene el texto plano en ninguna parte", () => {
  // La aserción obvia y aun así la que importa: si alguien cambiara el módulo
  // por uno que "codifica" en vez de cifrar (base64 a secas, por ejemplo), el
  // round-trip de arriba seguiría pasando y esto no.
  const cifrado = crearCifrador(CLAVE).encrypt(TOKEN);

  assert.ok(!cifrado.includes(TOKEN));
  assert.ok(!Buffer.from(cifrado, "utf8").includes(Buffer.from(TOKEN, "utf8")));
});

test("sobrevive a UTF-8 multibyte y a cadenas vacías", () => {
  const cifrador = crearCifrador(CLAVE);

  // No es un caso hipotético: cualquier secreto futuro puede traer acentos o
  // emoji, y una implementación que asuma ASCII se rompe con un largo mal
  // calculado.
  for (const valor of ["", "ñandú-öäü-日本語-🔐", "a".repeat(10_000)]) {
    assert.equal(cifrador.decrypt(cifrador.encrypt(valor)), valor);
  }
});

// ---------------------------------------------------------------------------
// El IV — el único error verdaderamente fatal de este módulo
// ---------------------------------------------------------------------------

test("cifrar dos veces el MISMO texto da dos ciphertexts distintos", () => {
  // Repetir un IV con la misma clave rompe GCM por completo: no debilita el
  // ciphertext, expone la clave de autenticación. Si esta aserción falla, el IV
  // dejó de ser aleatorio por llamada y el módulo está roto de la peor forma
  // posible — silenciosamente, con todo lo demás pasando.
  const cifrador = crearCifrador(CLAVE);

  const a = cifrador.encrypt(TOKEN);
  const b = cifrador.encrypt(TOKEN);

  assert.notEqual(a, b);

  // Y el IV concreto (segundo campo) tiene que diferir, no solo la cadena.
  assert.notEqual(a.split(".")[1], b.split(".")[1]);

  // Los dos siguen descifrando al mismo valor: distinto no significa roto.
  assert.equal(cifrador.decrypt(a), TOKEN);
  assert.equal(cifrador.decrypt(b), TOKEN);
});

// ---------------------------------------------------------------------------
// Autenticación: GCM tiene que RECHAZAR, no devolver basura
// ---------------------------------------------------------------------------

test("un ciphertext manipulado no descifra — falla, no devuelve otro texto", () => {
  const cifrador = crearCifrador(CLAVE);
  const [version, iv, tag, ciphertext] = cifrador.encrypt(TOKEN).split(".");

  // Se da vuelta un bit del ciphertext. Con CBC y sin MAC esto habría devuelto
  // un texto distinto y plausible; con GCM tiene que lanzar. Es la razón entera
  // por la que se eligió GCM.
  const bytes = Buffer.from(ciphertext, "base64url");
  bytes[0] ^= 0x01;

  assert.throws(
    () => cifrador.decrypt([version, iv, tag, bytes.toString("base64url")].join(".")),
    (err: unknown) => err instanceof AppError && err.statusCode === 500,
  );
});

test("un authTag manipulado tampoco descifra", () => {
  const cifrador = crearCifrador(CLAVE);
  const [version, iv, tag, ciphertext] = cifrador.encrypt(TOKEN).split(".");

  const bytes = Buffer.from(tag, "base64url");
  bytes[0] ^= 0x01;

  assert.throws(() =>
    cifrador.decrypt([version, iv, bytes.toString("base64url"), ciphertext].join(".")),
  );
});

test("con OTRA clave no se descifra", () => {
  // El caso real: alguien rota SECRET_ENCRYPTION_KEY sin re-cifrar las filas.
  // Tiene que fallar ruidoso, no devolver un token corrupto que después Google
  // rechaza con un error que no menciona el cifrado.
  const cifrado = crearCifrador(CLAVE).encrypt(TOKEN);

  assert.throws(
    () => crearCifrador(OTRA_CLAVE).decrypt(cifrado),
    (err: unknown) =>
      err instanceof AppError && err.message.includes("SECRET_ENCRYPTION_KEY no es la clave"),
  );
});

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

test("el formato es v1.<iv>.<authTag>.<ciphertext>, todo base64url", () => {
  const cifrado = crearCifrador(CLAVE).encrypt(TOKEN);
  const partes = cifrado.split(".");

  assert.equal(partes.length, 4);
  assert.equal(partes[0], "v1");
  assert.equal(Buffer.from(partes[1], "base64url").length, 12, "IV de 12 bytes (nativo de GCM)");
  assert.equal(Buffer.from(partes[2], "base64url").length, 16, "authTag completo de 16 bytes");

  // base64url no produce "+", "/" ni "=", que es lo que permite usar "." como
  // separador sin escapar nada.
  assert.ok(/^[A-Za-z0-9._-]+$/.test(cifrado));
});

test("una cadena que no tiene el formato esperado no se descifra", () => {
  const cifrador = crearCifrador(CLAVE);

  for (const basura of ["", "no-es-nada", "v1.solo.tres", "v1.a.b.c.d"]) {
    assert.throws(
      () => cifrador.decrypt(basura),
      (err: unknown) => err instanceof AppError,
      `debería rechazar: ${JSON.stringify(basura)}`,
    );
  }
});

test("una versión de formato desconocida se distingue de un formato inválido", () => {
  // El día que exista un v2, una fila vieja tiene que dar un mensaje que diga
  // "versión desconocida" y no "corrupta" — son dos problemas con dos
  // respuestas distintas.
  const [, iv, tag, ciphertext] = crearCifrador(CLAVE).encrypt(TOKEN).split(".");

  assert.throws(
    () => crearCifrador(CLAVE).decrypt(["v99", iv, tag, ciphertext].join(".")),
    (err: unknown) => err instanceof AppError && err.message.includes("versión desconocida"),
  );
});

// ---------------------------------------------------------------------------
// Derivación de subclaves
// ---------------------------------------------------------------------------

test("dos `info` distintos derivan subclaves distintas de la misma maestra", () => {
  // Es todo el punto de HKDF acá: que la subclave que cifra y la que firma el
  // state de OAuth no sean la misma. Si esto fallara, las dos primitivas
  // estarían compartiendo material de clave.
  const a = deriveKey(CLAVE, "propósito-a");
  const b = deriveKey(CLAVE, "propósito-b");

  assert.equal(a.length, MASTER_KEY_BYTES);
  assert.notEqual(a.toString("hex"), b.toString("hex"));
});

test("la derivación es determinística: la misma maestra y el mismo info dan la misma subclave", () => {
  // Sin esto no habría round-trip posible entre dos arranques del proceso.
  assert.equal(
    deriveKey(CLAVE, "mismo-info").toString("hex"),
    deriveKey(CLAVE, "mismo-info").toString("hex"),
  );
});

// ---------------------------------------------------------------------------
// Validación de la clave maestra
// ---------------------------------------------------------------------------

test("parseMasterKey acepta 32 bytes en base64", () => {
  const clave = randomBytes(MASTER_KEY_BYTES);

  assert.equal(parseMasterKey(clave.toString("base64")).toString("hex"), clave.toString("hex"));
});

test("parseMasterKey rechaza una clave del largo equivocado, y dice cuál era", () => {
  // El modo de fallo probable: pegar 16 o 64 bytes. El mensaje tiene que decir
  // el largo real para no obligar a adivinar.
  assert.throws(
    () => parseMasterKey(randomBytes(16).toString("base64")),
    (err: unknown) => err instanceof AppError && err.message.includes("es de 16"),
  );
});

test("parseMasterKey rechaza una clave de solo ceros", () => {
  // Es lo que sale de un secreto vacío rellenado por un pipeline. Es
  // criptográficamente válida, así que ningún chequeo de largo la ve: este es el
  // único lugar donde se puede rechazar.
  assert.throws(
    () => parseMasterKey(Buffer.alloc(MASTER_KEY_BYTES).toString("base64")),
    (err: unknown) => err instanceof AppError && err.message.includes("solo ceros"),
  );
});

test("parseMasterKey rechaza una cadena vacía", () => {
  assert.throws(
    () => parseMasterKey(""),
    (err: unknown) => err instanceof AppError,
  );
});
