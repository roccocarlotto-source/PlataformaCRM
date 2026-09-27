import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, afterEach, before, mock, test } from "node:test";
import { Prisma } from "@prisma/client";
import { SignJWT } from "jose";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { AppError } from "../utils/AppError";
import {
  deriveKey,
  getCifrador,
  parseMasterKey,
  resetCifradorParaTests,
} from "../utils/encryption";
import { firmarMetaState, resetClaveDeFirmaMetaParaTests } from "../utils/metaOauthState";
import { MetaAuthError, type ClienteMetaOAuth, type PaginaAutorizada } from "./metaOAuth.service";
import {
  MENSAJE_CONEXION_INACTIVA,
  MENSAJE_PAGINA_DE_OTRA_CUENTA,
  MENSAJE_PAGINA_RECONECTADA,
  MENSAJE_SIN_CONEXION_PARA_ENVIAR,
  MENSAJE_SIN_PAGINAS,
  MENSAJE_VARIAS_PAGINAS,
  completarConexion,
  desconectar,
  iniciarConexion,
  marcarTokenRechazado,
  obtenerConexion,
  obtenerTokenParaEnviar,
} from "./metaPageConnection.service";

// ---------------------------------------------------------------------------
// metaPageConnection.service.ts (ítem 170), SIN BASE Y SIN RED.
//
// Prisma se reemplaza por dobles de `organization` y `metaPageConnection`
// (mismo patrón que branch.service.test.ts) y Meta por un cliente falso
// inyectado. Lo real es el cifrado y la firma del state, con una clave de
// prueba. Lo que se verifica es la DECISIÓN del service: el orden de
// seguridad del callback, qué casos de páginas se rechazan, qué se guarda y
// cómo se traduce el UNIQUE de page_id. Que Postgres lo guarde de verdad lo
// cubre metaPageConnection.controller.integration-test.ts.
// ---------------------------------------------------------------------------

const ORG = randomUUID();

const claveOriginal = env.SECRET_ENCRYPTION_KEY;

before(() => {
  env.SECRET_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  resetCifradorParaTests();
  resetClaveDeFirmaMetaParaTests();
});

after(() => {
  env.SECRET_ENCRYPTION_KEY = claveOriginal;
  resetCifradorParaTests();
  resetClaveDeFirmaMetaParaTests();
});

afterEach(() => mock.restoreAll());

interface BaseFalsa {
  upserts: Prisma.MetaPageConnectionUpsertArgs[];
  revocaciones: unknown[];
  lecturasDeOrganizacion: number;
}

function baseFalsa(
  opciones: {
    organizacion?: { id: string; deletedAt: Date | null } | null;
    conexion?: Record<string, unknown> | null;
    falloDelUpsert?: unknown;
  } = {},
): BaseFalsa {
  const estado: BaseFalsa = { upserts: [], revocaciones: [], lecturasDeOrganizacion: 0 };
  const organizacion =
    "organizacion" in opciones ? opciones.organizacion : { id: ORG, deletedAt: null };

  mock.property(prisma as unknown as Record<string, unknown>, "organization", {
    findUnique: async () => {
      estado.lecturasDeOrganizacion++;
      return organizacion;
    },
  });

  mock.property(prisma as unknown as Record<string, unknown>, "metaPageConnection", {
    findUnique: async () => opciones.conexion ?? null,
    upsert: async (args: Prisma.MetaPageConnectionUpsertArgs) => {
      estado.upserts.push(args);
      if (opciones.falloDelUpsert) throw opciones.falloDelUpsert;
      return {
        id: randomUUID(),
        organizationId: ORG,
        ...(args.create as Record<string, unknown>),
        pageAccessToken: undefined,
      };
    },
    updateMany: async (args: unknown) => {
      estado.revocaciones.push(args);
      return { count: 1 };
    },
  });

  return estado;
}

interface DobleDeMeta {
  cliente: ClienteMetaOAuth;
  llamadas: string[];
}

function doblarMeta(
  opciones: { paginas?: PaginaAutorizada[]; falloAlCanjear?: Error; falloAlSuscribir?: Error } = {},
): DobleDeMeta {
  const llamadas: string[] = [];
  const cliente: ClienteMetaOAuth = {
    construirUrlDeAutorizacion: (state) => `https://www.facebook.com/fake?state=${state}`,
    intercambiarCodigo: async (code) => {
      llamadas.push(`canje:${code}`);
      if (opciones.falloAlCanjear) throw opciones.falloAlCanjear;
      return { accessToken: "user-corto", expiraEnSegundos: 3600 };
    },
    obtenerTokenDeLargaDuracion: async (token) => {
      llamadas.push(`largo:${token}`);
      return { accessToken: "user-largo", expiraEnSegundos: 5183944 };
    },
    listarPaginasAutorizadas: async (token) => {
      llamadas.push(`paginas:${token}`);
      return opciones.paginas ?? [pagina("111", "17841400000000000")];
    },
    suscribirPaginaALaApp: async (pageId, pageAccessToken) => {
      llamadas.push(`suscribir:${pageId}:${pageAccessToken}`);
      if (opciones.falloAlSuscribir) throw opciones.falloAlSuscribir;
    },
  };
  return { cliente, llamadas };
}

function pagina(id: string, instagram: string | null = null): PaginaAutorizada {
  return {
    id,
    name: `Página ${id}`,
    accessToken: `page-token-${id}`,
    instagramBusinessAccountId: instagram,
  };
}

async function capturar(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  assert.fail("se esperaba un error y no hubo ninguno");
}

function assertAppError(err: unknown, statusCode: number, mensaje?: string) {
  assert.ok(err instanceof AppError, `debe ser AppError, fue: ${String(err)}`);
  assert.equal(err.statusCode, statusCode);
  if (mensaje !== undefined) assert.equal(err.message, mensaje);
}

// ---------------------------------------------------------------------------
// iniciarConexion
// ---------------------------------------------------------------------------

test("iniciarConexion devuelve la URL de Meta con un state firmado para ESTA organización", async () => {
  baseFalsa();
  const { cliente } = doblarMeta();

  const { authorizationUrl } = await iniciarConexion(ORG, cliente);

  const state = new URL(authorizationUrl).searchParams.get("state") ?? "";
  const payload = JSON.parse(Buffer.from(state.split(".")[1], "base64url").toString("utf8"));
  assert.equal(payload.organizationId, ORG);
  assert.equal(payload.aud, "meta-oauth");
});

test("iniciarConexion: organización inexistente o dada de baja → 404", async () => {
  const { cliente } = doblarMeta();

  baseFalsa({ organizacion: null });
  assertAppError(await capturar(() => iniciarConexion(ORG, cliente)), 404);

  mock.restoreAll();
  baseFalsa({ organizacion: { id: ORG, deletedAt: new Date() } });
  assertAppError(await capturar(() => iniciarConexion(ORG, cliente)), 404);
});

// ---------------------------------------------------------------------------
// completarConexion — el orden de seguridad
// ---------------------------------------------------------------------------

test("sin state → 400, sin leer la base ni hablar con Meta", async () => {
  const base = baseFalsa();
  const meta = doblarMeta();

  assertAppError(await capturar(() => completarConexion({ code: "c" }, meta.cliente)), 400);
  assert.equal(base.lecturasDeOrganizacion, 0);
  assert.equal(meta.llamadas.length, 0);
});

test("state inválido → 400, sin leer la base ni hablar con Meta", async () => {
  const base = baseFalsa();
  const meta = doblarMeta();
  const ajeno = await firmarMetaState({ organizationId: ORG }, new Uint8Array(randomBytes(32)));

  assertAppError(
    await capturar(() => completarConexion({ state: ajeno, code: "c" }, meta.cliente)),
    400,
    "El parámetro state es inválido",
  );
  assert.equal(base.lecturasDeOrganizacion, 0);
  assert.equal(meta.llamadas.length, 0);
});

test("state vencido → 400 con el mensaje de 'expiró'", async () => {
  baseFalsa();
  const meta = doblarMeta();
  const clave = deriveKey(
    parseMasterKey(env.SECRET_ENCRYPTION_KEY as string),
    "plataforma-crm:oauth-state:meta:v1",
  );
  const vencido = await new SignJWT({ organizationId: ORG })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("plataforma-crm")
    .setAudience("meta-oauth")
    .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .sign(clave);

  const err = await capturar(() => completarConexion({ state: vencido, code: "c" }, meta.cliente));
  assertAppError(err, 400);
  assert.match((err as Error).message, /expiró/);
  assert.equal(meta.llamadas.length, 0);
});

test("error=access_denied con state válido → 400 legible, sin hablar con Meta ni escribir", async () => {
  const base = baseFalsa();
  const meta = doblarMeta();
  const state = await firmarMetaState({ organizationId: ORG });

  assertAppError(
    await capturar(() => completarConexion({ state, error: "access_denied" }, meta.cliente)),
    400,
    "Se canceló la autorización en Facebook. La página quedó sin conectar.",
  );
  assert.equal(meta.llamadas.length, 0);
  assert.equal(base.upserts.length, 0);
});

test("state válido sin code → 400", async () => {
  baseFalsa();
  const meta = doblarMeta();
  const state = await firmarMetaState({ organizationId: ORG });

  assertAppError(
    await capturar(() => completarConexion({ state }, meta.cliente)),
    400,
    "Falta el parámetro code",
  );
  assert.equal(meta.llamadas.length, 0);
});

test("la organización se borró mientras la persona estaba en Meta → 404, sin canjear el code", async () => {
  baseFalsa({ organizacion: null });
  const meta = doblarMeta();
  const state = await firmarMetaState({ organizationId: ORG });

  assertAppError(await capturar(() => completarConexion({ state, code: "c" }, meta.cliente)), 404);
  assert.equal(meta.llamadas.length, 0);
});

// ---------------------------------------------------------------------------
// completarConexion — las páginas
// ---------------------------------------------------------------------------

test("camino feliz: code → token corto → token LARGO → páginas, y se guarda la única página con el token CIFRADO", async () => {
  const base = baseFalsa();
  const meta = doblarMeta({ paginas: [pagina("111", "17841400000000000")] });
  const state = await firmarMetaState({ organizationId: ORG });

  const conexion = await completarConexion({ state, code: "el-code" }, meta.cliente);

  // El orden importa: las páginas se piden con el token LARGO, que es lo que
  // hace que el Page token no venza.
  // Ítem 171: y la página se suscribe a la app con SU token antes de guardar.
  assert.deepEqual(meta.llamadas, [
    "canje:el-code",
    "largo:user-corto",
    "paginas:user-largo",
    "suscribir:111:page-token-111",
  ]);

  assert.equal(base.upserts.length, 1);
  const [upsert] = base.upserts;
  assert.deepEqual(upsert.where, { organizationId: ORG });
  const creado = upsert.create as Prisma.MetaPageConnectionUncheckedCreateInput;
  assert.equal(creado.organizationId, ORG);
  assert.equal(creado.pageId, "111");
  assert.equal(creado.instagramBusinessAccountId, "17841400000000000");
  assert.equal(creado.status, "ACTIVE");
  // Cifrado, y se descifra al token de la página.
  assert.notEqual(creado.pageAccessToken, "page-token-111");
  assert.equal(getCifrador().decrypt(creado.pageAccessToken as string), "page-token-111");

  // Lo que devuelve no trae el token.
  assert.equal(conexion.pageId, "111");
  assert.equal("pageAccessToken" in conexion && conexion.pageAccessToken !== undefined, false);
});

test("una página sin Instagram vinculado se guarda con instagramBusinessAccountId null", async () => {
  const base = baseFalsa();
  const meta = doblarMeta({ paginas: [pagina("222", null)] });
  const state = await firmarMetaState({ organizationId: ORG });

  await completarConexion({ state, code: "c" }, meta.cliente);

  const creado = base.upserts[0].create as Prisma.MetaPageConnectionUncheckedCreateInput;
  assert.equal(creado.instagramBusinessAccountId, null);
});

test("CERO páginas autorizadas → 400 con el mensaje para la persona, sin escribir", async () => {
  const base = baseFalsa();
  const meta = doblarMeta({ paginas: [] });
  const state = await firmarMetaState({ organizationId: ORG });

  assertAppError(
    await capturar(() => completarConexion({ state, code: "c" }, meta.cliente)),
    400,
    MENSAJE_SIN_PAGINAS,
  );
  assert.equal(base.upserts.length, 0);
});

test("MÁS DE UNA página autorizada → 400 explícito (no se elige 'la primera'), sin escribir", async () => {
  const base = baseFalsa();
  const meta = doblarMeta({ paginas: [pagina("1"), pagina("2")] });
  const state = await firmarMetaState({ organizationId: ORG });

  assertAppError(
    await capturar(() => completarConexion({ state, code: "c" }, meta.cliente)),
    400,
    MENSAJE_VARIAS_PAGINAS,
  );
  assert.equal(base.upserts.length, 0);
});

test("la página ya está conectada a OTRA organización (P2002 sobre page_id) → 409 legible", async () => {
  baseFalsa({
    falloDelUpsert: new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["page_id"] },
    }),
  });
  const meta = doblarMeta();
  const state = await firmarMetaState({ organizationId: ORG });

  assertAppError(
    await capturar(() => completarConexion({ state, code: "c" }, meta.cliente)),
    409,
    MENSAJE_PAGINA_DE_OTRA_CUENTA,
  );
});

test("un P2002 que NO es sobre page_id se relanza tal cual", async () => {
  const otro = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["organization_id"] },
  });
  baseFalsa({ falloDelUpsert: otro });
  const meta = doblarMeta();
  const state = await firmarMetaState({ organizationId: ORG });

  assert.equal(await capturar(() => completarConexion({ state, code: "c" }, meta.cliente)), otro);
});

test("si Meta falla al canjear, el MetaAuthError sube y no se escribe nada", async () => {
  const base = baseFalsa();
  const fallo = new MetaAuthError("Meta rechazó la solicitud: code usado", true);
  const meta = doblarMeta({ falloAlCanjear: fallo });
  const state = await firmarMetaState({ organizationId: ORG });

  assert.equal(await capturar(() => completarConexion({ state, code: "c" }, meta.cliente)), fallo);
  assert.equal(base.upserts.length, 0);
});

test("si Meta rechaza la suscripción de la página (ítem 171), el error sube y NO se guarda la conexión", async () => {
  const base = baseFalsa();
  const fallo = new MetaAuthError("Meta rechazó la solicitud: permisos", true);
  const meta = doblarMeta({ falloAlSuscribir: fallo });
  const state = await firmarMetaState({ organizationId: ORG });

  assert.equal(await capturar(() => completarConexion({ state, code: "c" }, meta.cliente)), fallo);
  assert.equal(base.upserts.length, 0);
});

// ---------------------------------------------------------------------------
// desconectar / obtenerConexion
// ---------------------------------------------------------------------------

test("desconectar sin conexión → 404", async () => {
  baseFalsa({ conexion: null });
  assertAppError(await capturar(() => desconectar(ORG)), 404);
});

test("desconectar una conexión ya REVOKED → 409, sin escribir", async () => {
  const base = baseFalsa({ conexion: { organizationId: ORG, status: "REVOKED" } });
  assertAppError(await capturar(() => desconectar(ORG)), 409);
  assert.equal(base.revocaciones.length, 0);
});

test("desconectar una ACTIVE la marca REVOKED y borra el token", async () => {
  const base = baseFalsa({
    conexion: { organizationId: ORG, status: "ACTIVE", pageAccessToken: "cifrado" },
  });

  await desconectar(ORG);

  assert.equal(base.revocaciones.length, 1);
  const { where, data } = base.revocaciones[0] as {
    where: unknown;
    data: { status: string; pageAccessToken: null };
  };
  assert.deepEqual(where, { organizationId: ORG });
  assert.equal(data.status, "REVOKED");
  assert.equal(data.pageAccessToken, null);
});

test("obtenerConexion sin conexión → 404; con conexión, la devuelve", async () => {
  baseFalsa({ conexion: null });
  assertAppError(await capturar(() => obtenerConexion(ORG)), 404);

  mock.restoreAll();
  baseFalsa({ conexion: { organizationId: ORG, pageId: "111", status: "ACTIVE" } });
  const conexion = await obtenerConexion(ORG);
  assert.equal(conexion.pageId, "111");
});

// ---------------------------------------------------------------------------
// obtenerTokenParaEnviar / marcarTokenRechazado (ítem 172)
// ---------------------------------------------------------------------------

test("obtenerTokenParaEnviar: sin conexión → 404 legible", async () => {
  baseFalsa({ conexion: null });
  assertAppError(
    await capturar(() => obtenerTokenParaEnviar(ORG, "111")),
    404,
    MENSAJE_SIN_CONEXION_PARA_ENVIAR,
  );
});

test("obtenerTokenParaEnviar: la organización reconectó OTRA página → 409, aunque la nueva esté ACTIVE", async () => {
  baseFalsa({
    conexion: {
      organizationId: ORG,
      pageId: "222",
      status: "ACTIVE",
      pageAccessToken: getCifrador().encrypt("token-de-la-222"),
    },
  });
  assertAppError(
    await capturar(() => obtenerTokenParaEnviar(ORG, "111")),
    409,
    MENSAJE_PAGINA_RECONECTADA,
  );
});

test("obtenerTokenParaEnviar: REVOKED o ERROR → 409 'hay que reconectarla'", async () => {
  for (const conexion of [
    { status: "REVOKED", pageAccessToken: null },
    { status: "ERROR", pageAccessToken: getCifrador().encrypt("token-viejo") },
  ]) {
    mock.restoreAll();
    baseFalsa({ conexion: { organizationId: ORG, pageId: "111", ...conexion } });
    assertAppError(
      await capturar(() => obtenerTokenParaEnviar(ORG, "111")),
      409,
      MENSAJE_CONEXION_INACTIVA,
    );
  }
});

test("obtenerTokenParaEnviar: ACTIVE sin token (lo que el CHECK impide) → 409, sin intentar descifrar", async () => {
  baseFalsa({
    conexion: { organizationId: ORG, pageId: "111", status: "ACTIVE", pageAccessToken: null },
  });
  assertAppError(await capturar(() => obtenerTokenParaEnviar(ORG, "111")), 409);
});

test("obtenerTokenParaEnviar: camino feliz → el token DESCIFRADO", async () => {
  baseFalsa({
    conexion: {
      organizationId: ORG,
      pageId: "111",
      status: "ACTIVE",
      pageAccessToken: getCifrador().encrypt("page-token-111"),
    },
  });
  assert.equal(await obtenerTokenParaEnviar(ORG, "111"), "page-token-111");
});

test("marcarTokenRechazado: ERROR solo sobre ESA página y nunca sobre una REVOKED, conservando el token", async () => {
  const base = baseFalsa();
  await marcarTokenRechazado(ORG, "111", "Meta rechazó el token");
  assert.equal(base.revocaciones.length, 1);
  const { where, data } = base.revocaciones[0] as {
    where: unknown;
    data: Record<string, unknown>;
  };
  assert.deepEqual(where, { organizationId: ORG, status: { not: "REVOKED" }, pageId: "111" });
  assert.equal(data.status, "ERROR");
  assert.equal(data.lastErrorMessage, "Meta rechazó el token");
  assert.equal("pageAccessToken" in data, false);
});
