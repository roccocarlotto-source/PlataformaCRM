import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GOOGLE_CALENDAR_SCOPES,
  GOOGLE_CALENDAR_SCOPE_LISTA_DE_CALENDARIOS,
  GoogleScopeInsuficienteError,
  crearClienteGoogleCalendar,
  scopesDeConexion,
  type FetchLike,
} from "../services/googleCalendar.service";

// ---------------------------------------------------------------------------
// Un calendario de Google por profesional (docs/rubros.md §4.6, R8). Sin red ni
// base: los scopes por rubro, la URL de autorización y calendarList.list.
// ---------------------------------------------------------------------------

const CONFIG = {
  clientId: "client-id-de-prueba.apps.googleusercontent.com",
  clientSecret: "secreto-de-prueba",
  redirectUri: "https://api.example.com/api/integrations/google-calendar/callback",
};

function parametros(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

test("scopesDeConexion: AUTOMOTORA (y sin rubro) los dos de siempre; CLINICA suma la lista de calendarios", () => {
  assert.deepEqual(scopesDeConexion(), GOOGLE_CALENDAR_SCOPES);
  assert.deepEqual(scopesDeConexion("AUTOMOTORA"), GOOGLE_CALENDAR_SCOPES);
  assert.deepEqual(scopesDeConexion("CLINICA"), [
    ...GOOGLE_CALENDAR_SCOPES,
    GOOGLE_CALENDAR_SCOPE_LISTA_DE_CALENDARIOS,
  ]);
  for (const industry of ["AUTOMOTORA", "CLINICA"] as const) {
    const scopes = scopesDeConexion(industry);
    assert.ok(!scopes.includes("https://www.googleapis.com/auth/calendar"), industry);
    assert.ok(!scopes.includes("https://www.googleapis.com/auth/calendar.readonly"), industry);
  }
});

test("la URL de una automotora es idéntica con o sin el rubro; la de una clínica pide la lista e include_granted_scopes", () => {
  const cliente = crearClienteGoogleCalendar(CONFIG);
  const deSiempre = cliente.construirUrlDeAutorizacion("state-de-prueba");
  assert.equal(cliente.construirUrlDeAutorizacion("state-de-prueba", "AUTOMOTORA"), deSiempre);
  assert.equal(parametros(deSiempre).get("include_granted_scopes"), null);

  const deClinica = parametros(cliente.construirUrlDeAutorizacion("state-de-prueba", "CLINICA"));
  assert.deepEqual(deClinica.get("scope")?.split(" "), [
    ...GOOGLE_CALENDAR_SCOPES,
    GOOGLE_CALENDAR_SCOPE_LISTA_DE_CALENDARIOS,
  ]);
  assert.equal(deClinica.get("include_granted_scopes"), "true");
  // Lo demás es lo de siempre: refresh token y consentimiento.
  assert.equal(deClinica.get("access_type"), "offline");
  assert.equal(deClinica.get("prompt"), "consent");
});

test("listarCalendarios: pide minAccessRole=writer, pagina y devuelve id, summary y accessRole", async () => {
  const urls: string[] = [];
  const fetch: FetchLike = (url) => {
    urls.push(url);
    const segunda = url.includes("pageToken=p2");
    return Promise.resolve(
      new Response(
        JSON.stringify(
          segunda
            ? { items: [{ id: "cal-b", summary: "Bruno", accessRole: "writer" }] }
            : {
                items: [
                  { id: "cal-a", summary: "Ana", accessRole: "owner" },
                  { summary: "sin id" },
                ],
                nextPageToken: "p2",
              },
        ),
        { status: 200 },
      ),
    );
  };
  const cliente = crearClienteGoogleCalendar({ ...CONFIG, fetch });
  const calendarios = await cliente.listarCalendarios!("access");
  assert.deepEqual(calendarios, [
    { id: "cal-a", summary: "Ana", accessRole: "owner" },
    { id: "cal-b", summary: "Bruno", accessRole: "writer" },
  ]);
  assert.ok(urls.every((u) => u.includes("minAccessRole=writer")));
  assert.equal(urls.length, 2);
});

test("listarCalendarios sin el scope de la lista (403): GoogleScopeInsuficienteError, un 409", async () => {
  const fetch: FetchLike = () =>
    Promise.resolve(
      new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED" } }), { status: 403 }),
    );
  const cliente = crearClienteGoogleCalendar({ ...CONFIG, fetch });
  await assert.rejects(
    cliente.listarCalendarios!("access"),
    (err: unknown) => err instanceof GoogleScopeInsuficienteError && err.statusCode === 409,
  );
});
