import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express from "express";
import type { JwtPayload } from "../types/auth";
import { AppError } from "../utils/AppError";
import { errorHandler } from "./errorHandler";
import { ACCEPT_IDENTITY_MAX, createAcceptInvitationRateLimiter } from "./rateLimit";
import { crearCadenaDeAceptacion, type IdentidadDeAuth } from "./verifyInvitationAcceptIdentity";

// V-8 (docs/auditoria-2026-08-29.md) — EL ORDEN de la cadena de aceptación,
// sin red ni base.
//
// Lo que se fija acá no es la decisión de cada etapa (eso lo cubre
// verifyInvitationAcceptIdentity.test.ts) ni el cableado real contra Supabase
// (verifyInvitationAcceptIdentity.integration-test.ts y
// rateLimit.integration-test.ts): es CUÁNDO corre cada etapa. Hasta V-8, el
// limiter por identidad corría después de la llamada a la Admin API, así que
// una identidad con el cupo agotado seguía provocando una llamada a Supabase
// por request — el 429 solo le ahorraba el handler. La propiedad a fijar es
// "N requests de una identidad con el cupo agotado son exactamente
// ACCEPT_IDENTITY_MAX llamadas a la Admin API, ni una más", y para contar
// llamadas hace falta un doble: crearCadenaDeAceptacion recibe la verificación
// de firma y la Admin API por parámetro justamente para esto. El limiter es el
// real (createAcceptInvitationRateLimiter, instancia nueva por app para que
// los tests no compartan cupo).
//
// La cadena que se monta es la MISMA función que monta invitation.routes.ts:
// si el orden cambia allá, cambia acá.

const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const TOKENS: Record<string, string> = {
  "token-de-A": USER_A,
  "token-de-B": USER_B,
};

// Firma "verificada" por tabla: un token conocido resuelve a su `sub`, cualquier
// otro es el 401 que verifySupabaseJwt daría.
async function verificarJwtDoble(token: string): Promise<JwtPayload> {
  const sub = TOKENS[token];
  if (!sub) {
    throw new AppError("Token inválido", 401);
  }
  return { sub, exp: 0 };
}

interface AppDePrueba {
  url: string;
  llamadasAdminApi: string[];
  identidadesQueLlegaronAlHandler: unknown[];
  close: () => Promise<void>;
}

function levantar(): Promise<AppDePrueba> {
  const llamadasAdminApi: string[] = [];
  const identidadesQueLlegaronAlHandler: unknown[] = [];

  const obtenerUsuario = async (userId: string) => {
    llamadasAdminApi.push(userId);
    const usuario: IdentidadDeAuth = {
      email: `  ${userId.slice(0, 8)}@Example.TEST `,
      email_confirmed_at: "2026-09-02T00:00:00.000Z",
    };
    return { data: { user: usuario }, error: null };
  };

  const app = express();
  app.use(express.json());
  app.post(
    "/api/invitations/accept",
    ...crearCadenaDeAceptacion({
      verificarJwt: verificarJwtDoble,
      obtenerUsuario,
      limiter: createAcceptInvitationRateLimiter(),
    }),
    (req, res) => {
      identidadesQueLlegaronAlHandler.push(req.invitationAcceptIdentity);
      res.status(200).json({ ok: true });
    },
  );
  app.use(errorHandler);

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        llamadasAdminApi,
        identidadesQueLlegaronAlHandler,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

const BODY_VALIDO = { fullName: "Ana Pérez", invitationId: "11111111-1111-1111-1111-111111111111" };

function pedir(url: string, token: string, body: unknown = BODY_VALIDO) {
  return fetch(`${url}/api/invitations/accept`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

let app: AppDePrueba;
before(async () => {
  app = await levantar();
});
after(async () => {
  await app.close();
});

// LA PROPIEDAD DE V-8. Antes del fix este test falla con
// llamadasAdminApi.length === ACCEPT_IDENTITY_MAX + 3: cada request, bloqueado
// o no, llegaba a la Admin API.
test("V-8: una identidad con el cupo agotado NO provoca llamadas nuevas a la Admin API — el 429 corta antes de Supabase", async () => {
  const antes = app.llamadasAdminApi.length;
  const statuses: number[] = [];
  for (let i = 0; i < ACCEPT_IDENTITY_MAX + 3; i++) {
    statuses.push((await pedir(app.url, "token-de-A")).status);
  }

  assert.deepEqual(
    statuses,
    [...Array(ACCEPT_IDENTITY_MAX).fill(200), 429, 429, 429],
    "los primeros ACCEPT_IDENTITY_MAX pasan, el resto es 429",
  );
  const llamadasDeA = app.llamadasAdminApi.slice(antes).filter((id) => id === USER_A);
  assert.equal(
    llamadasDeA.length,
    ACCEPT_IDENTITY_MAX,
    "exactamente una llamada a la Admin API por request DENTRO del cupo, ninguna por los bloqueados",
  );
});

test("V-8: un token inválido muere en la firma — sin llamada a la Admin API y sin tocar el cupo de nadie", async () => {
  const antes = app.llamadasAdminApi.length;
  const res = await pedir(app.url, "token-basura");
  assert.equal(res.status, 401);
  assert.equal(app.llamadasAdminApi.length, antes, "la firma inválida no llega a Supabase");
});

test("V-8: un body inválido muere en el 400 ANTES de la Admin API y sin consumir cupo — no se cuela por el skip del limiter", async () => {
  const antes = app.llamadasAdminApi.length;
  const res = await pedir(app.url, "token-de-B", { fullName: 42 });
  assert.equal(res.status, 400);
  assert.equal(
    app.llamadasAdminApi.length,
    antes,
    "un body roto no puede costar una llamada a Supabase",
  );

  // Y el cupo de B sigue entero: los ACCEPT_IDENTITY_MAX siguientes pasan.
  for (let i = 0; i < ACCEPT_IDENTITY_MAX; i++) {
    assert.equal((await pedir(app.url, "token-de-B")).status, 200, `intento válido ${i + 1} de B`);
  }
  assert.equal((await pedir(app.url, "token-de-B")).status, 429);
});

test("camino feliz: la identidad llega al handler con el email de la Admin API, normalizado — no del token", async () => {
  const ultima = app.identidadesQueLlegaronAlHandler.at(-1);
  assert.deepEqual(ultima, { userId: USER_B, email: "bbbbbbbb@example.test" });
});
