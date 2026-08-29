import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GOOGLE_CALENDAR_SCOPES,
  GoogleAuthError,
  crearClienteGoogleCalendar,
  type FetchLike,
} from "./googleCalendar.service";

// Unitarios, SIN RED Y SIN CREDENCIALES REALES: la API de Google se mockea
// inyectando un `fetch` falso en la factory. Ningún test de este archivo llega a
// internet ni necesita un GOOGLE_CLIENT_ID configurado — que es justamente por
// lo que googleCalendar.service.ts no toca Postgres ni lee el entorno.

const CONFIG = {
  clientId: "id-de-prueba.apps.googleusercontent.com",
  clientSecret: "secreto-de-prueba",
  redirectUri: "http://localhost:4000/api/integrations/google-calendar/callback",
};

interface LlamadaRegistrada {
  url: string;
  init: RequestInit;
}

// Arma un fetch falso que devuelve `respuesta` y registra con qué lo llamaron.
// El registro importa tanto como la respuesta: buena parte de lo que hay que
// verificar acá es QUÉ SE LE MANDA a Google, no solo cómo se interpreta lo que
// contesta.
function mockearFetch(respuesta: {
  ok?: boolean;
  status?: number;
  json?: unknown;
  jsonInvalido?: boolean;
}): { fetch: FetchLike; llamadas: LlamadaRegistrada[] } {
  const llamadas: LlamadaRegistrada[] = [];

  const fetchFalso: FetchLike = (url, init) => {
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

function cuerpoDe(llamada: LlamadaRegistrada): Record<string, unknown> {
  return JSON.parse(String(llamada.init.body));
}

// ---------------------------------------------------------------------------
// freebusy.query — el endpoint que motiva el archivo
// ---------------------------------------------------------------------------

const RANGO = {
  timeMin: "2026-09-01T00:00:00-03:00",
  timeMax: "2026-09-02T00:00:00-03:00",
  timeZone: "America/Argentina/Buenos_Aires",
};

test("consultarFreeBusy devuelve los intervalos ocupados del calendario", async () => {
  const { fetch, llamadas } = mockearFetch({
    json: {
      calendars: {
        primary: {
          busy: [
            { start: "2026-09-01T13:00:00Z", end: "2026-09-01T14:00:00Z" },
            { start: "2026-09-01T18:00:00Z", end: "2026-09-01T19:30:00Z" },
          ],
        },
      },
    },
  });

  const ocupados = await crearClienteGoogleCalendar({ ...CONFIG, fetch }).consultarFreeBusy({
    accessToken: "access-token-de-prueba",
    calendarIds: ["primary"],
    ...RANGO,
  });

  assert.deepEqual(ocupados, [
    { inicio: "2026-09-01T13:00:00Z", fin: "2026-09-01T14:00:00Z" },
    { inicio: "2026-09-01T18:00:00Z", fin: "2026-09-01T19:30:00Z" },
  ]);

  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].url, "https://www.googleapis.com/calendar/v3/freeBusy");
  assert.equal(llamadas[0].init.method, "POST");
});

test("consultarFreeBusy manda el access token como Bearer", async () => {
  const { fetch, llamadas } = mockearFetch({ json: { calendars: { primary: { busy: [] } } } });

  await crearClienteGoogleCalendar({ ...CONFIG, fetch }).consultarFreeBusy({
    accessToken: "abc123",
    calendarIds: ["primary"],
    ...RANGO,
  });

  const headers = llamadas[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer abc123");
});

test("consultarFreeBusy manda SIEMPRE la zona horaria de la sucursal", async () => {
  // §4 del documento de diseño es explícito: la zona se pasa en cada llamada y
  // NUNCA se asume la del servidor. Si esto se cayera, los turnos saldrían a la
  // hora equivocada para toda sucursal que no esté en la zona del servidor — y
  // en desarrollo, donde suelen coincidir, no se notaría.
  const { fetch, llamadas } = mockearFetch({ json: { calendars: { primary: { busy: [] } } } });

  await crearClienteGoogleCalendar({ ...CONFIG, fetch }).consultarFreeBusy({
    accessToken: "abc",
    calendarIds: ["primary"],
    ...RANGO,
  });

  const cuerpo = cuerpoDe(llamadas[0]);
  assert.equal(cuerpo.timeZone, "America/Argentina/Buenos_Aires");
  assert.equal(cuerpo.timeMin, RANGO.timeMin);
  assert.equal(cuerpo.timeMax, RANGO.timeMax);
});

test("consultarFreeBusy pide los calendarios en el formato items:[{id}] que Google espera", async () => {
  const { fetch, llamadas } = mockearFetch({
    json: { calendars: { primary: { busy: [] }, "otro@group.calendar.google.com": { busy: [] } } },
  });

  await crearClienteGoogleCalendar({ ...CONFIG, fetch }).consultarFreeBusy({
    accessToken: "abc",
    calendarIds: ["primary", "otro@group.calendar.google.com"],
    ...RANGO,
  });

  assert.deepEqual(cuerpoDe(llamadas[0]).items, [
    { id: "primary" },
    { id: "otro@group.calendar.google.com" },
  ]);
});

test("un calendario sin nada agendado devuelve una lista vacía, no un error", async () => {
  const { fetch } = mockearFetch({ json: { calendars: { primary: { busy: [] } } } });

  const ocupados = await crearClienteGoogleCalendar({ ...CONFIG, fetch }).consultarFreeBusy({
    accessToken: "abc",
    calendarIds: ["primary"],
    ...RANGO,
  });

  assert.deepEqual(ocupados, []);
});

// ---------------------------------------------------------------------------
// EL BUG SILENCIOSO QUE ESTE ARCHIVO EXISTE PARA EVITAR
// ---------------------------------------------------------------------------

test("un calendario con errores por-calendario LANZA en vez de reportarlo libre", async () => {
  // freebusy.query responde 200 aunque un calendario individual haya fallado, y
  // pone el motivo adentro de `errors`. Un calendario inaccesible llega con
  // `busy: []`, que es INDISTINGUIBLE de "está completamente libre".
  //
  // Ignorar esto sería el peor bug posible de esta integración: el sistema
  // ofrecería todos los horarios de un calendario que no puede leer, y
  // sobrevendería turnos sin que nada falle visiblemente.
  const { fetch } = mockearFetch({
    json: {
      calendars: {
        primary: { errors: [{ domain: "calendar", reason: "notFound" }], busy: [] },
      },
    },
  });

  await assert.rejects(
    () =>
      crearClienteGoogleCalendar({ ...CONFIG, fetch }).consultarFreeBusy({
        accessToken: "abc",
        calendarIds: ["primary"],
        ...RANGO,
      }),
    (err: unknown) =>
      err instanceof GoogleAuthError &&
      err.message.includes("notFound") &&
      // notFound/accessDenied = el permiso sobre ese calendario se perdió, así
      // que la conexión tiene que terminar en ERROR y alguien reconectar.
      err.grantInvalido,
  );
});

test("un calendario que Google no menciona en la respuesta LANZA", async () => {
  // Se pidió un calendario y no vino ni con busy ni con errors. Tratarlo como
  // "sin ocupación" sería la misma clase de sobreventa silenciosa.
  const { fetch } = mockearFetch({ json: { calendars: {} } });

  await assert.rejects(
    () =>
      crearClienteGoogleCalendar({ ...CONFIG, fetch }).consultarFreeBusy({
        accessToken: "abc",
        calendarIds: ["primary"],
        ...RANGO,
      }),
    (err: unknown) => err instanceof GoogleAuthError && !err.grantInvalido,
  );
});

test("un 401 de freebusy marca el grant como inválido", async () => {
  // El access token lo acaba de emitir el refresh, así que un 401 acá significa
  // que el problema es del grant y no del token.
  const { fetch } = mockearFetch({
    ok: false,
    status: 401,
    json: { error: { message: "Invalid Credentials" } },
  });

  await assert.rejects(
    () =>
      crearClienteGoogleCalendar({ ...CONFIG, fetch }).consultarFreeBusy({
        accessToken: "vencido",
        calendarIds: ["primary"],
        ...RANGO,
      }),
    (err: unknown) => err instanceof GoogleAuthError && err.grantInvalido,
  );
});

test("un 500 de Google NO marca el grant como inválido", async () => {
  // La distinción que evita degradar una conexión sana porque Google tuvo un mal
  // minuto. Si esto se rompiera, un incidente de Google dejaría a todos los
  // negocios teniendo que reconectar a mano.
  const { fetch } = mockearFetch({ ok: false, status: 500, json: { error: { message: "boom" } } });

  await assert.rejects(
    () =>
      crearClienteGoogleCalendar({ ...CONFIG, fetch }).consultarFreeBusy({
        accessToken: "abc",
        calendarIds: ["primary"],
        ...RANGO,
      }),
    (err: unknown) => err instanceof GoogleAuthError && !err.grantInvalido,
  );
});

test("una falla de red no marca el grant como inválido", async () => {
  const fetchQueFalla: FetchLike = () => Promise.reject(new Error("ECONNREFUSED"));

  await assert.rejects(
    () =>
      crearClienteGoogleCalendar({ ...CONFIG, fetch: fetchQueFalla }).consultarFreeBusy({
        accessToken: "abc",
        calendarIds: ["primary"],
        ...RANGO,
      }),
    (err: unknown) =>
      err instanceof GoogleAuthError && !err.grantInvalido && err.message.includes("ECONNREFUSED"),
  );
});

// ---------------------------------------------------------------------------
// La URL de autorización
// ---------------------------------------------------------------------------

test("la URL de autorización pide los dos scopes verificados contra la doc de Google", async () => {
  const url = new URL(
    crearClienteGoogleCalendar(CONFIG).construirUrlDeAutorizacion("el-state-firmado"),
  );

  const scopes = (url.searchParams.get("scope") ?? "").split(" ");

  // calendar.events.freebusy es EL scope que freebusy.query necesita.
  // calendar.events SOLO no habilita ese endpoint — la premisa de §4 del
  // documento de diseño estaba mal y se corrigió.
  assert.ok(scopes.includes("https://www.googleapis.com/auth/calendar.events.freebusy"));
  assert.ok(scopes.includes("https://www.googleapis.com/auth/calendar.events"));

  // Y NO calendar.readonly ni calendar: son mucho más amplios de lo que este
  // producto usa. Si alguien los agrega, que sea una decisión y no un descuido.
  assert.ok(!scopes.includes("https://www.googleapis.com/auth/calendar.readonly"));
  assert.ok(!scopes.includes("https://www.googleapis.com/auth/calendar"));

  assert.deepEqual(scopes.sort(), [...GOOGLE_CALENDAR_SCOPES].sort());
});

test("la URL de autorización lleva access_type=offline y prompt=consent", async () => {
  const url = new URL(crearClienteGoogleCalendar(CONFIG).construirUrlDeAutorizacion("state-abc"));

  // Sin access_type=offline, Google nunca manda refresh token y la integración
  // se muere sola en una hora.
  assert.equal(url.searchParams.get("access_type"), "offline");

  // Sin prompt=consent, RECONECTAR una sucursal que ya había autorizado devuelve
  // un 200 impecable y SIN refresh_token. Es el error clásico de esta
  // integración y el caso de reconexión es justo el que hay que soportar.
  assert.equal(url.searchParams.get("prompt"), "consent");

  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "state-abc");
  assert.equal(url.searchParams.get("redirect_uri"), CONFIG.redirectUri);
  assert.equal(url.searchParams.get("client_id"), CONFIG.clientId);
});

// ---------------------------------------------------------------------------
// Intercambio y renovación de tokens
// ---------------------------------------------------------------------------

test("intercambiarCodigo devuelve los tokens y manda grant_type=authorization_code", async () => {
  const { fetch, llamadas } = mockearFetch({
    json: {
      access_token: "access-nuevo",
      refresh_token: "refresh-nuevo",
      expires_in: 3599,
      scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    },
  });

  const tokens = await crearClienteGoogleCalendar({ ...CONFIG, fetch }).intercambiarCodigo("cod-1");

  assert.equal(tokens.accessToken, "access-nuevo");
  assert.equal(tokens.refreshToken, "refresh-nuevo");
  assert.equal(tokens.expiraEnSegundos, 3599);

  const enviado = new URLSearchParams(String(llamadas[0].init.body));
  assert.equal(llamadas[0].url, "https://oauth2.googleapis.com/token");
  assert.equal(enviado.get("grant_type"), "authorization_code");
  assert.equal(enviado.get("code"), "cod-1");
  assert.equal(enviado.get("client_secret"), CONFIG.clientSecret);
  // redirect_uri se manda también en el intercambio, y Google exige que sea
  // idéntico al de la autorización o responde redirect_uri_mismatch.
  assert.equal(enviado.get("redirect_uri"), CONFIG.redirectUri);
});

test("un intercambio SIN refresh_token no inventa uno: lo devuelve undefined", async () => {
  // Pasa cuando la cuenta ya había autorizado y falta prompt=consent. Quien
  // llama decide qué hacer; este archivo no rellena el hueco con nada.
  const { fetch } = mockearFetch({ json: { access_token: "solo-access", expires_in: 3599 } });

  const tokens = await crearClienteGoogleCalendar({ ...CONFIG, fetch }).intercambiarCodigo("cod");

  assert.equal(tokens.refreshToken, undefined);
  assert.equal(tokens.accessToken, "solo-access");
});

test("renovarAccessToken manda grant_type=refresh_token", async () => {
  const { fetch, llamadas } = mockearFetch({
    json: { access_token: "access-renovado", expires_in: 3599 },
  });

  const tokens = await crearClienteGoogleCalendar({ ...CONFIG, fetch }).renovarAccessToken("rt-1");

  assert.equal(tokens.accessToken, "access-renovado");

  const enviado = new URLSearchParams(String(llamadas[0].init.body));
  assert.equal(enviado.get("grant_type"), "refresh_token");
  assert.equal(enviado.get("refresh_token"), "rt-1");
});

test("invalid_grant al renovar marca el grant como inválido", async () => {
  // ES LA CONDICIÓN CENTRAL de todo el manejo de errores: es lo único que debe
  // llevar la conexión a status = ERROR.
  const { fetch } = mockearFetch({
    ok: false,
    status: 400,
    json: { error: "invalid_grant", error_description: "Token has been expired or revoked." },
  });

  await assert.rejects(
    () => crearClienteGoogleCalendar({ ...CONFIG, fetch }).renovarAccessToken("rt-muerto"),
    (err: unknown) =>
      err instanceof GoogleAuthError &&
      err.grantInvalido &&
      err.message.includes("invalid_grant") &&
      err.message.includes("expired or revoked"),
  );
});

test("un 200 sin access_token no se toma como éxito ni marca el grant inválido", async () => {
  const { fetch } = mockearFetch({ json: { algo: "inesperado" } });

  await assert.rejects(
    () => crearClienteGoogleCalendar({ ...CONFIG, fetch }).renovarAccessToken("rt"),
    (err: unknown) =>
      err instanceof GoogleAuthError && !err.grantInvalido && err.message.includes("access_token"),
  );
});

test("un error con cuerpo no interpretable no explota al describirlo", async () => {
  // Cuando el que responde no es Google sino un balanceador en el medio, el
  // cuerpo puede ser HTML. Describir el fallo no puede fallar a su vez.
  const { fetch } = mockearFetch({ ok: false, status: 502, jsonInvalido: true });

  await assert.rejects(
    () => crearClienteGoogleCalendar({ ...CONFIG, fetch }).renovarAccessToken("rt"),
    (err: unknown) => err instanceof GoogleAuthError && err.message.includes("502"),
  );
});

test("revocarToken postea el token al endpoint de revocación", async () => {
  const { fetch, llamadas } = mockearFetch({ json: {} });

  await crearClienteGoogleCalendar({ ...CONFIG, fetch }).revocarToken("rt-a-revocar");

  assert.equal(llamadas[0].url, "https://oauth2.googleapis.com/revoke");
  assert.equal(new URLSearchParams(String(llamadas[0].init.body)).get("token"), "rt-a-revocar");
});
