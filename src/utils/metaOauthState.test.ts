import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { SignJWT } from "jose";
import { AppError } from "./AppError";
import {
  consumirMetaState,
  firmarMetaState,
  leerOrganizacionSinVerificar,
  verificarMetaState,
} from "./metaOauthState";
import { firmarState } from "./oauthState";

// Unitarios, sin base, sin red y sin entorno: la clave entra por parámetro.
// Calco de oauthState.test.ts — cada caso es una forma concreta de intentar
// saltear la frontera de tenant del callback de Meta — más el que justifica
// que este módulo exista aparte: un state de Google no sirve acá.

const CLAVE = randomBytes(32);
const OTRA_CLAVE = randomBytes(32);

const STATE = { organizationId: randomUUID(), userId: randomUUID() };

function esState400(err: unknown): boolean {
  return err instanceof AppError && err.statusCode === 400;
}

test("un state recién firmado se verifica y devuelve la organización y el usuario que lo emitieron, con jti y vencimiento", async () => {
  const token = await firmarMetaState(STATE, CLAVE);
  const verificado = await verificarMetaState(token, CLAVE);
  assert.equal(verificado.organizationId, STATE.organizationId);
  assert.equal(verificado.userId, STATE.userId);
  assert.equal(typeof verificado.jti, "string");
  assert.ok(verificado.expiraEnMs > Date.now());
});

test("A-07: cada firma lleva un jti distinto", async () => {
  const a = await verificarMetaState(await firmarMetaState(STATE, CLAVE), CLAVE);
  const b = await verificarMetaState(await firmarMetaState(STATE, CLAVE), CLAVE);
  assert.notEqual(a.jti, b.jti);
});

test("A-07: un state sin userId o sin jti (firmado antes del cambio) se rechaza", async () => {
  for (const payload of [{ organizationId: STATE.organizationId }, { ...STATE }]) {
    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("plataforma-crm")
      .setAudience("meta-oauth")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(CLAVE);
    await assert.rejects(() => verificarMetaState(token, CLAVE), esState400);
  }
});

test("A-07: consumirMetaState deja pasar un jti una sola vez, y lo olvida recién después de su vencimiento", () => {
  const jti = randomUUID();
  const ahora = 1_000_000;
  const state = { jti, expiraEnMs: ahora + 600_000 };
  assert.equal(consumirMetaState(state, ahora), true);
  assert.equal(consumirMetaState(state, ahora + 1), false);
  assert.equal(consumirMetaState(state, ahora + 599_999), false);
  // Vencido, el state ya no pasa verificarMetaState: olvidarlo no reabre nada.
  assert.equal(consumirMetaState({ jti, expiraEnMs: ahora + 1_200_000 }, ahora + 600_000), true);
});

test("el payload lleva solo organizationId: Meta es por organización, sin branchId", async () => {
  const token = await firmarMetaState(STATE, CLAVE);
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  assert.equal(payload.organizationId, STATE.organizationId);
  assert.equal("branchId" in payload, false);
  assert.equal(payload.aud, "meta-oauth");
});

test("un state firmado con OTRA clave se rechaza", async () => {
  const ajeno = await firmarMetaState(
    { organizationId: randomUUID(), userId: randomUUID() },
    OTRA_CLAVE,
  );
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

// La lectura SIN verificar que usa el callback para elegir a qué organización
// vuelve la pantalla (02/10/2026). No autoriza nada: lo fija /complete.
test("leerOrganizacionSinVerificar: lee la organización de un state, aunque esté firmado con otra clave", async () => {
  assert.equal(
    leerOrganizacionSinVerificar(await firmarMetaState(STATE, CLAVE)),
    STATE.organizationId,
  );
  assert.equal(
    leerOrganizacionSinVerificar(await firmarMetaState(STATE, OTRA_CLAVE)),
    STATE.organizationId,
  );
});

test("leerOrganizacionSinVerificar: null si no es un JWT o la organización no es un uuid", async () => {
  assert.equal(leerOrganizacionSinVerificar("no-es-un-jwt"), null);
  assert.equal(leerOrganizacionSinVerificar(""), null);
  const raro = await firmarMetaState({ organizationId: "../../otra-cosa", userId: "u" }, CLAVE);
  assert.equal(leerOrganizacionSinVerificar(raro), null);
});
