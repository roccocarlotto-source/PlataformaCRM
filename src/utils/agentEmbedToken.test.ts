import assert from "node:assert/strict";
import { test } from "node:test";
import { API_KEY_PREFIX, generateApiKey, hashApiKey } from "./apiKey";
import {
  EMBED_TOKEN_PREFIX,
  EMBED_TOKEN_PREFIX_LENGTH,
  EMBED_TOKEN_SECRET_BYTES,
  generateEmbedToken,
  hashEmbedToken,
} from "./agentEmbedToken";

// Mismo criterio que apiKey.test.ts: ninguno de estos tests prueba
// aleatoriedad. Detectan el error que importa —que alguien reemplace
// randomBytes por algo derivado— y que el prefijo de los tokens de embed siga
// siendo distinguible del de las API keys.

// 6 de prefijo ("embed_") + 43 de base64url sobre 32 bytes.
const EXPECTED_TOKEN_LENGTH = 6 + 43;

test("generateEmbedToken: el token tiene el largo exacto que implican 32 bytes de entropía", () => {
  const { token } = generateEmbedToken();
  assert.equal(token.length, EXPECTED_TOKEN_LENGTH);
  assert.equal(EMBED_TOKEN_SECRET_BYTES, 32, "el requisito son 256 bits de CSPRNG");
});

test("generateEmbedToken: dos llamadas consecutivas producen tokens distintos", () => {
  const a = generateEmbedToken();
  const b = generateEmbedToken();
  assert.notEqual(a.token, b.token);
  assert.notEqual(a.tokenHash, b.tokenHash);
  assert.notEqual(a.tokenPrefix, b.tokenPrefix);
});

test("generateEmbedToken: arranca con embed_, que NO es el prefijo de una API key", () => {
  const { token } = generateEmbedToken();
  assert.ok(token.startsWith(EMBED_TOKEN_PREFIX));
  assert.ok(!token.startsWith(API_KEY_PREFIX), "un token de embed no puede parecer una API key");
  assert.ok(
    !generateApiKey().key.startsWith(EMBED_TOKEN_PREFIX),
    "ni una API key parecer un token de embed",
  );
});

test("generateEmbedToken: tokenPrefix son los primeros 14 caracteres y entra en VarChar(16)", () => {
  const { token, tokenPrefix } = generateEmbedToken();
  assert.equal(tokenPrefix, token.slice(0, EMBED_TOKEN_PREFIX_LENGTH));
  assert.equal(tokenPrefix.length, 14);
  assert.ok(tokenPrefix.length <= 16, "token_prefix es VarChar(16) en la base");
});

test("generateEmbedToken: tokenHash es el SHA-256 hex del token COMPLETO, prefijo incluido", () => {
  const { token, tokenHash } = generateEmbedToken();
  assert.equal(tokenHash, hashEmbedToken(token));
  assert.match(tokenHash, /^[0-9a-f]{64}$/);
  // El mismo primitivo que las API keys: SHA-256 sin sal, por el mismo motivo.
  assert.equal(tokenHash, hashApiKey(token));
});

test("hashEmbedToken: determinístico y sin normalización", () => {
  const { token } = generateEmbedToken();
  assert.equal(hashEmbedToken(token), hashEmbedToken(token));
  assert.notEqual(hashEmbedToken(token), hashEmbedToken(` ${token}`));
  assert.notEqual(hashEmbedToken(token), hashEmbedToken(token.toUpperCase()));
});

test("generateEmbedToken: el token en claro no se puede derivar de lo que se persiste", () => {
  const { token, tokenHash, tokenPrefix } = generateEmbedToken();
  assert.ok(!tokenHash.includes(token));
  assert.ok(
    token.startsWith(tokenPrefix),
    "tokenPrefix expone 8 caracteres del secreto a propósito",
  );
});
