import { randomUUID, generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";

// Genera la clave privada ES256 con la que firma el GoTrue del stack local
// (supabase/config.toml → [auth] signing_keys_path).
//
// Por qué existe, en vez de usar `supabase gen signing-key`:
//
//   1. Huevo y gallina. Con `signing_keys_path` declarado en config.toml, la
//      CLI valida ese archivo al arrancar CUALQUIER comando — incluido el que
//      lo generaría — y falla con LegacyGenSigningKeyReadError porque todavía
//      no existe.
//   2. Esa falla sale con **código de salida 0** y un JSON de error por
//      stdout, así que un `> signing_keys.json` la escribiría como si fuera
//      una clave y el fallo aparecería recién al levantar el stack.
//   3. La CLI emite un objeto suelto, pero el archivo tiene que ser un
//      **array** de JWKs ("failed to decode signing keys: Expected array").
//
// Por qué hace falta la clave: producción firma con ES256 y publica el JWKS;
// src/lib/jwt.ts verifica exactamente eso (`algorithms: ["ES256"]` contra
// SUPABASE_URL/auth/v1/.well-known/jwks.json). Sin clave asimétrica, el
// GoTrue local firmaría con el secreto HS256 heredado y todo request
// autenticado daría 401 por el entorno y no por su lógica.
//
// El formato replica el de `supabase gen signing-key --algorithm ES256`:
// JWK de curva P-256 con kid, use, key_ops, alg y ext.

const destino = process.argv[2] ?? "supabase/signing_keys.json";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = privateKey.export({ format: "jwk" }) as Record<string, unknown>;

if (jwk.crv !== "P-256" || typeof jwk.d !== "string") {
  throw new Error(
    `La clave generada no tiene la forma esperada (crv=${String(jwk.crv)}).`,
  );
}

const clave = {
  kty: jwk.kty,
  kid: randomUUID(),
  use: "sig",
  key_ops: ["sign", "verify"],
  alg: "ES256",
  ext: true,
  d: jwk.d,
  crv: jwk.crv,
  x: jwk.x,
  y: jwk.y,
};

writeFileSync(destino, `${JSON.stringify([clave])}\n`);

console.log(`Clave ES256 efímera escrita en ${destino} (kid ${clave.kid}).`);
