import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { SignJWT } from "jose";
import { AppError } from "./AppError";
import { firmarState } from "./oauthState";
import { firmarWebhookToken, verificarWebhookToken } from "./webhookToken";

// Unitarios, sin base, sin red y sin variables de entorno: las dos funciones
// aceptan la clave por parámetro justamente para esto.
//
// LO QUE SE PRUEBA ACÁ ES LA ÚNICA DEFENSA DEL WEBHOOK. Ese endpoint corre sin
// authenticate —Google no reenvía ningún JWT— así que este token firmado es lo
// único que separa una notificación legítima de un POST de cualquiera en
// internet. Cada caso de abajo es una forma concreta de intentar saltearlo.

const CLAVE = randomBytes(32);
const OTRA_CLAVE = randomBytes(32);

const DATOS = {
  organizationId: randomUUID(),
  branchId: randomUUID(),
  channelId: randomUUID(),
};

test("un token recién firmado se verifica y devuelve los tres campos", async () => {
  const token = await firmarWebhookToken(DATOS, CLAVE);

  assert.deepEqual(await verificarWebhookToken(token, CLAVE), DATOS);
});

test("un token firmado con OTRA clave se rechaza con 403", async () => {
  // El ataque directo: alguien arma su propio token con los ids que quiere. Sin
  // la clave no puede producir una firma que verifique.
  const ajeno = await firmarWebhookToken(DATOS, OTRA_CLAVE);

  await assert.rejects(
    () => verificarWebhookToken(ajeno, CLAVE),
    (err: unknown) => err instanceof AppError && err.statusCode === 403,
  );
});

test("un token manipulado se rechaza", async () => {
  // El payload de un JWT se lee en claro: quien tenga un token puede VER su
  // channelId. Lo que no puede es cambiarlo.
  const token = await firmarWebhookToken(DATOS, CLAVE);
  const [header, payload, firma] = token.split(".");

  const alterado = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  alterado.branchId = randomUUID();

  const payloadFalso = Buffer.from(JSON.stringify(alterado), "utf8").toString("base64url");

  await assert.rejects(
    () => verificarWebhookToken([header, payloadFalso, firma].join("."), CLAVE),
    (err: unknown) => err instanceof AppError && err.statusCode === 403,
  );
});

test("un token VENCIDO se rechaza", async () => {
  const vencido = await new SignJWT({ ...DATOS })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("plataforma-crm")
    .setAudience("google-calendar-webhook")
    .setIssuedAt(Math.floor(Date.now() / 1000) - 100000)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .sign(CLAVE);

  await assert.rejects(
    () => verificarWebhookToken(vencido, CLAVE),
    (err: unknown) => err instanceof AppError && err.statusCode === 403,
  );
});

test("un token con alg: none se rechaza", async () => {
  // El ataque clásico de confusión de algoritmo. Se defiende con la lista
  // explícita de `algorithms` en jwtVerify, y esto verifica que está.
  const sinFirma =
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }), "utf8").toString("base64url") +
    "." +
    Buffer.from(
      JSON.stringify({ ...DATOS, iss: "plataforma-crm", aud: "google-calendar-webhook" }),
      "utf8",
    ).toString("base64url") +
    ".";

  await assert.rejects(
    () => verificarWebhookToken(sinFirma, CLAVE),
    (err: unknown) => err instanceof AppError && err.statusCode === 403,
  );
});

test("un token con OTRA audiencia se rechaza", async () => {
  const otraAudiencia = await new SignJWT({ ...DATOS })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("plataforma-crm")
    .setAudience("otro-proposito")
    .setIssuedAt()
    .setExpirationTime("8d")
    .sign(CLAVE);

  await assert.rejects(() => verificarWebhookToken(otraAudiencia, CLAVE));
});

test("EL STATE DE OAUTH NO SIRVE COMO TOKEN DE WEBHOOK, ni con la misma clave maestra", async () => {
  // ES EL TEST QUE JUSTIFICA QUE HAYA DOS ARCHIVOS Y NO UNO. Las dos subclaves
  // salen de la misma SECRET_ENCRYPTION_KEY por HKDF con `info` distintos, y
  // además las audiencias difieren. Si esto pasara, un token de un flujo serviría
  // en el otro — que es exactamente la reutilización que la derivación por
  // propósito existe para impedir.
  //
  // Se firma el state con su camino real (el del entorno) y se verifica acá con
  // la clave de prueba: como las claves son distintas, falla. La aserción que
  // importa es que NUNCA verifica.
  const stateDeOauth = await firmarState(
    { organizationId: DATOS.organizationId, branchId: DATOS.branchId },
    CLAVE,
  );

  await assert.rejects(
    () => verificarWebhookToken(stateDeOauth, CLAVE),
    (err: unknown) => err instanceof AppError && err.statusCode === 403,
    "un state de OAuth firmado con la MISMA clave no puede pasar como token de webhook",
  );
});

test("un token bien firmado pero con claims de la forma equivocada se rechaza", async () => {
  // La firma prueba que salió de acá, no que el contenido sirva. Sin este
  // chequeo, un channelId numérico llegaría como tal a una consulta de Prisma.
  const claimsRaros = await new SignJWT({ organizationId: 42, branchId: null, channelId: [] })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("plataforma-crm")
    .setAudience("google-calendar-webhook")
    .setIssuedAt()
    .setExpirationTime("8d")
    .sign(CLAVE);

  await assert.rejects(
    () => verificarWebhookToken(claimsRaros, CLAVE),
    (err: unknown) => err instanceof AppError && err.statusCode === 403,
  );
});

test("falta el channelId en los claims y se rechaza", async () => {
  // El channelId es el que ata el token a UN canal. Un token sin él sería válido
  // para cualquier canal de esa sucursal.
  const sinCanal = await new SignJWT({
    organizationId: DATOS.organizationId,
    branchId: DATOS.branchId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("plataforma-crm")
    .setAudience("google-calendar-webhook")
    .setIssuedAt()
    .setExpirationTime("8d")
    .sign(CLAVE);

  await assert.rejects(
    () => verificarWebhookToken(sinCanal, CLAVE),
    (err: unknown) => err instanceof AppError && err.statusCode === 403,
  );
});

test("basura que ni siquiera es un JWT se rechaza sin explotar", async () => {
  for (const basura of ["", "no-es-un-jwt", "a.b.c"]) {
    await assert.rejects(
      () => verificarWebhookToken(basura, CLAVE),
      (err: unknown) => err instanceof AppError && err.statusCode === 403,
      `debería rechazar: ${JSON.stringify(basura)}`,
    );
  }
});

test("el TTL del token SOBREVIVE al canal de 7 días", async () => {
  // Un canal de Google dura 604800 s = 7 días exactos, y el token viaja en CADA
  // notificación de ese canal, incluida la última. Con un TTL igual o menor, las
  // notificaciones del último tramo llegarían con un token vencido — justo las
  // de un canal que nadie renovó todavía.
  const token = await firmarWebhookToken(DATOS, CLAVE);

  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  const duracionSegundos = payload.exp - payload.iat;

  assert.ok(
    duracionSegundos > 7 * 24 * 60 * 60,
    `el token dura ${duracionSegundos}s y el canal 604800s: tiene que durar MÁS`,
  );
});
