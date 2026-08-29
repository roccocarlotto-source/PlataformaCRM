import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { SignJWT } from "jose";
import { AppError } from "./AppError";
import { firmarState, verificarState } from "./oauthState";

// Unitarios, sin base, sin red y sin variables de entorno: firmarState y
// verificarState aceptan la clave por parámetro justamente para esto.
//
// LO QUE SE PRUEBA ACÁ ES LA FRONTERA DE TENANT DEL CALLBACK. El callback de
// Google corre sin authenticate —Google no reenvía el JWT— así que el `state`
// firmado es LA ÚNICA prueba de qué sucursal inició la conexión. Cada caso de
// abajo es una forma concreta de intentar saltearla.

const CLAVE = randomBytes(32);
const OTRA_CLAVE = randomBytes(32);

const STATE = { organizationId: randomUUID(), branchId: randomUUID() };

test("un state recién firmado se verifica y devuelve la sucursal que lo emitió", () => {
  return firmarState(STATE, CLAVE)
    .then((token) => verificarState(token, CLAVE))
    .then((verificado) => assert.deepEqual(verificado, STATE));
});

test("un state firmado con OTRA clave se rechaza", async () => {
  // El ataque directo: alguien arma su propio state con los ids que quiere. Sin
  // la clave, no puede producir una firma que verifique.
  const ajeno = await firmarState(
    { organizationId: randomUUID(), branchId: randomUUID() },
    OTRA_CLAVE,
  );

  await assert.rejects(
    () => verificarState(ajeno, CLAVE),
    (err: unknown) => err instanceof AppError && err.statusCode === 400,
  );
});

test("un state manipulado se rechaza", async () => {
  // Un JWT es tres partes en base64url separadas por puntos, y el payload se lee
  // en claro: quien tenga un state válido puede LEER su branchId sin problema.
  // Lo que no puede es cambiarlo — esto verifica exactamente eso.
  const token = await firmarState(STATE, CLAVE);
  const [header, payload, firma] = token.split(".");

  const alterado = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  alterado.branchId = randomUUID();

  const payloadFalso = Buffer.from(JSON.stringify(alterado), "utf8").toString("base64url");

  await assert.rejects(
    () => verificarState([header, payloadFalso, firma].join("."), CLAVE),
    (err: unknown) => err instanceof AppError && err.statusCode === 400,
  );
});

test("un state VENCIDO se rechaza, y con un mensaje distinto del inválido", async () => {
  // Se firma a mano con exp en el pasado: es el único camino para producir un
  // token vencido sin esperar diez minutos ni tocar el reloj del proceso.
  const vencido = await new SignJWT({ ...STATE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("plataforma-crm")
    .setAudience("google-calendar-oauth")
    .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .sign(CLAVE);

  await assert.rejects(
    () => verificarState(vencido, CLAVE),
    (err: unknown) =>
      err instanceof AppError &&
      err.statusCode === 400 &&
      // El vencimiento es el único fallo que le puede pasar a un usuario
      // legítimo (dejó la pestaña abierta), y su respuesta es accionable:
      // volver a empezar. Por eso tiene mensaje propio.
      err.message.includes("expiró"),
  );
});

test("un token con la firma correcta pero OTRA audiencia se rechaza", async () => {
  // La subclave de firma es una sola. Sin validar `aud`, cualquier token futuro
  // firmado con ella serviría como state — este test es lo que mantiene ese
  // acoplamiento cerrado.
  const otraAudiencia = await new SignJWT({ ...STATE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("plataforma-crm")
    .setAudience("otro-proposito")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(CLAVE);

  await assert.rejects(
    () => verificarState(otraAudiencia, CLAVE),
    (err: unknown) => err instanceof AppError && err.statusCode === 400,
  );
});

test("un token con OTRO emisor se rechaza", async () => {
  const otroEmisor = await new SignJWT({ ...STATE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("otro-sistema")
    .setAudience("google-calendar-oauth")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(CLAVE);

  await assert.rejects(() => verificarState(otroEmisor, CLAVE));
});

test("un token con alg: none se rechaza", async () => {
  // El ataque clásico de confusión de algoritmo: el atacante arma un JWT que
  // declara no estar firmado. Se defiende con la lista explícita de
  // `algorithms` en jwtVerify, y esto es lo que verifica que esa lista está.
  const sinFirma =
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }), "utf8").toString("base64url") +
    "." +
    Buffer.from(
      JSON.stringify({ ...STATE, iss: "plataforma-crm", aud: "google-calendar-oauth" }),
      "utf8",
    ).toString("base64url") +
    ".";

  await assert.rejects(
    () => verificarState(sinFirma, CLAVE),
    (err: unknown) => err instanceof AppError && err.statusCode === 400,
  );
});

test("un token bien firmado pero con claims de la forma equivocada se rechaza", async () => {
  // La firma prueba que salió de acá, no que el contenido sirva. Sin este
  // chequeo, un branchId numérico llegaría como tal a una consulta de Prisma.
  const claimsRaros = await new SignJWT({ organizationId: 42, branchId: null })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("plataforma-crm")
    .setAudience("google-calendar-oauth")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(CLAVE);

  await assert.rejects(
    () => verificarState(claimsRaros, CLAVE),
    (err: unknown) => err instanceof AppError && err.statusCode === 400,
  );
});

test("basura que ni siquiera es un JWT se rechaza sin explotar", async () => {
  for (const basura of ["", "no-es-un-jwt", "a.b.c"]) {
    await assert.rejects(
      () => verificarState(basura, CLAVE),
      (err: unknown) => err instanceof AppError && err.statusCode === 400,
      `debería rechazar: ${JSON.stringify(basura)}`,
    );
  }
});
