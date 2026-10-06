import assert from "node:assert/strict";
import { test } from "node:test";
import type { FetchLike } from "./metaOAuth.service";
import {
  MetaProfileError,
  crearObtenerPerfilDeMeta,
  nombreDesdeElPerfil,
  urlDelPerfil,
} from "./metaProfile.service";

// ---------------------------------------------------------------------------
// metaProfile.service.ts, SIN RED: la Graph API se simula inyectando fetch en
// la factory (mismo patrón que metaSend.service.test.ts). Se afirma lo que
// Meta recibe —URL, campos, token en el header y no en la URL— y qué nombre
// sale de cada respuesta, incluidos los rechazos.
// ---------------------------------------------------------------------------

interface Llamada {
  url: string;
  init: RequestInit;
}

function graphQueResponde(respuesta: Response | Error): { fetch: FetchLike; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  return {
    llamadas,
    fetch: (url, init) => {
      llamadas.push({ url, init });
      return respuesta instanceof Error ? Promise.reject(respuesta) : Promise.resolve(respuesta);
    },
  };
}

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status });
}

const TOKEN = "token-de-pagina";

test("Messenger: GET /{PSID}?fields=first_name,last_name con el token en el header, y sale nombre y apellido", async () => {
  const { fetch, llamadas } = graphQueResponde(
    json({ first_name: "Ana", last_name: "Pérez", id: "psid-123" }),
  );
  const perfil = await crearObtenerPerfilDeMeta(fetch)({
    pageAccessToken: TOKEN,
    channel: "MESSENGER",
    userId: "psid-123",
  });

  assert.deepEqual(perfil, { firstName: "Ana", lastName: "Pérez" });
  assert.equal(llamadas.length, 1);
  assert.equal(
    llamadas[0].url,
    "https://graph.facebook.com/v25.0/psid-123?fields=first_name,last_name",
  );
  assert.equal(llamadas[0].init.method, "GET");
  assert.deepEqual(llamadas[0].init.headers, { Authorization: `Bearer ${TOKEN}` });
  assert.ok(!llamadas[0].url.includes(TOKEN), "el token no viaja en la URL");
  assert.ok(llamadas[0].init.signal instanceof AbortSignal, "la llamada tiene tope de tiempo");
});

test("Instagram: GET /{IGSID}?fields=name,username, y el nombre se parte en nombre y apellido", async () => {
  const { fetch, llamadas } = graphQueResponde(
    json({ name: "Juan Pérez García", username: "juanpg", id: "igsid-9" }),
  );
  const perfil = await crearObtenerPerfilDeMeta(fetch)({
    pageAccessToken: TOKEN,
    channel: "INSTAGRAM",
    userId: "igsid-9",
  });

  assert.deepEqual(perfil, { firstName: "Juan", lastName: "Pérez García" });
  assert.equal(llamadas[0].url, "https://graph.facebook.com/v25.0/igsid-9?fields=name,username");
});

test("urlDelPerfil: el id se escapa (nunca arma otra ruta)", () => {
  assert.equal(
    urlDelPerfil("MESSENGER", "1/../me"),
    "https://graph.facebook.com/v25.0/1%2F..%2Fme?fields=first_name,last_name",
  );
});

test("nombreDesdeElPerfil: Instagram sin nombre queda con el @usuario; sin nada, null", () => {
  assert.deepEqual(nombreDesdeElPerfil("INSTAGRAM", { name: "  ", username: "autos.del.sur" }), {
    firstName: "@autos.del.sur",
    lastName: "",
  });
  assert.deepEqual(nombreDesdeElPerfil("INSTAGRAM", { name: "Lucía" }), {
    firstName: "Lucía",
    lastName: "",
  });
  assert.equal(nombreDesdeElPerfil("INSTAGRAM", { id: "igsid-9" }), null);
  assert.equal(nombreDesdeElPerfil("INSTAGRAM", null), null);
});

test("nombreDesdeElPerfil: Messenger sin first_name ni last_name (solo id, sin el permiso) es null", () => {
  assert.equal(nombreDesdeElPerfil("MESSENGER", { id: "psid-123" }), null);
  assert.equal(nombreDesdeElPerfil("MESSENGER", { first_name: 7, last_name: null }), null);
  assert.deepEqual(nombreDesdeElPerfil("MESSENGER", { last_name: "Pérez" }), {
    firstName: "Pérez",
    lastName: "",
  });
  // VARCHAR(100): un nombre larguísimo se recorta, no rompe el update.
  const largo = nombreDesdeElPerfil("MESSENGER", { first_name: "a".repeat(150), last_name: "B" });
  assert.equal(largo?.firstName.length, 100);
});

test("un rechazo de Meta (sin permiso, sin perfil) es un MetaProfileError con status y códigos, sin el token", async () => {
  const sinPerfil = graphQueResponde(
    json(
      {
        error: {
          message: "No profile available for this user.",
          type: "OAuthException",
          code: 100,
          error_subcode: 2018218,
        },
      },
      400,
    ),
  );
  await assert.rejects(
    crearObtenerPerfilDeMeta(sinPerfil.fetch)({
      pageAccessToken: TOKEN,
      channel: "MESSENGER",
      userId: "psid-123",
    }),
    (err: unknown) => {
      assert.ok(err instanceof MetaProfileError);
      assert.equal(err.status, 400);
      assert.equal(err.codigo, 100);
      assert.equal(err.subcodigo, 2018218);
      assert.ok(!err.message.includes(TOKEN));
      return true;
    },
  );

  // Un 500 con HTML de un intermediario: queda solo el status.
  const html = graphQueResponde(new Response("<html>Bad Gateway</html>", { status: 502 }));
  await assert.rejects(
    crearObtenerPerfilDeMeta(html.fetch)({
      pageAccessToken: TOKEN,
      channel: "INSTAGRAM",
      userId: "igsid-9",
    }),
    (err: unknown) => err instanceof MetaProfileError && err.status === 502 && err.codigo === null,
  );
});

test("un corte de red o un timeout se propaga tal cual (lo ataja quien llama)", async () => {
  const { fetch } = graphQueResponde(new Error("fetch failed"));
  await assert.rejects(
    crearObtenerPerfilDeMeta(fetch)({
      pageAccessToken: TOKEN,
      channel: "MESSENGER",
      userId: "psid-123",
    }),
    /fetch failed/,
  );
});

test("un 200 con un cuerpo que no es JSON es 'sin perfil', no un error", async () => {
  const { fetch } = graphQueResponde(new Response("ok", { status: 200 }));
  assert.equal(
    await crearObtenerPerfilDeMeta(fetch)({
      pageAccessToken: TOKEN,
      channel: "MESSENGER",
      userId: "psid-123",
    }),
    null,
  );
});
