import assert from "node:assert/strict";
import { test } from "node:test";
import {
  API_KEY_PREFIX,
  API_KEY_PREFIX_LENGTH,
  API_KEY_SECRET_BYTES,
  generateApiKey,
  hashApiKey,
} from "./apiKey";

// Ninguno de estos tests prueba aleatoriedad — ningún test la prueba, y
// pretender lo contrario sería peor que no tenerlos. Lo que sí detectan es el
// error que importa: que alguien reemplace randomBytes por algo derivado
// (un UUID, un timestamp, el nombre de la organización) y el largo o la
// unicidad se rompan de forma visible.

// 4 caracteres de prefijo + 43 de base64url sobre 32 bytes (256 bits / 6 bits
// por caracter = 42.67, redondeado hacia arriba, sin padding). La cuenta va
// escrita para que el número no sea mágico: si cambia API_KEY_SECRET_BYTES,
// este test tiene que fallar y obligar a revisar la decisión de entropía, no
// a ajustar el número hasta que pase.
const EXPECTED_KEY_LENGTH = 4 + 43;

test("generateApiKey: la clave tiene el largo exacto que implican 32 bytes de entropía", () => {
  const { key } = generateApiKey();

  assert.equal(
    key.length,
    EXPECTED_KEY_LENGTH,
    `la clave debe medir ${EXPECTED_KEY_LENGTH} caracteres — si no, la fuente de entropía cambió`,
  );
  assert.equal(API_KEY_SECRET_BYTES, 32, "el requisito son 256 bits de CSPRNG");
});

test("generateApiKey: dos llamadas consecutivas producen claves distintas", () => {
  const primera = generateApiKey();
  const segunda = generateApiKey();

  assert.notEqual(
    primera.key,
    segunda.key,
    "dos claves iguales significan que la generación dejó de ser aleatoria",
  );
  assert.notEqual(primera.keyHash, segunda.keyHash);
  assert.notEqual(
    primera.keyPrefix,
    segunda.keyPrefix,
    "el prefijo incluye 8 caracteres del secreto, así que también debe variar",
  );
});

test("generateApiKey: la clave arranca con el prefijo identificable", () => {
  const { key } = generateApiKey();

  assert.ok(
    key.startsWith(API_KEY_PREFIX),
    `la clave debe arrancar con "${API_KEY_PREFIX}" para ser identificable a simple vista`,
  );
});

test("generateApiKey: keyPrefix son los primeros caracteres de la clave y entra en VarChar(16)", () => {
  const { key, keyPrefix } = generateApiKey();

  assert.equal(keyPrefix, key.slice(0, API_KEY_PREFIX_LENGTH));
  assert.equal(keyPrefix.length, API_KEY_PREFIX_LENGTH);
  assert.ok(
    keyPrefix.length <= 16,
    "key_prefix es VarChar(16) en la base — un prefijo más largo rompe el INSERT",
  );
});

test("generateApiKey: keyHash es el SHA-256 hex de la clave COMPLETA, prefijo incluido", () => {
  const { key, keyHash } = generateApiKey();

  assert.equal(keyHash, hashApiKey(key));
  assert.equal(keyHash.length, 64, "SHA-256 en hex son 64 caracteres");
  assert.match(keyHash, /^[0-9a-f]{64}$/);
});

test("generateApiKey: la clave en claro no se puede derivar de lo que se persiste", () => {
  const { key, keyHash, keyPrefix } = generateApiKey();

  // Comprobación de la promesa central: lo único que llega a la base es
  // keyHash + keyPrefix, y ninguno de los dos contiene la clave.
  assert.ok(!keyHash.includes(key));
  assert.ok(!key.startsWith(keyHash), "el hash no puede ser un prefijo de la clave");
  assert.ok(
    key.startsWith(keyPrefix),
    "keyPrefix sí es parte de la clave, y expone 8 de sus caracteres a propósito",
  );
});

test("hashApiKey: es determinístico — la misma clave siempre da el mismo hash", () => {
  const { key } = generateApiKey();

  assert.equal(hashApiKey(key), hashApiKey(key));
});

// El ítem 4 tiene que hashear los BYTES EXACTOS que llegan en el header. Estos
// tres casos son la razón: si alguien agrega un .trim() o un .toLowerCase()
// "por robustez", dos cadenas distintas pasarían a resolver a la misma fila,
// que es exactamente lo contrario de lo que el hash está haciendo.
test("hashApiKey: no normaliza — espacios y capitalización producen hashes distintos", () => {
  const { key } = generateApiKey();

  assert.notEqual(hashApiKey(key), hashApiKey(` ${key}`));
  assert.notEqual(hashApiKey(key), hashApiKey(`${key} `));
  assert.notEqual(hashApiKey(key), hashApiKey(key.toUpperCase()));
});
