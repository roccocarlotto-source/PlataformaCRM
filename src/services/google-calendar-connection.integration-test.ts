import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { SignJWT } from "jose";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import {
  markConnectionError,
  markConnectionRevoked,
} from "../repositories/googleCalendarConnection.repository";
import { AppError } from "../utils/AppError";
import { deriveKey, getCifrador, parseMasterKey } from "../utils/encryption";
import { firmarState, verificarState } from "../utils/oauthState";
import { createBranch, deleteBranch } from "./branch.service";
import { createResource } from "./resource.service";
import {
  completarConexion,
  consultarDisponibilidad,
  desconectar,
  iniciarConexion,
  obtenerAccessToken,
  obtenerConexion,
} from "./googleCalendarConnection.service";
import {
  GoogleAuthError,
  type ClienteGoogleCalendar,
  type IntervaloOcupado,
} from "./googleCalendar.service";

// ---------------------------------------------------------------------------
// P2.1, paso 2 — la conexión OAuth con Google Calendar, contra Postgres real.
//
// GOOGLE ESTÁ MOCKEADO SIEMPRE. Ningún test de acá necesita credenciales reales
// ni sale a internet: el cliente de Google se inyecta por parámetro en cada
// llamada (el mismo hueco que usa producción para pasar el cliente real). Lo que
// SÍ es real es todo lo demás — la base, el cifrado, la firma del state, las FKs
// compuestas y el RESTRICT.
//
// Lo que se prueba acá y no se puede probar sin base:
//
//   1. El round-trip completo: se conecta, y lo que queda guardado es un token
//      CIFRADO que se puede volver a descifrar y usar.
//   2. El state inválido y el vencido — la frontera de tenant del callback.
//   3. Reconectar ACTUALIZA la fila, no crea una segunda (el UNIQUE).
//   4. El RESTRICT nuevo de deleteBranch, y que REVOKED/ERROR no bloquean.
//   5. Que el refresh token NO sale por ninguna lectura de la API.
//   6. Que invalid_grant lleva la conexión a ERROR y un fallo transitorio no.
//
// CADA TEST TRAE SU PROPIA ORGANIZACIÓN, mismo criterio que
// booking-config.integration-test.ts: el runner corre los archivos de
// integración en paralelo contra una base compartida.

const TZ = "America/Argentina/Buenos_Aires";

const REFRESH_TOKEN = "1//0eXaMpLe-refresh-token-de-google";

interface Escenario {
  organizationId: string;
}

async function montar(etiqueta: string): Promise<Escenario> {
  const org = await prisma.organization.create({
    data: {
      name: `GCal ${etiqueta} ${randomUUID()}`,
      slug: `gcal-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  return { organizationId: org.id };
}

async function desmontar(escenario: Escenario) {
  await prisma.googleCalendarConnection.deleteMany({
    where: { organizationId: escenario.organizationId },
  });
  await prisma.serviceType.deleteMany({ where: { organizationId: escenario.organizationId } });
  await prisma.resource.deleteMany({ where: { organizationId: escenario.organizationId } });
  await prisma.branch.deleteMany({ where: { organizationId: escenario.organizationId } });
  await prisma.organization.delete({ where: { id: escenario.organizationId } });
}

function assertAppError(err: unknown, statusCode: number) {
  assert.ok(err instanceof AppError, `debe ser AppError, no un error crudo. Fue: ${String(err)}`);
  assert.equal(err.statusCode, statusCode);
}

async function capturar(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  assert.fail("se esperaba un error y no hubo ninguno");
}

// ---------------------------------------------------------------------------
// El doble de Google. Solo implementa lo que el service llama, y cada test le
// dice cómo comportarse.
// ---------------------------------------------------------------------------

interface OpcionesDelDoble {
  refreshToken?: string | undefined;
  ocupados?: IntervaloOcupado[];
  fallaAlRenovar?: GoogleAuthError;
  fallaAlRevocar?: Error;
  fallaAlConsultar?: GoogleAuthError;
  // B-2: lo que devuelve renovarAccessToken. El TTL corto es la forma de
  // probar el vencimiento del cache sin temporizadores reales.
  accessTokenRenovado?: string;
  expiraEnSegundos?: number;
}

interface Doble {
  cliente: ClienteGoogleCalendar;
  revocados: string[];
  // B-2: los refresh tokens con los que se pidió renovar, en orden. Su largo es
  // cuántas veces se fue a Google.
  renovados: string[];
}

function doblarGoogle(opciones: OpcionesDelDoble = {}): Doble {
  const revocados: string[] = [];
  const renovados: string[] = [];

  const cliente: ClienteGoogleCalendar = {
    construirUrlDeAutorizacion: (state) => `https://accounts.google.com/fake?state=${state}`,

    intercambiarCodigo: () =>
      Promise.resolve({
        refreshToken: "refreshToken" in opciones ? opciones.refreshToken : REFRESH_TOKEN,
        accessToken: "access-token-de-prueba",
        expiraEnSegundos: 3599,
        scope: "",
      }),

    renovarAccessToken: (refreshToken) => {
      renovados.push(refreshToken);
      return opciones.fallaAlRenovar
        ? Promise.reject(opciones.fallaAlRenovar)
        : Promise.resolve({
            accessToken: opciones.accessTokenRenovado ?? "access-token-renovado",
            expiraEnSegundos: opciones.expiraEnSegundos ?? 3599,
            scope: "",
          });
    },

    revocarToken: (token) => {
      if (opciones.fallaAlRevocar) {
        return Promise.reject(opciones.fallaAlRevocar);
      }
      revocados.push(token);
      return Promise.resolve();
    },

    consultarFreeBusy: () =>
      opciones.fallaAlConsultar
        ? Promise.reject(opciones.fallaAlConsultar)
        : Promise.resolve(opciones.ocupados ?? []),

    // Agregados en el paso 3 (Booking). Este archivo no los ejercita —lo hace
    // booking.integration-test.ts— pero la interfaz los exige, y dejarlos
    // lanzando es lo correcto: si algún test de acá terminara llamándolos, el
    // fallo dice qué pasó en vez de devolver un valor inventado que se cuela.
    crearEvento: () => Promise.reject(new Error("crearEvento no se usa en este archivo")),
    eliminarEvento: () => Promise.reject(new Error("eliminarEvento no se usa en este archivo")),

    // Agregados en el paso 4 (sincronización inversa). `detenerCanal` SÍ se
    // ejercita indirectamente: desconectar() ahora lo intenta si hay canal — y
    // como estos escenarios no crean canal, no llega a llamarse. Se deja
    // registrando en vez de lanzando para que ese camino, si algún día se
    // ejercita acá, no falle por el doble.
    crearCanalDeNotificaciones: () =>
      Promise.reject(new Error("crearCanalDeNotificaciones no se usa en este archivo")),
    detenerCanal: () => Promise.resolve(),
    listarCambios: () => Promise.reject(new Error("listarCambios no se usa en este archivo")),
  };

  return { cliente, revocados, renovados };
}

// Recorre el flujo entero como lo haría un ADMIN: pide la URL, saca el state
// firmado de ahí, y completa el callback con él. Se usa en casi todos los tests
// porque probar el callback con un state fabricado a mano probaría otra cosa.
async function conectar(
  organizationId: string,
  branchId: string,
  doble: Doble,
): Promise<{ state: string }> {
  const { authorizationUrl } = await iniciarConexion(organizationId, branchId, doble.cliente);
  const state = new URL(authorizationUrl).searchParams.get("state") as string;

  await completarConexion({ state, code: "codigo-de-google" }, doble.cliente);

  return { state };
}

// ---------------------------------------------------------------------------
// 1. Camino feliz y cifrado en reposo
// ---------------------------------------------------------------------------

test("conectar una sucursal guarda el refresh token CIFRADO, y se puede volver a descifrar", async () => {
  const escenario = await montar("feliz");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    const doble = doblarGoogle();

    await conectar(escenario.organizationId, branch.id, doble);

    // Se lee la fila CRUDA, sin pasar por ningún service: lo que importa es qué
    // hay realmente en la columna.
    const fila = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: branch.id },
    });

    assert.equal(fila.status, "ACTIVE");
    assert.equal(fila.calendarId, "primary");
    assert.equal(fila.organizationId, escenario.organizationId);

    // EL TOKEN NO ESTÁ EN CLARO. Es la promesa central de este tramo, y se
    // verifica sobre el valor guardado, no sobre lo que devuelve una función.
    assert.ok(fila.refreshToken);
    assert.notEqual(fila.refreshToken, REFRESH_TOKEN);
    assert.ok(!fila.refreshToken.includes(REFRESH_TOKEN));
    assert.ok(fila.refreshToken.startsWith("v1."), "debe tener el formato de utils/encryption.ts");

    // Y ES RECUPERABLE — que es exactamente lo que un hash no daría, y por lo
    // que este módulo no pudo "seguir el criterio de ApiKey".
    assert.equal(getCifrador().decrypt(fila.refreshToken), REFRESH_TOKEN);
  } finally {
    await desmontar(escenario);
  }
});

test("el state que viaja a Google codifica la organización y la sucursal, firmadas", async () => {
  const escenario = await montar("state");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });

    const { authorizationUrl } = await iniciarConexion(
      escenario.organizationId,
      branch.id,
      doblarGoogle().cliente,
    );

    const state = new URL(authorizationUrl).searchParams.get("state") as string;

    assert.deepEqual(await verificarState(state), {
      organizationId: escenario.organizationId,
      branchId: branch.id,
    });
  } finally {
    await desmontar(escenario);
  }
});

test("iniciar la conexión sobre una sucursal de OTRA organización da 404", async () => {
  const a = await montar("iso-a");
  const b = await montar("iso-b");
  try {
    const branchDeA = await createBranch(a.organizationId, { name: "De A", timezone: TZ });

    // B pide conectar una sucursal de A. Tiene que ser indistinguible de "no
    // existe": un 403 confirmaría que ese id existe en algún lado.
    assertAppError(
      await capturar(() => iniciarConexion(b.organizationId, branchDeA.id, doblarGoogle().cliente)),
      404,
    );
  } finally {
    await desmontar(a);
    await desmontar(b);
  }
});

// ---------------------------------------------------------------------------
// 2. El state — la frontera de tenant del callback
// ---------------------------------------------------------------------------

test("el callback con un state INVÁLIDO no escribe nada", async () => {
  const escenario = await montar("state-malo");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });

    assertAppError(
      await capturar(() =>
        completarConexion(
          { state: "esto-no-es-un-state-firmado", code: "cod" },
          doblarGoogle().cliente,
        ),
      ),
      400,
    );

    // LO QUE DE VERDAD IMPORTA: no quedó ninguna fila. Un state inválido tiene
    // que morir ANTES de cualquier escritura.
    assert.equal(
      await prisma.googleCalendarConnection.count({ where: { branchId: branch.id } }),
      0,
    );
  } finally {
    await desmontar(escenario);
  }
});

test("el callback SIN state da 400", async () => {
  assertAppError(await capturar(() => completarConexion({ code: "cod" })), 400);
});

test("el callback con un state VENCIDO da 400 y no escribe nada", async () => {
  const escenario = await montar("state-vencido");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });

    // Se firma con la clave real del entorno pero con un `exp` ya pasado — el
    // mismo truco que el test unitario, para no esperar diez minutos.
    const clave = deriveKey(
      parseMasterKey(env.SECRET_ENCRYPTION_KEY as string),
      "plataforma-crm:oauth-state:v1",
    );

    const vencido = await new SignJWT({
      organizationId: escenario.organizationId,
      branchId: branch.id,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("plataforma-crm")
      .setAudience("google-calendar-oauth")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(clave);

    const err = await capturar(() =>
      completarConexion({ state: vencido, code: "cod" }, doblarGoogle().cliente),
    );

    assertAppError(err, 400);
    assert.ok((err as AppError).message.includes("expiró"));

    assert.equal(
      await prisma.googleCalendarConnection.count({ where: { branchId: branch.id } }),
      0,
    );
  } finally {
    await desmontar(escenario);
  }
});

test("un state de la organización A no puede conectar una sucursal de B", async () => {
  const a = await montar("cruce-a");
  const b = await montar("cruce-b");
  try {
    const branchDeA = await createBranch(a.organizationId, { name: "De A", timezone: TZ });
    const branchDeB = await createBranch(b.organizationId, { name: "De B", timezone: TZ });

    // A inicia legítimamente su propio flujo.
    const { authorizationUrl } = await iniciarConexion(
      a.organizationId,
      branchDeA.id,
      doblarGoogle().cliente,
    );
    const stateDeA = new URL(authorizationUrl).searchParams.get("state") as string;

    // Y completa el callback con su state válido. Lo que se verifica es que la
    // conexión aterriza en LA SUCURSAL DEL STATE y en ninguna otra: no hay forma
    // de dirigirla a branchDeB, porque el destino no viene de la query string
    // sino del token firmado.
    await completarConexion({ state: stateDeA, code: "cod" }, doblarGoogle().cliente);

    assert.equal(
      await prisma.googleCalendarConnection.count({ where: { branchId: branchDeA.id } }),
      1,
    );
    assert.equal(
      await prisma.googleCalendarConnection.count({ where: { branchId: branchDeB.id } }),
      0,
    );
  } finally {
    await desmontar(a);
    await desmontar(b);
  }
});

test("si Google no devuelve refresh token, no se guarda una conexión a medias", async () => {
  const escenario = await montar("sin-refresh");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    const doble = doblarGoogle({ refreshToken: undefined });

    const { authorizationUrl } = await iniciarConexion(
      escenario.organizationId,
      branch.id,
      doble.cliente,
    );
    const state = new URL(authorizationUrl).searchParams.get("state") as string;

    assertAppError(
      await capturar(() => completarConexion({ state, code: "cod" }, doble.cliente)),
      502,
    );

    // Sin refresh token la integración se moriría sola en una hora. Mejor no
    // tener fila que tener una que dice ACTIVE y no sirve.
    assert.equal(
      await prisma.googleCalendarConnection.count({ where: { branchId: branch.id } }),
      0,
    );
  } finally {
    await desmontar(escenario);
  }
});

test("si el usuario cancela en Google, no se escribe nada", async () => {
  const escenario = await montar("cancelado");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    const state = await firmarState({
      organizationId: escenario.organizationId,
      branchId: branch.id,
    });

    const err = await capturar(() => completarConexion({ state, error: "access_denied" }));

    assertAppError(err, 400);
    assert.ok((err as AppError).message.includes("canceló"));
    assert.equal(
      await prisma.googleCalendarConnection.count({ where: { branchId: branch.id } }),
      0,
    );
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// 3. Reconexión — el invariante de "una conexión por sucursal"
// ---------------------------------------------------------------------------

test("reconectar una sucursal ACTUALIZA su fila, no crea una segunda", async () => {
  const escenario = await montar("reconectar");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });

    await conectar(escenario.organizationId, branch.id, doblarGoogle());
    const primera = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: branch.id },
    });

    // Se desconecta y se vuelve a conectar con un token distinto.
    await desconectar(escenario.organizationId, branch.id, doblarGoogle().cliente);
    await conectar(
      escenario.organizationId,
      branch.id,
      doblarGoogle({ refreshToken: "1//token-nuevo" }),
    );

    const filas = await prisma.googleCalendarConnection.findMany({
      where: { branchId: branch.id },
    });

    assert.equal(filas.length, 1, "branchId es único: no puede haber dos conexiones");
    assert.equal(filas[0].id, primera.id, "es LA MISMA fila, actualizada");
    assert.equal(filas[0].status, "ACTIVE");
    assert.equal(getCifrador().decrypt(filas[0].refreshToken as string), "1//token-nuevo");

    // createdAt no se toca (cuándo conectó por primera vez); connectedAt sí
    // (cuándo vale el token que hay ahora).
    assert.equal(filas[0].createdAt.getTime(), primera.createdAt.getTime());
    assert.ok(filas[0].connectedAt.getTime() >= primera.connectedAt.getTime());
  } finally {
    await desmontar(escenario);
  }
});

test("reconectar una sucursal en ERROR la vuelve a ACTIVE y limpia el motivo", async () => {
  const escenario = await montar("reconectar-error");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    await conectar(escenario.organizationId, branch.id, doblarGoogle());

    // Google rechaza el grant: la conexión cae a ERROR con su motivo.
    const roto = doblarGoogle({
      fallaAlRenovar: new GoogleAuthError("Google rechazó la solicitud (invalid_grant)", true),
    });
    await capturar(() => obtenerAccessToken(escenario.organizationId, branch.id, roto.cliente));

    const enError = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: branch.id },
    });
    assert.equal(enError.status, "ERROR");
    assert.ok(enError.lastErrorMessage);

    // Reconectar es lo que resuelve el ERROR. Dejar el motivo viejo colgando
    // haría que una conexión sana se lea como rota.
    await conectar(escenario.organizationId, branch.id, doblarGoogle());

    const reconectada = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: branch.id },
    });
    assert.equal(reconectada.status, "ACTIVE");
    assert.equal(reconectada.lastErrorMessage, null);
    assert.equal(reconectada.lastErrorAt, null);
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// 4. Desconexión
// ---------------------------------------------------------------------------

test("desconectar revoca contra Google, deja REVOKED y BORRA el token", async () => {
  const escenario = await montar("desconectar");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    await conectar(escenario.organizationId, branch.id, doblarGoogle());

    const doble = doblarGoogle();
    await desconectar(escenario.organizationId, branch.id, doble.cliente);

    // Se le mandó a Google el token EN CLARO, o sea que el descifrado del camino
    // de revocación funciona de punta a punta.
    assert.deepEqual(doble.revocados, [REFRESH_TOKEN]);

    const fila = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: branch.id },
    });
    assert.equal(fila.status, "REVOKED");
    // El token se va: un volcado de la base no arrastra credenciales de
    // sucursales ya desconectadas.
    assert.equal(fila.refreshToken, null);
  } finally {
    await desmontar(escenario);
  }
});

test("si Google falla al revocar, la conexión se desconecta igual del lado del CRM", async () => {
  // Best-effort a propósito: si esto abortara, un Google caído dejaría al ADMIN
  // sin poder desconectar una integración que quizás quiere sacar con urgencia.
  const escenario = await montar("revocar-falla");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    await conectar(escenario.organizationId, branch.id, doblarGoogle());

    await desconectar(
      escenario.organizationId,
      branch.id,
      doblarGoogle({ fallaAlRevocar: new Error("Google caído") }).cliente,
    );

    const fila = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: branch.id },
    });
    assert.equal(fila.status, "REVOKED");
    assert.equal(fila.refreshToken, null);
  } finally {
    await desmontar(escenario);
  }
});

test("desconectar dos veces da 409, no un no-op silencioso", async () => {
  const escenario = await montar("desconectar-2x");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    await conectar(escenario.organizationId, branch.id, doblarGoogle());

    await desconectar(escenario.organizationId, branch.id, doblarGoogle().cliente);

    assertAppError(
      await capturar(() =>
        desconectar(escenario.organizationId, branch.id, doblarGoogle().cliente),
      ),
      409,
    );
  } finally {
    await desmontar(escenario);
  }
});

test("desconectar una sucursal que nunca conectó da 404", async () => {
  const escenario = await montar("desconectar-404");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });

    assertAppError(
      await capturar(() =>
        desconectar(escenario.organizationId, branch.id, doblarGoogle().cliente),
      ),
      404,
    );
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// 5. El refresh token NO sale por la API
// ---------------------------------------------------------------------------

test("obtenerConexion NUNCA devuelve el refresh token, ni cifrado", async () => {
  const escenario = await montar("no-filtra");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    await conectar(escenario.organizationId, branch.id, doblarGoogle());

    const conexion = await obtenerConexion(escenario.organizationId, branch.id);

    // Se afirma sobre el JSON SERIALIZADO y no campo por campo, mismo criterio
    // que el test de ApiKey: si un refactor agregara el token en cualquier lugar
    // del payload —anidado, con otro nombre— esto lo ve igual.
    const serializado = JSON.stringify(conexion);

    assert.ok(!serializado.includes(REFRESH_TOKEN), "el token en claro no puede salir");
    assert.ok(!serializado.includes("refreshToken"), "ni siquiera el campo cifrado");
    assert.ok(!serializado.includes("v1."), "ni el ciphertext");

    // Y sí devuelve lo que tiene que devolver.
    assert.equal(conexion.status, "ACTIVE");
    assert.equal(conexion.branchId, branch.id);
  } finally {
    await desmontar(escenario);
  }
});

test("obtenerConexion de una sucursal de otra organización da 404", async () => {
  const a = await montar("leer-a");
  const b = await montar("leer-b");
  try {
    const branchDeA = await createBranch(a.organizationId, { name: "De A", timezone: TZ });
    await conectar(a.organizationId, branchDeA.id, doblarGoogle());

    assertAppError(await capturar(() => obtenerConexion(b.organizationId, branchDeA.id)), 404);
  } finally {
    await desmontar(a);
    await desmontar(b);
  }
});

// ---------------------------------------------------------------------------
// 6. Manejo de errores: qué degrada la conexión y qué no
// ---------------------------------------------------------------------------

test("invalid_grant lleva la conexión a ERROR y deja el motivo registrado", async () => {
  const escenario = await montar("invalid-grant");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    await conectar(escenario.organizationId, branch.id, doblarGoogle());

    const roto = doblarGoogle({
      fallaAlRenovar: new GoogleAuthError(
        "Google rechazó la solicitud (invalid_grant: Token has been expired or revoked.)",
        true,
      ),
    });

    assertAppError(
      await capturar(() => obtenerAccessToken(escenario.organizationId, branch.id, roto.cliente)),
      409,
    );

    const fila = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: branch.id },
    });

    assert.equal(fila.status, "ERROR");
    assert.ok(fila.lastErrorAt);
    // No hay mecanismo de aviso al admin todavía, así que el motivo en la fila
    // ES la notificación — tiene que decir algo accionable.
    assert.ok(fila.lastErrorMessage?.includes("invalid_grant"));

    // El token SE CONSERVA en ERROR (a diferencia de REVOKED): puede ser algo
    // que se resuelva del lado de Google.
    assert.notEqual(fila.refreshToken, null);
  } finally {
    await desmontar(escenario);
  }
});

test("un fallo TRANSITORIO de Google NO degrada la conexión", async () => {
  // La distinción central del manejo de errores: si un 500 de Google marcara
  // ERROR, un incidente suyo dejaría a todos los negocios teniendo que
  // reconectar a mano.
  const escenario = await montar("transitorio");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    await conectar(escenario.organizationId, branch.id, doblarGoogle());

    const caido = doblarGoogle({
      fallaAlRenovar: new GoogleAuthError("No se pudo contactar a Google: ETIMEDOUT", false),
    });

    await capturar(() => obtenerAccessToken(escenario.organizationId, branch.id, caido.cliente));

    const fila = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: branch.id },
    });

    assert.equal(fila.status, "ACTIVE", "un Google caído no rompe una conexión sana");
    assert.equal(fila.lastErrorMessage, null);
  } finally {
    await desmontar(escenario);
  }
});

test("no se puede pedir un access token de una conexión REVOKED", async () => {
  const escenario = await montar("token-revocada");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    await conectar(escenario.organizationId, branch.id, doblarGoogle());
    await desconectar(escenario.organizationId, branch.id, doblarGoogle().cliente);

    assertAppError(
      await capturar(() =>
        obtenerAccessToken(escenario.organizationId, branch.id, doblarGoogle().cliente),
      ),
      409,
    );
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// 7. freebusy de punta a punta (con Google mockeado)
// ---------------------------------------------------------------------------

test("consultarDisponibilidad descifra, renueva y devuelve los intervalos ocupados", async () => {
  // Ata las piezas: fila -> descifrado -> renovación -> llamada a Google. Es lo
  // que verifica que el cliente aislado y el service de base encajan de verdad.
  const escenario = await montar("freebusy");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    await conectar(escenario.organizationId, branch.id, doblarGoogle());

    const ocupados = await consultarDisponibilidad(
      escenario.organizationId,
      branch.id,
      { timeMin: "2026-09-01T00:00:00-03:00", timeMax: "2026-09-02T00:00:00-03:00" },
      doblarGoogle({
        ocupados: [{ inicio: "2026-09-01T13:00:00Z", fin: "2026-09-01T14:00:00Z" }],
      }).cliente,
    );

    assert.deepEqual(ocupados, [{ inicio: "2026-09-01T13:00:00Z", fin: "2026-09-01T14:00:00Z" }]);
  } finally {
    await desmontar(escenario);
  }
});

test("un calendario inaccesible al consultar disponibilidad deja la conexión en ERROR", async () => {
  const escenario = await montar("freebusy-error");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    await conectar(escenario.organizationId, branch.id, doblarGoogle());

    await capturar(() =>
      consultarDisponibilidad(
        escenario.organizationId,
        branch.id,
        { timeMin: "2026-09-01T00:00:00-03:00", timeMax: "2026-09-02T00:00:00-03:00" },
        doblarGoogle({
          fallaAlConsultar: new GoogleAuthError(
            'Google no pudo leer la disponibilidad del calendario "primary" (notFound)',
            true,
          ),
        }).cliente,
      ),
    );

    const fila = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: branch.id },
    });
    assert.equal(fila.status, "ERROR");
    assert.ok(fila.lastErrorMessage?.includes("notFound"));
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// 8. El RESTRICT nuevo de deleteBranch
// ---------------------------------------------------------------------------

test("no se puede borrar una sucursal con Google Calendar conectado", async () => {
  const escenario = await montar("restrict");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    await conectar(escenario.organizationId, branch.id, doblarGoogle());

    const err = await capturar(() => deleteBranch(escenario.organizationId, branch.id));

    assertAppError(err, 400);
    assert.ok((err as AppError).message.includes("Google Calendar"));

    const persistida = await prisma.branch.findUniqueOrThrow({ where: { id: branch.id } });
    assert.equal(persistida.deletedAt, null, "la sucursal no se borró");
  } finally {
    await desmontar(escenario);
  }
});

test("una conexión REVOKED NO bloquea el borrado de la sucursal", async () => {
  const escenario = await montar("restrict-revoked");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    await conectar(escenario.organizationId, branch.id, doblarGoogle());
    await desconectar(escenario.organizationId, branch.id, doblarGoogle().cliente);

    // Ya no hay nada conectado que se pueda perder: exigir limpiar la fila sería
    // un trámite sin contenido.
    await deleteBranch(escenario.organizationId, branch.id);

    const persistida = await prisma.branch.findUniqueOrThrow({ where: { id: branch.id } });
    assert.notEqual(persistida.deletedAt, null);
  } finally {
    await desmontar(escenario);
  }
});

test("una conexión en ERROR tampoco bloquea el borrado", async () => {
  const escenario = await montar("restrict-error");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    await conectar(escenario.organizationId, branch.id, doblarGoogle());

    await capturar(() =>
      obtenerAccessToken(
        escenario.organizationId,
        branch.id,
        doblarGoogle({
          fallaAlRenovar: new GoogleAuthError("invalid_grant", true),
        }).cliente,
      ),
    );

    await deleteBranch(escenario.organizationId, branch.id);

    const persistida = await prisma.branch.findUniqueOrThrow({ where: { id: branch.id } });
    assert.notEqual(persistida.deletedAt, null);
  } finally {
    await desmontar(escenario);
  }
});

test("el RESTRICT de recursos sigue disparando ANTES que el de Google Calendar", async () => {
  // Los tres mensajes son excluyentes, así que el orden decide cuál ve el ADMIN.
  // Recursos y servicios hay que migrarlos o borrarlos a mano; desconectar
  // Google es un click. Empezar por lo caro evita que alguien desconecte Google
  // para descubrir recién ahí que igual no puede borrar la sucursal.
  const escenario = await montar("restrict-orden");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    await createResource(escenario.organizationId, {
      branchId: branch.id,
      name: "Juan",
      type: "PERSON",
    });
    await conectar(escenario.organizationId, branch.id, doblarGoogle());

    const err = await capturar(() => deleteBranch(escenario.organizationId, branch.id));

    assertAppError(err, 400);
    assert.ok((err as AppError).message.includes("recursos activos"));
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// 9. El invariante de la base
// ---------------------------------------------------------------------------

test("la base RECHAZA una conexión ACTIVE sin refresh token", async () => {
  // El CHECK de la migración. Es la defensa que sobrevive a un camino de
  // escritura que no pase por el service — un script, un seed, un worker futuro.
  const escenario = await montar("check");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });

    await assert.rejects(
      () =>
        prisma.googleCalendarConnection.create({
          data: {
            organizationId: escenario.organizationId,
            branchId: branch.id,
            refreshToken: null,
            status: "ACTIVE",
          },
        }),
      /active_requires_token/,
    );
  } finally {
    await desmontar(escenario);
  }
});

test("la base RECHAZA una segunda conexión para la misma sucursal", async () => {
  const escenario = await montar("unique");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    await conectar(escenario.organizationId, branch.id, doblarGoogle());

    await assert.rejects(() =>
      prisma.googleCalendarConnection.create({
        data: {
          organizationId: escenario.organizationId,
          branchId: branch.id,
          refreshToken: "otro",
          status: "ACTIVE",
        },
      }),
    );
  } finally {
    await desmontar(escenario);
  }
});

test("la FK compuesta rechaza una conexión cuya organización no es la de su sucursal", async () => {
  // El estándar de C-3: Postgres verifica a nivel motor que no se pueda cruzar
  // una sucursal de otra organización, aunque el código lo intente.
  const a = await montar("fk-a");
  const b = await montar("fk-b");
  try {
    const branchDeA = await createBranch(a.organizationId, { name: "De A", timezone: TZ });

    await assert.rejects(() =>
      prisma.googleCalendarConnection.create({
        data: {
          organizationId: b.organizationId,
          branchId: branchDeA.id,
          refreshToken: "x",
          status: "ACTIVE",
        },
      }),
    );
  } finally {
    await desmontar(a);
    await desmontar(b);
  }
});

// ---------------------------------------------------------------------------
// B-3 de docs/auditoria-2026-08-29.md — reconectar resetea el estado de
// sincronización. A diferencia de B-16, este era un camino alcanzable: tras
// reconectar con OTRA cuenta de Google, el syncToken ajeno daba 410 en el
// primer sync y el canal viejo —con vencimiento lejano— dejaba a la sucursal
// hasta 7 días sin notificaciones push (findConnectionsNeedingChannel no la
// veía como necesitada de canal).
// ---------------------------------------------------------------------------

test("B-3: reconectar con OTRA cuenta resetea syncToken y el canal — nada del calendario viejo sobrevive", async () => {
  const escenario = await montar("b3-reconectar");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    await conectar(escenario.organizationId, branch.id, doblarGoogle());

    // El estado que deja una conexión que ya sincronizó: token y canal de la
    // cuenta A. Directo en la fila — lo que se prueba es el reseteo, no cómo
    // se originaron (los produce el flujo del paso 4, ajeno a este archivo).
    await prisma.googleCalendarConnection.updateMany({
      where: { branchId: branch.id, organizationId: escenario.organizationId },
      data: {
        syncToken: "sync-token-de-la-cuenta-a",
        channelId: randomUUID(),
        channelResourceId: "r-cuenta-a",
        channelExpiration: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
      },
    });

    // La caída a ERROR que precede a la reconexión en el camino real: Google
    // rechaza el grant. markConnectionError conserva syncToken y canal (fuera
    // del alcance de B-3), que es justamente la premisa del bug.
    const roto = doblarGoogle({
      fallaAlRenovar: new GoogleAuthError("Google rechazó la solicitud (invalid_grant)", true),
    });
    await capturar(() => obtenerAccessToken(escenario.organizationId, branch.id, roto.cliente));

    // Reconexión con otra cuenta: otro refresh token.
    await conectar(
      escenario.organizationId,
      branch.id,
      doblarGoogle({ refreshToken: "1//token-de-otra-cuenta" }),
    );

    const fila = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: branch.id },
    });
    assert.equal(fila.status, "ACTIVE");
    assert.equal(getCifrador().decrypt(fila.refreshToken as string), "1//token-de-otra-cuenta");
    assert.equal(fila.syncToken, null, "el syncToken de la cuenta vieja daría 410");
    assert.equal(fila.channelId, null, "el canal viejo bloquearía uno nuevo hasta vencer");
    assert.equal(fila.channelResourceId, null);
    assert.equal(fila.channelExpiration, null);
  } finally {
    await desmontar(escenario);
  }
});

test("B-3 (repository): markConnectionRevoked limpia también syncToken y el canal, sin depender de clearConnectionChannel", async () => {
  const escenario = await montar("b3-revoked");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    await conectar(escenario.organizationId, branch.id, doblarGoogle());
    await prisma.googleCalendarConnection.updateMany({
      where: { branchId: branch.id, organizationId: escenario.organizationId },
      data: {
        syncToken: "sync-token-vivo",
        channelId: randomUUID(),
        channelResourceId: "r-vivo",
        channelExpiration: new Date(Date.now() + 86_400_000),
      },
    });

    // Directo al repository, sin pasar por desconectar(): lo que se prueba es
    // que ESTA escritura alcanza sola. Cuando se escribió, el service además
    // llamaba a clearConnectionChannel justo después (redundancia deliberada);
    // B-8 sacó esa segunda llamada apoyándose en este mismo test, que es la
    // prueba de que no hacía falta.
    const resultado = await markConnectionRevoked(branch.id, escenario.organizationId);
    assert.equal(resultado.count, 1);

    const fila = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: branch.id },
    });
    assert.equal(fila.status, "REVOKED");
    assert.equal(fila.refreshToken, null);
    assert.equal(fila.syncToken, null);
    assert.equal(fila.channelId, null);
    assert.equal(fila.channelResourceId, null);
    assert.equal(fila.channelExpiration, null);
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// 10. B-2 (docs/auditoria-2026-08-29.md) — el cache del access token
//
// obtenerAccessToken renovaba contra Google en CADA llamada. Ahora reusa el
// token mientras esté vigente, y solo eso: la lectura fresca de la fila y el
// chequeo de status siguen corriendo siempre. El cache vive en memoria del
// módulo y cada test usa su propia sucursal, así que no se pisan entre sí.
// ---------------------------------------------------------------------------

test("B-2: dos llamadas seguidas con el token vigente van a Google UNA sola vez", async () => {
  const escenario = await montar("b2-hit");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    await conectar(escenario.organizationId, branch.id, doblarGoogle());

    const doble = doblarGoogle();
    const primera = await obtenerAccessToken(escenario.organizationId, branch.id, doble.cliente);
    const segunda = await obtenerAccessToken(escenario.organizationId, branch.id, doble.cliente);

    assert.equal(doble.renovados.length, 1, "la segunda llamada no fue a Google");
    assert.equal(primera.accessToken, segunda.accessToken);
    assert.equal(segunda.calendarId, "primary");
  } finally {
    await desmontar(escenario);
  }
});

test("B-2: un token vencido se vuelve a pedir, y el nuevo queda cacheado", async () => {
  const escenario = await montar("b2-vencido");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    await conectar(escenario.organizationId, branch.id, doblarGoogle());

    // 30 segundos de vida: con el minuto de margen de seguridad, la entrada
    // nace vencida — sin esperar nada.
    const efimero = doblarGoogle({ accessTokenRenovado: "access-efimero", expiraEnSegundos: 30 });
    const primera = await obtenerAccessToken(escenario.organizationId, branch.id, efimero.cliente);
    assert.equal(primera.accessToken, "access-efimero");

    const duradero = doblarGoogle({ accessTokenRenovado: "access-duradero" });
    const segunda = await obtenerAccessToken(escenario.organizationId, branch.id, duradero.cliente);
    assert.equal(duradero.renovados.length, 1, "vencido: SÍ se volvió a Google");
    assert.equal(segunda.accessToken, "access-duradero", "y no se entregó el vencido");

    const tercera = await obtenerAccessToken(escenario.organizationId, branch.id, duradero.cliente);
    assert.equal(duradero.renovados.length, 1, "el nuevo quedó cacheado");
    assert.equal(tercera.accessToken, "access-duradero");
  } finally {
    await desmontar(escenario);
  }
});

test("B-2: reconectar con otro refresh token invalida el cache sin que nadie lo limpie", async () => {
  const escenario = await montar("b2-reconectar");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    await conectar(escenario.organizationId, branch.id, doblarGoogle());

    const antes = doblarGoogle({ accessTokenRenovado: "access-de-la-cuenta-vieja" });
    await obtenerAccessToken(escenario.organizationId, branch.id, antes.cliente);
    assert.deepEqual(antes.renovados, [REFRESH_TOKEN]);

    // El flujo real de reconexión, con otra cuenta. upsertConnection no toca el
    // cache: lo que cambia es el refresh token cifrado de la fila.
    await conectar(
      escenario.organizationId,
      branch.id,
      doblarGoogle({ refreshToken: "1//token-de-otra-cuenta" }),
    );

    const despues = doblarGoogle({ accessTokenRenovado: "access-de-la-cuenta-nueva" });
    const token = await obtenerAccessToken(escenario.organizationId, branch.id, despues.cliente);

    assert.deepEqual(
      despues.renovados,
      ["1//token-de-otra-cuenta"],
      "se renovó de nuevo, y con el refresh token nuevo",
    );
    assert.equal(
      token.accessToken,
      "access-de-la-cuenta-nueva",
      "no se reusó el de la cuenta vieja",
    );
  } finally {
    await desmontar(escenario);
  }
});

test("B-2: una conexión en ERROR sigue dando 409 aunque tenga un token cacheado de cuando estaba ACTIVE", async () => {
  const escenario = await montar("b2-error");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    await conectar(escenario.organizationId, branch.id, doblarGoogle());

    const doble = doblarGoogle();
    await obtenerAccessToken(escenario.organizationId, branch.id, doble.cliente);
    assert.equal(doble.renovados.length, 1);

    await markConnectionError(branch.id, escenario.organizationId, "invalid_grant");

    assertAppError(
      await capturar(() => obtenerAccessToken(escenario.organizationId, branch.id, doble.cliente)),
      409,
    );
    assert.equal(
      doble.renovados.length,
      1,
      "ni miró el cache ni fue a Google: rebotó en el status",
    );
  } finally {
    await desmontar(escenario);
  }
});
