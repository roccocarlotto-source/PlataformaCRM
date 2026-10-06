import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAMPOS_SUSCRIPTOS_DE_LA_PAGINA,
  MetaAuthError,
  crearClienteMetaOAuth,
  type FetchLike,
} from "./metaOAuth.service";

// Unitarios, SIN RED Y SIN CREDENCIALES REALES: Meta se mockea inyectando un
// fetch falso en la factory, mismo patrón que googleCalendar.service.test.ts.
// Buena parte de lo que se verifica es QUÉ SE LE MANDA a Meta, no solo cómo se
// interpreta lo que contesta.

const CONFIG = {
  appId: "2963314707367094",
  appSecret: "secreto-de-prueba",
  redirectUri: "http://localhost:4000/api/integrations/meta/callback",
  loginConfigId: "cfg-123",
};

interface Respuesta {
  ok?: boolean;
  status?: number;
  json?: unknown;
  jsonInvalido?: boolean;
}

interface LlamadaRegistrada {
  url: string;
  init: RequestInit;
}

// Devuelve las respuestas en orden, una por llamada.
function mockearFetch(...respuestas: Respuesta[]): {
  fetch: FetchLike;
  llamadas: LlamadaRegistrada[];
} {
  const llamadas: LlamadaRegistrada[] = [];

  const fetchFalso: FetchLike = (url, init) => {
    const respuesta = respuestas[llamadas.length] ?? respuestas[respuestas.length - 1];
    llamadas.push({ url, init });

    return Promise.resolve({
      ok: respuesta.ok ?? true,
      status: respuesta.status ?? 200,
      json: () =>
        respuesta.jsonInvalido
          ? Promise.reject(new Error("no es JSON"))
          : Promise.resolve(respuesta.json),
    } as Response);
  };

  return { fetch: fetchFalso, llamadas };
}

function esMetaAuthError(tokenInvalido: boolean) {
  return (err: unknown) =>
    err instanceof MetaAuthError && err.statusCode === 502 && err.tokenInvalido === tokenInvalido;
}

// ---------------------------------------------------------------------------
// URL de autorización
// ---------------------------------------------------------------------------

test("construirUrlDeAutorizacion arma el diálogo versionado de Facebook Login for Business con config_id y sin scope", () => {
  const cliente = crearClienteMetaOAuth(CONFIG);
  const url = new URL(cliente.construirUrlDeAutorizacion("el-state"));

  assert.equal(url.origin, "https://www.facebook.com");
  assert.equal(url.pathname, "/v25.0/dialog/oauth");
  assert.equal(url.searchParams.get("client_id"), CONFIG.appId);
  assert.equal(url.searchParams.get("redirect_uri"), CONFIG.redirectUri);
  assert.equal(url.searchParams.get("config_id"), CONFIG.loginConfigId);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "el-state");
  // En Login for Business los permisos viven en la configuración: `scope`
  // no va (Meta recomienda no mandarlo junto a config_id).
  assert.equal(url.searchParams.has("scope"), false);
  // El App Secret jamás va en una URL que ve el navegador.
  assert.equal(url.toString().includes(CONFIG.appSecret), false);
});

// ---------------------------------------------------------------------------
// Canje del code
// ---------------------------------------------------------------------------

test("intercambiarCodigo manda code, client_id, client_secret y el MISMO redirect_uri, y devuelve el token", async () => {
  const { fetch, llamadas } = mockearFetch({
    json: { access_token: "user-corto", token_type: "bearer", expires_in: 5000 },
  });
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });

  const token = await cliente.intercambiarCodigo("el-code");

  assert.deepEqual(token, { accessToken: "user-corto", expiraEnSegundos: 5000 });
  assert.equal(llamadas.length, 1);
  const url = new URL(llamadas[0].url);
  assert.equal(url.origin + url.pathname, "https://graph.facebook.com/v25.0/oauth/access_token");
  assert.equal(llamadas[0].init.method, "GET");
  assert.equal(url.searchParams.get("code"), "el-code");
  assert.equal(url.searchParams.get("client_id"), CONFIG.appId);
  assert.equal(url.searchParams.get("client_secret"), CONFIG.appSecret);
  assert.equal(url.searchParams.get("redirect_uri"), CONFIG.redirectUri);
  // Cada pedido lleva su timeout.
  assert.ok(llamadas[0].init.signal);
});

test("intercambiarCodigo: Meta rechaza el code (OAuthException) → MetaAuthError con tokenInvalido", async () => {
  const { fetch } = mockearFetch({
    ok: false,
    status: 400,
    json: {
      error: {
        message: "This authorization code has been used.",
        type: "OAuthException",
        code: 100,
      },
    },
  });
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });

  await assert.rejects(
    () => cliente.intercambiarCodigo("usado"),
    (err: unknown) =>
      esMetaAuthError(true)(err) &&
      (err as Error).message.includes("This authorization code has been used."),
  );
});

test("intercambiarCodigo: fallo de RED → MetaAuthError sin tokenInvalido, y el mensaje no filtra el secreto", async () => {
  const fetch: FetchLike = () => Promise.reject(new Error("ECONNRESET"));
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });

  await assert.rejects(
    () => cliente.intercambiarCodigo("el-code"),
    (err: unknown) =>
      esMetaAuthError(false)(err) &&
      (err as Error).message.includes("ECONNRESET") &&
      !(err as Error).message.includes(CONFIG.appSecret),
  );
});

test("un 5xx de Meta, aunque diga OAuthException, es transitorio", async () => {
  const { fetch } = mockearFetch({
    ok: false,
    status: 500,
    json: { error: { message: "An unknown error occurred", type: "OAuthException", code: 1 } },
  });
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });

  await assert.rejects(() => cliente.intercambiarCodigo("x"), esMetaAuthError(false));
});

test("un código documentado como transitorio (rate limit) no marca el token como inválido", async () => {
  const { fetch } = mockearFetch({
    ok: false,
    status: 400,
    json: {
      error: { message: "Application request limit reached", type: "OAuthException", code: 4 },
    },
  });
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });

  await assert.rejects(() => cliente.intercambiarCodigo("x"), esMetaAuthError(false));
});

test("un error sin cuerpo JSON (HTML de un intermediario) es transitorio y no expone el cuerpo", async () => {
  const { fetch } = mockearFetch({ ok: false, status: 502, jsonInvalido: true });
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });

  await assert.rejects(
    () => cliente.intercambiarCodigo("x"),
    (err: unknown) =>
      esMetaAuthError(false)(err) && (err as Error).message.includes("sin un cuerpo interpretable"),
  );
});

test("un 200 sin access_token es transitorio: no es un rechazo", async () => {
  const { fetch } = mockearFetch({ json: { token_type: "bearer" } });
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });

  await assert.rejects(() => cliente.intercambiarCodigo("x"), esMetaAuthError(false));
});

// ---------------------------------------------------------------------------
// Token de larga duración
// ---------------------------------------------------------------------------

test("obtenerTokenDeLargaDuracion usa grant_type=fb_exchange_token con el token corto", async () => {
  const { fetch, llamadas } = mockearFetch({
    json: { access_token: "user-largo", token_type: "bearer", expires_in: 5183944 },
  });
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });

  const token = await cliente.obtenerTokenDeLargaDuracion("user-corto");

  assert.deepEqual(token, { accessToken: "user-largo", expiraEnSegundos: 5183944 });
  const url = new URL(llamadas[0].url);
  assert.equal(url.origin + url.pathname, "https://graph.facebook.com/v25.0/oauth/access_token");
  assert.equal(url.searchParams.get("grant_type"), "fb_exchange_token");
  assert.equal(url.searchParams.get("fb_exchange_token"), "user-corto");
  assert.equal(url.searchParams.get("client_id"), CONFIG.appId);
  assert.equal(url.searchParams.get("client_secret"), CONFIG.appSecret);
});

test("obtenerTokenDeLargaDuracion: token inválido (190) → tokenInvalido", async () => {
  const { fetch } = mockearFetch({
    ok: false,
    status: 400,
    json: {
      error: { message: "Error validating access token", type: "OAuthException", code: 190 },
    },
  });
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });

  await assert.rejects(() => cliente.obtenerTokenDeLargaDuracion("x"), esMetaAuthError(true));
});

// ---------------------------------------------------------------------------
// Páginas autorizadas
// ---------------------------------------------------------------------------

test("listarPaginasAutorizadas pide /me/accounts con los campos necesarios y el token en el header, no en la URL", async () => {
  const { fetch, llamadas } = mockearFetch({
    json: {
      data: [
        {
          id: "111",
          name: "Mi Negocio",
          access_token: "page-token-111",
          instagram_business_account: { id: "17841400000000000", username: "mi.negocio" },
        },
      ],
    },
  });
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });

  const paginas = await cliente.listarPaginasAutorizadas("user-largo");

  assert.deepEqual(paginas, [
    {
      id: "111",
      name: "Mi Negocio",
      accessToken: "page-token-111",
      instagramBusinessAccountId: "17841400000000000",
      instagramUsername: "mi.negocio",
    },
  ]);
  const url = new URL(llamadas[0].url);
  assert.equal(url.origin + url.pathname, "https://graph.facebook.com/v25.0/me/accounts");
  const campos = url.searchParams.get("fields") ?? "";
  for (const campo of ["id", "name", "access_token", "instagram_business_account{id,username}"]) {
    assert.ok(campos.includes(campo), `falta el campo ${campo}`);
  }
  assert.equal(llamadas[0].url.includes("user-largo"), false);
  assert.equal(
    (llamadas[0].init.headers as Record<string, string>).Authorization,
    "Bearer user-largo",
  );
});

test("listarPaginasAutorizadas: una página sin Instagram vinculado da null", async () => {
  const { fetch } = mockearFetch({
    json: { data: [{ id: "222", name: "Sin IG", access_token: "page-token-222" }] },
  });
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });

  const [pagina] = await cliente.listarPaginasAutorizadas("t");
  assert.equal(pagina.instagramBusinessAccountId, null);
  assert.equal(pagina.instagramUsername, null);
});

test("listarPaginasAutorizadas: ninguna página autorizada → lista vacía (la decisión es del service)", async () => {
  const { fetch } = mockearFetch({ json: { data: [] } });
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });

  assert.deepEqual(await cliente.listarPaginasAutorizadas("t"), []);
});

test("listarPaginasAutorizadas sigue paging.next y junta todas las páginas", async () => {
  const { fetch, llamadas } = mockearFetch(
    {
      json: {
        data: [{ id: "1", name: "A", access_token: "t1" }],
        paging: { next: "https://graph.facebook.com/v25.0/me/accounts?after=abc" },
      },
    },
    { json: { data: [{ id: "2", name: "B", access_token: "t2" }] } },
  );
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });

  const paginas = await cliente.listarPaginasAutorizadas("t");

  assert.deepEqual(
    paginas.map((p) => p.id),
    ["1", "2"],
  );
  assert.equal(llamadas.length, 2);
  assert.equal(llamadas[1].url, "https://graph.facebook.com/v25.0/me/accounts?after=abc");
});

test("listarPaginasAutorizadas: una página sin access_token es un error explícito, no se descarta en silencio", async () => {
  const { fetch } = mockearFetch({ json: { data: [{ id: "333", name: "Sin token" }] } });
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });

  await assert.rejects(() => cliente.listarPaginasAutorizadas("t"), esMetaAuthError(false));
});

test("listarPaginasAutorizadas: respuesta sin `data` → error transitorio", async () => {
  const { fetch } = mockearFetch({ json: {} });
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });

  await assert.rejects(() => cliente.listarPaginasAutorizadas("t"), esMetaAuthError(false));
});

test("listarPaginasAutorizadas: Meta rechaza el token → tokenInvalido", async () => {
  const { fetch } = mockearFetch({
    ok: false,
    status: 401,
    json: { error: { message: "Session has expired", type: "OAuthException", code: 190 } },
  });
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });

  await assert.rejects(() => cliente.listarPaginasAutorizadas("t"), esMetaAuthError(true));
});

// ---------------------------------------------------------------------------
// Suscripción de la página a la app (ítem 171)
// ---------------------------------------------------------------------------

test("suscribirPaginaALaApp: POST /{page-id}/subscribed_apps con el PAGE token en el header y los campos en el cuerpo", async () => {
  const { fetch, llamadas } = mockearFetch({ json: { success: true } });
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });

  await cliente.suscribirPaginaALaApp("111", "page-token-111");

  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].url, "https://graph.facebook.com/v25.0/111/subscribed_apps");
  assert.equal(llamadas[0].init.method, "POST");
  assert.equal(
    (llamadas[0].init.headers as Record<string, string>).Authorization,
    "Bearer page-token-111",
  );
  const cuerpo = new URLSearchParams(String(llamadas[0].init.body));
  assert.equal(cuerpo.get("subscribed_fields"), CAMPOS_SUSCRIPTOS_DE_LA_PAGINA.join(","));
  assert.ok(CAMPOS_SUSCRIPTOS_DE_LA_PAGINA.includes("messages"));
  assert.equal(String(llamadas[0].init.body).includes("page-token-111"), false);
});

// Lo que de verdad le llega a Meta en el cuerpo, campo por campo, y no solo
// "lo mismo que la constante": sin `message_echoes` la bandeja de Meta Business
// Suite es invisible para el CRM en Messenger (OPUS-B-01).
test("suscribirPaginaALaApp: el cuerpo suscribe messages, messaging_postbacks y message_echoes", async () => {
  const { fetch, llamadas } = mockearFetch({ json: { success: true } });
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });

  await cliente.suscribirPaginaALaApp("111", "page-token-111");

  const campos = new URLSearchParams(String(llamadas[0].init.body))
    .get("subscribed_fields")
    ?.split(",");
  assert.ok(campos?.includes("messages"), "messages");
  assert.ok(campos?.includes("messaging_postbacks"), "messaging_postbacks");
  assert.ok(
    campos?.includes("message_echoes"),
    "message_echoes: sin él, las respuestas desde la bandeja de Meta no llegan por Messenger",
  );
});

test("suscribirPaginaALaApp: Meta rechaza (permiso faltante) → MetaAuthError con tokenInvalido", async () => {
  const { fetch } = mockearFetch({
    ok: false,
    status: 403,
    json: { error: { message: "(#200) Permissions error", type: "OAuthException", code: 200 } },
  });
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });
  await assert.rejects(cliente.suscribirPaginaALaApp("111", "t"), esMetaAuthError(true));
});

test("suscribirPaginaALaApp: un 200 sin success: true no cuenta como suscripta", async () => {
  const { fetch } = mockearFetch({ json: { success: false } });
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });
  await assert.rejects(cliente.suscribirPaginaALaApp("111", "t"), esMetaAuthError(false));
});

// ---------------------------------------------------------------------------
// Baja de la suscripción al desconectar (D-11)
// ---------------------------------------------------------------------------

test("desuscribirPaginaDeLaApp: DELETE /{page-id}/subscribed_apps con el PAGE token en el header", async () => {
  const { fetch, llamadas } = mockearFetch({ json: { success: true } });
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });

  await cliente.desuscribirPaginaDeLaApp("111", "page-token-111");

  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].url, "https://graph.facebook.com/v25.0/111/subscribed_apps");
  assert.equal(llamadas[0].init.method, "DELETE");
  assert.equal(
    (llamadas[0].init.headers as Record<string, string>).Authorization,
    "Bearer page-token-111",
  );
});

test("desuscribirPaginaDeLaApp: Meta rechaza el token → MetaAuthError con tokenInvalido", async () => {
  const { fetch } = mockearFetch({
    ok: false,
    status: 400,
    json: { error: { message: "Invalid token", type: "OAuthException", code: 190 } },
  });
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });
  await assert.rejects(cliente.desuscribirPaginaDeLaApp("111", "t"), esMetaAuthError(true));
});

test("desuscribirPaginaDeLaApp: un 200 sin success: true no cuenta como dada de baja", async () => {
  const { fetch } = mockearFetch({ json: { success: false } });
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });
  await assert.rejects(cliente.desuscribirPaginaDeLaApp("111", "t"), esMetaAuthError(false));
});

// ---------------------------------------------------------------------------
// Nombres de una página ya conectada
// ---------------------------------------------------------------------------

test("obtenerNombresDePagina: GET /{page-id} con name e instagram_business_account{id,username}, con el PAGE token en el header", async () => {
  const { fetch, llamadas } = mockearFetch({
    json: {
      name: "Mi Negocio",
      instagram_business_account: { id: "1784", username: "mi.negocio" },
    },
  });
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });

  const nombres = await cliente.obtenerNombresDePagina("111", "page-token-111");

  assert.deepEqual(nombres, { name: "Mi Negocio", instagramUsername: "mi.negocio" });
  const url = new URL(llamadas[0].url);
  assert.equal(url.origin + url.pathname, "https://graph.facebook.com/v25.0/111");
  assert.equal(url.searchParams.get("fields"), "name,instagram_business_account{id,username}");
  assert.equal(llamadas[0].url.includes("page-token-111"), false);
  assert.equal(
    (llamadas[0].init.headers as Record<string, string>).Authorization,
    "Bearer page-token-111",
  );
});

test("obtenerNombresDePagina: sin Instagram o con el nombre vacío da null, no un string vacío", async () => {
  const { fetch } = mockearFetch({ json: { name: "" } });
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });
  assert.deepEqual(await cliente.obtenerNombresDePagina("111", "t"), {
    name: null,
    instagramUsername: null,
  });
});

test("obtenerNombresDePagina: Meta rechaza el token → MetaAuthError con tokenInvalido", async () => {
  const { fetch } = mockearFetch({
    ok: false,
    status: 400,
    json: { error: { message: "Invalid token", type: "OAuthException", code: 190 } },
  });
  const cliente = crearClienteMetaOAuth({ ...CONFIG, fetch });
  await assert.rejects(cliente.obtenerNombresDePagina("111", "t"), esMetaAuthError(true));
});
