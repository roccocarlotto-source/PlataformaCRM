import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GOOGLE_CALENDAR_SCOPES,
  GoogleAuthError,
  GoogleSyncTokenInvalidoError,
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

// ---------------------------------------------------------------------------
// events.insert / events.delete — agregados en el paso 3 (Booking)
// ---------------------------------------------------------------------------

const EVENTO = {
  accessToken: "access-abc",
  calendarId: "primary",
  titulo: "Corte de pelo — Ana Pérez",
  descripcion: "Reserva creada desde el CRM.",
  inicio: new Date("2026-09-07T12:00:00Z"),
  fin: new Date("2026-09-07T12:30:00Z"),
  zona: "America/Argentina/Buenos_Aires",
};

test("crearEvento devuelve el id que asigna Google", async () => {
  const { fetch, llamadas } = mockearFetch({ json: { id: "evento-google-123" } });

  const id = await crearClienteGoogleCalendar({ ...CONFIG, fetch }).crearEvento(EVENTO);

  assert.equal(id, "evento-google-123");
  assert.equal(llamadas[0].url, "https://www.googleapis.com/calendar/v3/calendars/primary/events");
  assert.equal(llamadas[0].init.method, "POST");
});

test("crearEvento manda la zona de la SUCURSAL junto a cada dateTime", async () => {
  // §4 del documento: la zona se pasa explícitamente en cada llamada y nunca se
  // asume la del servidor. Google la exige junto al dateTime aunque éste ya
  // lleve offset — es lo que decide cómo se muestra el evento.
  const { fetch, llamadas } = mockearFetch({ json: { id: "e1" } });

  await crearClienteGoogleCalendar({ ...CONFIG, fetch }).crearEvento(EVENTO);

  const cuerpo = cuerpoDe(llamadas[0]);
  assert.deepEqual(cuerpo.start, {
    dateTime: "2026-09-07T12:00:00.000Z",
    timeZone: "America/Argentina/Buenos_Aires",
  });
  assert.deepEqual(cuerpo.end, {
    dateTime: "2026-09-07T12:30:00.000Z",
    timeZone: "America/Argentina/Buenos_Aires",
  });
  assert.equal(cuerpo.summary, "Corte de pelo — Ana Pérez");
});

test("crearEvento URL-encodea el id del calendario", async () => {
  // Un calendario secundario se identifica con una dirección de correo. Sin
  // encodear, el "@" rompe la URL y Google responde cualquier cosa menos lo
  // esperado.
  const { fetch, llamadas } = mockearFetch({ json: { id: "e1" } });

  await crearClienteGoogleCalendar({ ...CONFIG, fetch }).crearEvento({
    ...EVENTO,
    calendarId: "sala2@group.calendar.google.com",
  });

  assert.equal(
    llamadas[0].url,
    "https://www.googleapis.com/calendar/v3/calendars/sala2%40group.calendar.google.com/events",
  );
});

test("crearEvento omite la descripción cuando no viene", async () => {
  const { fetch, llamadas } = mockearFetch({ json: { id: "e1" } });

  await crearClienteGoogleCalendar({ ...CONFIG, fetch }).crearEvento({
    ...EVENTO,
    descripcion: undefined,
  });

  assert.ok(!("description" in cuerpoDe(llamadas[0])));
});

test("un 200 sin id en crearEvento no se toma como éxito", async () => {
  // El evento pudo haberse creado y no tenemos con qué referenciarlo. No es un
  // fallo de autorización, así que no degrada la conexión.
  const { fetch } = mockearFetch({ json: { summary: "sin id" } });

  await assert.rejects(
    () => crearClienteGoogleCalendar({ ...CONFIG, fetch }).crearEvento(EVENTO),
    (err: unknown) =>
      err instanceof GoogleAuthError && !err.grantInvalido && err.message.includes("id"),
  );
});

test("un 401 en crearEvento marca el grant como inválido", async () => {
  const { fetch } = mockearFetch({
    ok: false,
    status: 401,
    json: { error: { message: "Invalid Credentials" } },
  });

  await assert.rejects(
    () => crearClienteGoogleCalendar({ ...CONFIG, fetch }).crearEvento(EVENTO),
    (err: unknown) => err instanceof GoogleAuthError && err.grantInvalido,
  );
});

test("un 500 en crearEvento NO marca el grant como inválido", async () => {
  const { fetch } = mockearFetch({ ok: false, status: 500, json: { error: { message: "boom" } } });

  await assert.rejects(
    () => crearClienteGoogleCalendar({ ...CONFIG, fetch }).crearEvento(EVENTO),
    (err: unknown) => err instanceof GoogleAuthError && !err.grantInvalido,
  );
});

test("eliminarEvento hace DELETE sobre el evento", async () => {
  const { fetch, llamadas } = mockearFetch({ json: {} });

  await crearClienteGoogleCalendar({ ...CONFIG, fetch }).eliminarEvento({
    accessToken: "abc",
    calendarId: "primary",
    eventId: "evento-123",
  });

  assert.equal(
    llamadas[0].url,
    "https://www.googleapis.com/calendar/v3/calendars/primary/events/evento-123",
  );
  assert.equal(llamadas[0].init.method, "DELETE");
});

test("un 404 o un 410 al eliminar NO son errores: el evento ya no está", async () => {
  // Alguien lo borró a mano desde el calendario, o esta cancelación ya llegó más
  // lejos de lo que creíamos. El resultado deseado —que el evento no exista— ya
  // se cumplió. Tratarlo como error obligaría a reintentar algo ya hecho.
  for (const status of [404, 410]) {
    const { fetch } = mockearFetch({
      ok: false,
      status,
      json: { error: { message: "Not Found" } },
    });

    await crearClienteGoogleCalendar({ ...CONFIG, fetch }).eliminarEvento({
      accessToken: "abc",
      calendarId: "primary",
      eventId: "ya-no-esta",
    });
  }
});

test("un 500 al eliminar SÍ es un error", async () => {
  const { fetch } = mockearFetch({ ok: false, status: 500, json: { error: { message: "boom" } } });

  await assert.rejects(
    () =>
      crearClienteGoogleCalendar({ ...CONFIG, fetch }).eliminarEvento({
        accessToken: "abc",
        calendarId: "primary",
        eventId: "e1",
      }),
    (err: unknown) => err instanceof GoogleAuthError && !err.grantInvalido,
  );
});

// ---------------------------------------------------------------------------
// events.watch / channels.stop / events.list — paso 4 (sincronización inversa)
// ---------------------------------------------------------------------------

const CANAL = {
  accessToken: "access-abc",
  calendarId: "primary",
  channelId: "11111111-2222-3333-4444-555555555555",
  address: "https://crm.ejemplo.com/api/webhooks/google-calendar",
  token: "token-firmado",
  ttlSegundos: 604800,
};

test("crearCanalDeNotificaciones manda id, type web_hook, address, token y ttl", async () => {
  const { fetch, llamadas } = mockearFetch({
    json: { id: CANAL.channelId, resourceId: "recurso-opaco", expiration: "1788000000000" },
  });

  const creado = await crearClienteGoogleCalendar({ ...CONFIG, fetch }).crearCanalDeNotificaciones(
    CANAL,
  );

  assert.equal(creado.channelId, CANAL.channelId);
  assert.equal(creado.resourceId, "recurso-opaco");

  assert.equal(
    llamadas[0].url,
    "https://www.googleapis.com/calendar/v3/calendars/primary/events/watch",
  );

  const cuerpo = cuerpoDe(llamadas[0]);
  assert.equal(cuerpo.id, CANAL.channelId);
  assert.equal(cuerpo.type, "web_hook");
  assert.equal(cuerpo.address, CANAL.address);
  assert.equal(cuerpo.token, CANAL.token);
  // El TTL va en params.ttl y como STRING de segundos, que es la forma que
  // documenta la referencia.
  assert.deepEqual(cuerpo.params, { ttl: "604800" });
});

test("la expiración del canal se interpreta en MILISEGUNDOS, no en segundos", async () => {
  // EL ERROR QUE ESTE TEST EXISTE PARA IMPEDIR: Google devuelve `expiration` como
  // timestamp Unix en milisegundos. Leerlo como segundos daría una fecha de 1970
  // y el worker recrearía el canal en cada pasada, para siempre, sin que nada
  // fallara visiblemente.
  const { fetch } = mockearFetch({
    json: { id: CANAL.channelId, resourceId: "r1", expiration: "1788000000000" },
  });

  const creado = await crearClienteGoogleCalendar({ ...CONFIG, fetch }).crearCanalDeNotificaciones(
    CANAL,
  );

  assert.equal(creado.expiration.getTime(), 1788000000000);
  assert.ok(creado.expiration.getUTCFullYear() > 2020, "si diera 1970, se leyó como segundos");
});

test("sin expiration en la respuesta se asume el TTL pedido", async () => {
  // `expiration` es opcional en el esquema de Google. Una fila sin expiración
  // sería peor: el worker no sabría cuándo renovar.
  const { fetch } = mockearFetch({ json: { id: CANAL.channelId, resourceId: "r1" } });

  const antes = Date.now();
  const creado = await crearClienteGoogleCalendar({ ...CONFIG, fetch }).crearCanalDeNotificaciones(
    CANAL,
  );

  assert.ok(creado.expiration.getTime() >= antes + 604800 * 1000 - 1000);
});

test("un canal SIN resourceId se rechaza: no se podría cerrar nunca", async () => {
  // channels.stop pide id + resourceId. Guardar una fila sin resourceId dejaría
  // un canal imposible de detener, solo esperable a que venza.
  const { fetch } = mockearFetch({ json: { id: CANAL.channelId } });

  await assert.rejects(
    () => crearClienteGoogleCalendar({ ...CONFIG, fetch }).crearCanalDeNotificaciones(CANAL),
    (err: unknown) =>
      err instanceof GoogleAuthError && !err.grantInvalido && err.message.includes("resourceId"),
  );
});

test("detenerCanal postea id + resourceId al endpoint de channels.stop", async () => {
  const { fetch, llamadas } = mockearFetch({ json: {} });

  await crearClienteGoogleCalendar({ ...CONFIG, fetch }).detenerCanal({
    accessToken: "abc",
    channelId: "canal-1",
    resourceId: "recurso-1",
  });

  assert.equal(llamadas[0].url, "https://www.googleapis.com/calendar/v3/channels/stop");
  assert.deepEqual(cuerpoDe(llamadas[0]), { id: "canal-1", resourceId: "recurso-1" });
});

test("un 404 al detener un canal NO es error: ya no existe", async () => {
  const { fetch } = mockearFetch({
    ok: false,
    status: 404,
    json: { error: { message: "Not Found" } },
  });

  await crearClienteGoogleCalendar({ ...CONFIG, fetch }).detenerCanal({
    accessToken: "abc",
    channelId: "canal-vencido",
    resourceId: "r1",
  });
});

// ---------------------------------------------------------------------------
// events.list con syncToken — la paginación es lo que más importa
// ---------------------------------------------------------------------------

// Un fetch falso que devuelve una respuesta distinta por llamada, para poder
// simular varias páginas.
function mockearPaginas(paginas: { ok?: boolean; status?: number; json: unknown }[]): {
  fetch: FetchLike;
  llamadas: LlamadaRegistrada[];
} {
  const llamadas: LlamadaRegistrada[] = [];
  let i = 0;

  const fetchFalso: FetchLike = (url, init) => {
    llamadas.push({ url, init });
    const pagina = paginas[Math.min(i, paginas.length - 1)];
    i++;

    return Promise.resolve({
      ok: pagina.ok ?? true,
      status: pagina.status ?? 200,
      json: () => Promise.resolve(pagina.json),
    } as Response);
  };

  return { fetch: fetchFalso, llamadas };
}

test("listarCambios devuelve los eventos y el syncToken de una sola página", async () => {
  const { fetch, llamadas } = mockearPaginas([
    {
      json: {
        items: [
          {
            id: "evt-1",
            status: "confirmed",
            start: { dateTime: "2026-09-07T12:00:00Z" },
            end: { dateTime: "2026-09-07T13:00:00Z" },
          },
        ],
        nextSyncToken: "token-nuevo",
      },
    },
  ]);

  const cambios = await crearClienteGoogleCalendar({ ...CONFIG, fetch }).listarCambios({
    accessToken: "abc",
    calendarId: "primary",
    timezone: "UTC",
    syncToken: "token-viejo",
  });

  assert.equal(cambios.eventos.length, 1);
  assert.equal(cambios.eventos[0].id, "evt-1");
  assert.equal(cambios.eventos[0].inicio?.toISOString(), "2026-09-07T12:00:00.000Z");
  assert.equal(cambios.nextSyncToken, "token-nuevo");

  assert.ok(llamadas[0].url.includes("syncToken=token-viejo"));
});

test("PAGINA hasta agotar nextPageToken y toma el syncToken de la ÚLTIMA página", async () => {
  // EL TEST MÁS IMPORTANTE DE ESTE ARCHIVO. Textual en la guía de sync de Google:
  // "the nextSyncToken field is present only on the last page".
  //
  // Si esta función se quedara con la primera página, se guardaría un syncToken
  // inexistente (o ninguno) y la próxima sincronización arrancaría con un HUECO
  // INVISIBLE: eventos que cambiaron y que nadie va a procesar nunca. Sin error,
  // sin log, sin síntoma.
  const { fetch, llamadas } = mockearPaginas([
    { json: { items: [{ id: "evt-1" }], nextPageToken: "pag-2" } },
    { json: { items: [{ id: "evt-2" }], nextPageToken: "pag-3" } },
    { json: { items: [{ id: "evt-3" }], nextSyncToken: "token-final" } },
  ]);

  const cambios = await crearClienteGoogleCalendar({ ...CONFIG, fetch }).listarCambios({
    accessToken: "abc",
    calendarId: "primary",
    timezone: "UTC",
    syncToken: "token-viejo",
  });

  assert.equal(llamadas.length, 3, "tiene que pedir las tres páginas");
  assert.deepEqual(
    cambios.eventos.map((e) => e.id),
    ["evt-1", "evt-2", "evt-3"],
    "y acumular los eventos de TODAS",
  );
  assert.equal(cambios.nextSyncToken, "token-final");

  // Las páginas 2 y 3 se piden con el pageToken correspondiente.
  assert.ok(llamadas[1].url.includes("pageToken=pag-2"));
  assert.ok(llamadas[2].url.includes("pageToken=pag-3"));
});

test("si ninguna página trae nextSyncToken, no se inventa uno", async () => {
  // Preferible reprocesar en la próxima notificación a guardar un token que no
  // existe.
  const { fetch } = mockearPaginas([{ json: { items: [{ id: "evt-1" }] } }]);

  const cambios = await crearClienteGoogleCalendar({ ...CONFIG, fetch }).listarCambios({
    accessToken: "abc",
    calendarId: "primary",
    timezone: "UTC",
  });

  assert.equal(cambios.nextSyncToken, undefined);
});

test("una sincronización COMPLETA no manda syncToken", async () => {
  const { fetch, llamadas } = mockearPaginas([{ json: { items: [], nextSyncToken: "t1" } }]);

  await crearClienteGoogleCalendar({ ...CONFIG, fetch }).listarCambios({
    accessToken: "abc",
    calendarId: "primary",
    timezone: "UTC",
  });

  assert.ok(!llamadas[0].url.includes("syncToken"));
});

test("un 410 lanza GoogleSyncTokenInvalidoError, distinguible de cualquier otro fallo", async () => {
  // Es RECUPERABLE: la respuesta correcta es volver a llamar sin syncToken. Si
  // fuera un GoogleAuthError sería indistinguible de un Google caído y la
  // conexión se quedaría con un token muerto para siempre.
  const { fetch } = mockearPaginas([
    { ok: false, status: 410, json: { error: { message: "Sync token is no longer valid" } } },
  ]);

  await assert.rejects(
    () =>
      crearClienteGoogleCalendar({ ...CONFIG, fetch }).listarCambios({
        accessToken: "abc",
        calendarId: "primary",
        timezone: "UTC",
        syncToken: "vencido",
      }),
    (err: unknown) => err instanceof GoogleSyncTokenInvalidoError && err.statusCode === 410,
  );
});

test("un evento CANCELADO llega con status cancelled y se preserva", async () => {
  const { fetch } = mockearPaginas([
    { json: { items: [{ id: "evt-borrado", status: "cancelled" }], nextSyncToken: "t" } },
  ]);

  const cambios = await crearClienteGoogleCalendar({ ...CONFIG, fetch }).listarCambios({
    accessToken: "abc",
    calendarId: "primary",
    timezone: "UTC",
    syncToken: "t0",
  });

  assert.equal(cambios.eventos[0].status, "cancelled");
  assert.equal(cambios.eventos[0].inicio, undefined, "un evento borrado no trae horario");
});

test("un evento de DÍA COMPLETO (date en vez de dateTime) se lee como medianoche EN LA ZONA DE LA SUCURSAL", async () => {
  // B-6 de docs/auditoria-2026-08-29.md: `new Date("2026-09-07")` es medianoche
  // UTC por especificación, sin importar dónde esté la sucursal. En Buenos Aires
  // (UTC-3, sin horario de verano) la medianoche del 7 es las 03:00Z del 7 — y
  // la lectura vieja daba las 21:00 del 6, hora local.
  const { fetch } = mockearPaginas([
    {
      json: {
        items: [
          {
            id: "evt-dia",
            status: "confirmed",
            start: { date: "2026-09-07" },
            end: { date: "2026-09-08" },
          },
        ],
        nextSyncToken: "t",
      },
    },
  ]);

  const cambios = await crearClienteGoogleCalendar({ ...CONFIG, fetch }).listarCambios({
    accessToken: "abc",
    calendarId: "primary",
    timezone: "America/Argentina/Buenos_Aires",
    syncToken: "t0",
  });

  assert.equal(cambios.eventos[0].inicio?.toISOString(), "2026-09-07T03:00:00.000Z");
  assert.equal(cambios.eventos[0].fin?.toISOString(), "2026-09-08T03:00:00.000Z");
});

test("un evento de DÍA COMPLETO con una zona inválida queda sin horario en vez de romper", async () => {
  const { fetch } = mockearPaginas([
    { json: { items: [{ id: "evt-dia", start: { date: "2026-09-07" } }], nextSyncToken: "t" } },
  ]);

  const cambios = await crearClienteGoogleCalendar({ ...CONFIG, fetch }).listarCambios({
    accessToken: "abc",
    calendarId: "primary",
    timezone: "Marte/Olympus_Mons",
    syncToken: "t0",
  });

  assert.equal(cambios.eventos[0].id, "evt-dia");
  assert.equal(cambios.eventos[0].inicio, undefined);
});

test("un item sin id se descarta en vez de romper la lista", async () => {
  const { fetch } = mockearPaginas([
    { json: { items: [{ status: "confirmed" }, { id: "evt-ok" }], nextSyncToken: "t" } },
  ]);

  const cambios = await crearClienteGoogleCalendar({ ...CONFIG, fetch }).listarCambios({
    accessToken: "abc",
    calendarId: "primary",
    timezone: "UTC",
    syncToken: "t0",
  });

  assert.deepEqual(
    cambios.eventos.map((e) => e.id),
    ["evt-ok"],
  );
});

// ---------------------------------------------------------------------------
// timeMin — M-3 de docs/auditoria-2026-08-29.md: la sincronización COMPLETA se
// acota, y el límite viaja en TODAS las páginas.
// ---------------------------------------------------------------------------

const TIME_MIN = "2026-08-30T12:00:00.000Z";

test("una sincronización COMPLETA con timeMin lo manda en la URL, y no manda syncToken", async () => {
  const { fetch, llamadas } = mockearPaginas([{ json: { items: [], nextSyncToken: "t1" } }]);

  await crearClienteGoogleCalendar({ ...CONFIG, fetch }).listarCambios({
    accessToken: "abc",
    calendarId: "primary",
    timezone: "UTC",
    timeMin: TIME_MIN,
  });

  assert.equal(llamadas.length, 1);
  assert.ok(llamadas[0].url.includes(`timeMin=${encodeURIComponent(TIME_MIN)}`));
  assert.ok(!llamadas[0].url.includes("syncToken"));
});

test("una sincronización INCREMENTAL manda syncToken y no manda timeMin", async () => {
  const { fetch, llamadas } = mockearPaginas([{ json: { items: [], nextSyncToken: "t1" } }]);

  await crearClienteGoogleCalendar({ ...CONFIG, fetch }).listarCambios({
    accessToken: "abc",
    calendarId: "primary",
    timezone: "UTC",
    syncToken: "token-viejo",
  });

  assert.ok(llamadas[0].url.includes("syncToken=token-viejo"));
  assert.ok(!llamadas[0].url.includes("timeMin"));
});

test("timeMin se repite en CADA página de una sincronización completa paginada", async () => {
  // Es la parte que se rompe si timeMin se agrega antes del `for` en vez de
  // adentro: Google no recuerda el límite desde el pageToken, así que una
  // página 2 sin timeMin volvería a traer el calendario entero.
  const { fetch, llamadas } = mockearPaginas([
    { json: { items: [{ id: "evt-1" }], nextPageToken: "pag-2" } },
    { json: { items: [{ id: "evt-2" }], nextPageToken: "pag-3" } },
    { json: { items: [{ id: "evt-3" }], nextSyncToken: "t-final" } },
  ]);

  const cambios = await crearClienteGoogleCalendar({ ...CONFIG, fetch }).listarCambios({
    accessToken: "abc",
    calendarId: "primary",
    timezone: "UTC",
    timeMin: TIME_MIN,
  });

  assert.equal(llamadas.length, 3);
  for (const [indice, llamada] of llamadas.entries()) {
    assert.ok(
      llamada.url.includes(`timeMin=${encodeURIComponent(TIME_MIN)}`),
      `la página ${String(indice + 1)} tiene que llevar timeMin`,
    );
    assert.ok(!llamada.url.includes("syncToken"));
  }
  assert.ok(llamadas[1].url.includes("pageToken=pag-2"));
  assert.ok(llamadas[2].url.includes("pageToken=pag-3"));
  assert.equal(cambios.nextSyncToken, "t-final");
});

test("syncToken y timeMin juntos es un bug del llamador y revienta ANTES de pedirle nada a Google", async () => {
  const { fetch, llamadas } = mockearPaginas([{ json: { items: [] } }]);

  await assert.rejects(
    crearClienteGoogleCalendar({ ...CONFIG, fetch }).listarCambios({
      accessToken: "abc",
      calendarId: "primary",
      timezone: "UTC",
      syncToken: "t0",
      timeMin: TIME_MIN,
    }),
    /mutuamente excluyentes/,
  );

  assert.equal(llamadas.length, 0, "no llegó a hacer ningún request");
});
