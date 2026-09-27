import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { SignJWT } from "jose";
import { AppError } from "./AppError";
import { firmarMetaState, verificarMetaState } from "./metaOauthState";
import { firmarState } from "./oauthState";

// Unitarios, sin base, sin red y sin entorno: la clave entra por parámetro.
// Calco de oauthState.test.ts — cada caso es una forma concreta de intentar
// saltear la frontera de tenant del callback de Meta — más el que justifica
// que este módulo exista aparte: un state de Google no sirve acá.

const CLAVE = randomBytes(32);
const OTRA_CLAVE = randomBytes(32);

const STATE = { organizationId: randomUUID() };

function esState400(err: unknown): boolean {
  return err instanceof AppError && err.statusCode === 400;
}

test("un state recién firmado se verifica y devuelve la organización que lo emitió", async () => {
  const token = await firmarMetaState(STATE, CLAVE);
  assert.deepEqual(await verificarMetaState(token, CLAVE), STATE);
});

test("el payload lleva solo organizationId: Meta es por organización, sin branchId", async () => {
  const token = await firmarMetaState(STATE, CLAVE);
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  assert.equal(payload.organizationId, STATE.organizationId);
  assert.equal("branchId" in payload, false);
  assert.equal(payload.aud, "meta-oauth");
});

test("un state firmado con OTRA clave se rechaza", async () => {
  const ajeno = await firmarMetaState({ organizationId: randomUUID() }, OTRA_CLAVE);
  await assert.rejects(() => verificarMetaState(ajeno, CLAVE), esState400);
});

test("un state manipulado se rechaza", async () => {
  const token = await firmarMetaState(STATE, CLAVE);
  const [header, payload, firma] = token.split(".");
  const alterado = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  alterado.organizationId = randomUUID();
  const payloadFalso = Buffer.from(JSON.stringify(alterado), "utf8").toString("base64url");

  await assert.rejects(
    () => verificarMetaState([header, payloadFalso, firma].join("."), CLAVE),
    esState400,
  );
});

test("un state de GOOGLE CALENDAR no sirve para el callback de Meta, aunque se firme con la misma clave", async () => {
  // La audiencia es lo que separa los dos flujos. Se fuerza el peor caso —la
  // misma clave de firma— para probar que el aud alcanza por sí solo.
  const deGoogle = await firmarState(
    { organizationId: STATE.organizationId, branchId: randomUUID() },
    CLAVE,
  );
  await assert.rejects(() => verificarMetaState(deGoogle, CLAVE), esState400);
});

test("un state VENCIDO se rechaza, con un mensaje propio y accionable", async () => {
  const vencido = await new SignJWT({ ...STATE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("plataforma-crm")
    .setAudience("meta-oauth")
    .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .sign(CLAVE);

  await assert.rejects(
    () => verificarMetaState(vencido, CLAVE),
    (err: unknown) => esState400(err) && (err as AppError).message.includes("expiró"),
  );
});

test("un state firmado sin organizationId se rechaza aunque la firma sea válida", async () => {
  const sinOrg = await new SignJWT({ otraCosa: "x" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("plataforma-crm")
    .setAudience("meta-oauth")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(CLAVE);

  await assert.rejects(() => verificarMetaState(sinOrg, CLAVE), esState400);
});

test("un token que no es un JWT se rechaza con 400, no con un error crudo", async () => {
  await assert.rejects(() => verificarMetaState("no-es-un-jwt", CLAVE), esState400);
});
