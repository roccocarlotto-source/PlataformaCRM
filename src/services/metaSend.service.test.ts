import assert from "node:assert/strict";
import { test } from "node:test";
import type { FetchLike } from "./metaOAuth.service";
import {
  META_SEND_URL,
  MetaSendError,
  crearSendMetaText,
  cuerpoDeRespuesta,
} from "./metaSend.service";

// ---------------------------------------------------------------------------
// metaSend.service.ts (ítem 172), SIN RED: fetch se inyecta en la factory. Se
// afirma lo que Meta recibe —URL, headers, cuerpo exacto— y cómo se clasifica
// un rechazo, que es lo que el worker usa para decidir si reintenta.
// ---------------------------------------------------------------------------

interface Llamada {
  url: string;
  init: RequestInit;
}

function fetchQueResponde(respuesta: Response | Error): { fetch: FetchLike; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  return {
    llamadas,
    fetch: (url, init) => {
      llamadas.push({ url, init });
      return respuesta instanceof Error ? Promise.reject(respuesta) : Promise.resolve(respuesta);
    },
  };
}

function errorDeMeta(status: number, code: number, subcode?: number): Response {
  return new Response(
    JSON.stringify({
      error: {
        message: "algo",
        type: "OAuthException",
        code,
        ...(subcode !== undefined ? { error_subcode: subcode } : {}),
        fbtrace_id: "abc",
      },
    }),
    { status },
  );
}

const ENTRADA = { pageAccessToken: "token-de-pagina", recipientId: "psid-123", text: "¡Hola!" };

async function rechazo(respuesta: Response): Promise<MetaSendError> {
  const { fetch } = fetchQueResponde(respuesta);
  try {
    await crearSendMetaText(fetch)(ENTRADA);
  } catch (err) {
    assert.ok(err instanceof MetaSendError);
    return err;
  }
  throw new Error("se esperaba un rechazo");
}

test("éxito: POST a /v25.0/me/messages con el token en Bearer y el cuerpo RESPONSE, sin etiqueta", async () => {
  const { fetch, llamadas } = fetchQueResponde(
    new Response(JSON.stringify({ recipient_id: "psid-123", message_id: "m_1" }), { status: 200 }),
  );
  await crearSendMetaText(fetch)(ENTRADA);

  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].url, "https://graph.facebook.com/v25.0/me/messages");
  assert.equal(llamadas[0].url, META_SEND_URL);
  assert.equal(llamadas[0].init.method, "POST");
  const headers = llamadas[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer token-de-pagina");
  assert.equal(headers["Content-Type"], "application/json");
  assert.ok(!llamadas[0].url.includes("token-de-pagina"), "el token no va en la URL");
  const cuerpo = JSON.parse(llamadas[0].init.body as string) as Record<string, unknown>;
  assert.deepEqual(cuerpo, {
    recipient: { id: "psid-123" },
    messaging_type: "RESPONSE",
    message: { text: "¡Hola!" },
  });
  assert.equal("tag" in cuerpo, false, "nunca HUMAN_AGENT ni otra etiqueta");
  assert.ok(llamadas[0].init.signal, "con timeout");
});

test("cuerpoDeRespuesta: la misma forma para un PSID que para un IGSID", () => {
  assert.deepEqual(cuerpoDeRespuesta({ recipientId: "igsid-9", text: "x" }), {
    recipient: { id: "igsid-9" },
    messaging_type: "RESPONSE",
    message: { text: "x" },
  });
});

test("rechazo fuera de la ventana de 24 h (10/2018278): MetaSendError PERMANENTE con código y subcódigo", async () => {
  const err = await rechazo(errorDeMeta(400, 10, 2018278));
  assert.equal(err.status, 400);
  assert.equal(err.codigo, 10);
  assert.equal(err.subcodigo, 2018278);
  assert.equal(err.transitorio, false);
  assert.equal(err.tokenInvalido, false);
  assert.match(err.message, /code 10\/2018278/);
});

test("token inválido (190): permanente y marcado como tokenInvalido", async () => {
  const err = await rechazo(errorDeMeta(401, 190));
  assert.equal(err.transitorio, false);
  assert.equal(err.tokenInvalido, true);
});

test("usuario que no recibe (551) y destinatario inexistente (100/2018001): permanentes", async () => {
  assert.equal((await rechazo(errorDeMeta(400, 551))).transitorio, false);
  assert.equal((await rechazo(errorDeMeta(400, 100, 2018001))).transitorio, false);
});

test("rate limit con HTTP 400 (códigos 4 y 613) y el 2 de Meta: TRANSITORIOS por el código, no por el status", async () => {
  for (const codigo of [2, 4, 613]) {
    const err = await rechazo(errorDeMeta(400, codigo));
    assert.equal(err.transitorio, true, `código ${codigo}`);
    assert.equal(err.tokenInvalido, false);
  }
});

test("429 y 5xx sin cuerpo interpretable: transitorios por el status, sin código", async () => {
  const caido = await rechazo(new Response("<html>bad gateway</html>", { status: 502 }));
  assert.equal(caido.codigo, null);
  assert.equal(caido.transitorio, true);
  assert.equal((await rechazo(new Response("", { status: 429 }))).transitorio, true);
});

test("el detalle se recorta a 500 caracteres y no lleva el token", async () => {
  const err = await rechazo(new Response("x".repeat(2000), { status: 400 }));
  assert.equal(err.detalle.length, 500);
  assert.ok(!err.message.includes("token-de-pagina"));
});

test("fallo de red: sube tal cual, NO como MetaSendError (el worker lo reintenta)", async () => {
  const { fetch } = fetchQueResponde(new TypeError("fetch failed"));
  await assert.rejects(crearSendMetaText(fetch)(ENTRADA), (err: unknown) => {
    assert.ok(!(err instanceof MetaSendError));
    assert.match((err as Error).message, /fetch failed/);
    return true;
  });
});
