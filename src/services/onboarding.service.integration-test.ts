import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { getSupabaseAnon } from "../lib/supabaseAnon";
import { AppError } from "../utils/AppError";
import { onboardOrganization, requestOnboardingOtp } from "./onboarding.service";

// ALTO-2 — el registro exige probar el email antes de aceptarlo.
//
// Antes, `admin.createUser({ email_confirm: true })` marcaba la identidad como
// confirmada sin ninguna prueba: cualquiera registraba una organización con el
// email de una víctima y se lo quemaba para siempre (createInvitation e
// inviteUserByEmail lo rechazan con 409 a partir de ahí).
//
// ---------------------------------------------------------------------------
// DE DÓNDE SALE EL CÓDIGO EN ESTOS TESTS, Y QUÉ NO SE PRUEBA CON ESO
// ---------------------------------------------------------------------------
//
// El código se obtiene con `admin.generateLink({ type: "magiclink" })`, que
// devuelve `properties.email_otp` sin enviar ningún mail. Es lo que permite que
// estos tests corran igual contra el stack local del CI y contra un proyecto
// hosteado, sin depender de leer un buzón.
//
// LO QUE ESO DEJA AFUERA, dicho explícitamente: que el mail que recibe una
// persona real CONTENGA el código. Eso depende de que la plantilla "Magic Link"
// del proyecto incluya `{{ .Token }}` —requisito operativo documentado en el
// encabezado de onboarding.service.ts— y esa plantilla vive en el panel de
// Supabase, no en este repositorio.
//
// No es el agujero que ALTO-3 critica, y la diferencia importa: si la plantilla
// no tiene `{{ .Token }}`, el registro NO SE PUEDE COMPLETAR para nadie. Falla
// cerrado y ruidoso, no en silencio. Lo que ALTO-3 señalaba era lo contrario:
// una configuración cuyo estado equivocado dejaba pasar a quien no debía.

const PASSWORD = "una-password-de-prueba-123";

function emailDePrueba(etiqueta: string): string {
  return `alto2-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
}

// El OTP real que GoTrue acepta para este email, sin pasar por el mail.
async function obtenerCodigo(email: string): Promise<string> {
  const { data, error } = await getSupabaseAdmin().auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  const codigo = data.properties?.email_otp;
  if (error || !codigo) {
    throw new Error(
      `No se pudo generar el OTP para ${email}: ${error?.message ?? "sin email_otp"}`,
    );
  }
  return codigo;
}

async function buscarIdentidad(email: string) {
  // La Admin API no busca por email, así que se pagina. En estas bases de test
  // la cantidad de usuarios es chica; es aceptable para un test y no para
  // código de producción (ver authCleanup.service.ts, que hace lo mismo pero es
  // un script de mantenimiento).
  for (let pagina = 1; pagina <= 20; pagina++) {
    const { data, error } = await getSupabaseAdmin().auth.admin.listUsers({
      page: pagina,
      perPage: 200,
    });
    if (error) throw new Error(`listUsers falló: ${error.message}`);

    const encontrado = data.users.find((u) => u.email === email);
    if (encontrado) return encontrado;
    if (data.users.length < 200) return undefined;
  }
  return undefined;
}

async function limpiar(email: string, organizationId?: string) {
  if (organizationId) {
    await prisma.stage.deleteMany({ where: { organizationId } });
    await prisma.pipeline.deleteMany({ where: { organizationId } });
    await prisma.user.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  }
  const identidad = await buscarIdentidad(email);
  if (identidad) {
    await getSupabaseAdmin().auth.admin.deleteUser(identidad.id);
  }
}

// NO SE AFIRMA QUE LA IDENTIDAD NAZCA SIN CONFIRMAR, y hace falta explicar por
// qué, porque es lo primero que uno querría afirmar acá.
//
// Ese estado no lo decide este código: lo decide `Confirm email` del proyecto de
// Supabase (`auth.email.enable_confirmations`). Con la confirmación APAGADA
// —como está el stack local del CI— GoTrue autoconfirma en el alta, así que la
// fila nace confirmada. Con la confirmación ENCENDIDA —lo que
// docs/supabase-setup.md exige para producción— nace sin confirmar.
//
// La primera versión de este test afirmaba "sin confirmar" y el CI la
// desmintió. La corrección NO es aflojar la aserción hasta que pase: es que
// esa nunca fue la garantía de ALTO-2. La garantía es que **el registro no
// ocurre sin un código válido**, y eso lo afirma el test siguiente, sin depender
// de ninguna configuración. Ver también la nota de residual en la bitácora.
test("requestOnboardingOtp crea la identidad en auth.users para poder enviarle el código", async () => {
  const email = emailDePrueba("pide-codigo");
  try {
    await requestOnboardingOtp({ email });

    const identidad = await buscarIdentidad(email);
    assert.ok(identidad, "signInWithOtp debía crear la identidad (shouldCreateUser: true)");
    assert.equal(identidad.email, email);
  } finally {
    await limpiar(email);
  }
});

test("onboardOrganization rechaza con 401 un código incorrecto, y no crea ni Organization ni User", async () => {
  const email = emailDePrueba("codigo-malo");
  const organizationName = `ALTO-2 codigo malo ${randomUUID()}`;
  try {
    await requestOnboardingOtp({ email });

    // Un código de 6 dígitos distinto del real. Se genera el real y se usa otro
    // para que el test no dependa de que "000000" nunca sea el correcto.
    const real = await obtenerCodigo(email);
    const incorrecto = real === "000000" ? "111111" : "000000";

    let capturado: unknown;
    try {
      await onboardOrganization({
        organizationName,
        fullName: "Quien Sea",
        email,
        password: PASSWORD,
        otp: incorrecto,
      });
      assert.fail("onboardOrganization debía rechazar un código incorrecto");
    } catch (err) {
      capturado = err;
    }

    assert.ok(capturado instanceof AppError, "debe ser AppError, no un error crudo");
    assert.equal(capturado.statusCode, 401);
    assert.equal(capturado.message, "El código de verificación es inválido o expiró");

    // LA GARANTÍA DE ALTO-2, y no depende de ninguna configuración del
    // proyecto: sin un código válido no se registra nada. Ni Organization, ni
    // User, ni contraseña fijada.
    const organizaciones = await prisma.organization.count({ where: { name: organizationName } });
    assert.equal(organizaciones, 0, "no debe haber quedado ninguna Organization");

    const usuarios = await prisma.user.count({ where: { email } });
    assert.equal(usuarios, 0, "no debe haber quedado ningún perfil de negocio");
  } finally {
    await limpiar(email);
  }
});

test("onboardOrganization con el código correcto crea Organization + User y deja el email CONFIRMADO en auth.users", async () => {
  const email = emailDePrueba("feliz");
  const organizationName = `ALTO-2 feliz ${randomUUID()}`;
  let organizationId: string | undefined;
  try {
    await requestOnboardingOtp({ email });
    const codigo = await obtenerCodigo(email);

    const resultado = await onboardOrganization({
      organizationName,
      fullName: "Persona Registrada",
      email,
      password: PASSWORD,
      otp: codigo,
    });

    organizationId = resultado.organization.id;

    assert.equal(resultado.user.role, "ADMIN");
    assert.equal(resultado.user.email, email);

    const usuario = await prisma.user.findUnique({ where: { id: resultado.user.id } });
    assert.ok(usuario, "debe existir el perfil de negocio");
    assert.equal(usuario.organizationId, organizationId);

    // LA AFIRMACIÓN CENTRAL DE ALTO-2: el email quedó confirmado porque alguien
    // probó el código, no porque el backend lo haya declarado confirmado.
    const identidad = await buscarIdentidad(email);
    assert.ok(identidad?.email_confirmed_at, "verifyOtp debía sellar email_confirmed_at");

    // Y la contraseña quedó fijada por updateUserById sobre la identidad ya
    // probada: si no, no habría forma de entrar a la cuenta recién creada.
    const { data: sesion, error } = await getSupabaseAdmin().auth.signInWithPassword({
      email,
      password: PASSWORD,
    });
    assert.equal(error, null, `debía poder iniciar sesión: ${error?.message ?? ""}`);
    assert.ok(sesion.session, "signInWithPassword debía devolver una sesión");
  } finally {
    await limpiar(email, organizationId);
  }
});

// ---------------------------------------------------------------------------
// M-13 (docs/auditoria-2026-08-29.md) — dos bugs en el mismo flujo.
//
// Bug 1: un nombre sin caracteres ASCII alfanuméricos slugifica a "" y pasaba el
// schema (min(1) es sobre el nombre). Bug 2: el chequeo "¿ya existe una
// organización con ese slug?" corría ANTES de verifyOtp, así que un endpoint
// público respondía 409 o 401 según si el nombre existía, sin que quien
// preguntaba tuviera ningún código válido — un oráculo de nombres.
// ---------------------------------------------------------------------------

test("M-13 bug 1: un nombre que slugifica a '' se rechaza con 400 ANTES de gastar el OTP, y no crea nada", async () => {
  // Sin requestOnboardingOtp y con un código inventado, a propósito: si el
  // rechazo viniera de verifyOtp sería un 401. Que sea 400 prueba que el slug
  // vacío se rechaza antes de tocar Supabase.
  const email = emailDePrueba("slug-vacio");
  for (const organizationName of ["株式会社", "###"]) {
    let capturado: unknown;
    try {
      await onboardOrganization({
        organizationName,
        fullName: "Quien Sea",
        email,
        password: PASSWORD,
        otp: "000000",
      });
      assert.fail(`onboardOrganization debía rechazar "${organizationName}"`);
    } catch (err) {
      capturado = err;
    }

    assert.ok(capturado instanceof AppError, "debe ser AppError, no un error crudo");
    assert.equal(capturado.statusCode, 400, "antes: 409 o un slug vacío persistido");
    assert.ok(capturado.message.includes("identificador"));
  }

  assert.equal(await prisma.organization.count({ where: { slug: "" } }), 0);
  assert.equal(await prisma.user.count({ where: { email } }), 0);
  // No hubo verifyOtp ni signInWithOtp: la identidad no tiene por qué existir.
  assert.equal(await buscarIdentidad(email), undefined);
});

test("M-13 bug 2: un nombre YA EXISTENTE con un OTP incorrecto responde 401, no 409 — el oráculo está cerrado", async () => {
  const emailDuenio = emailDePrueba("oraculo-duenio");
  const emailAjeno = emailDePrueba("oraculo-ajeno");
  const organizationName = `M-13 oraculo ${randomUUID()}`;
  let organizationId: string | undefined;
  try {
    // Una organización real, registrada como corresponde.
    await requestOnboardingOtp({ email: emailDuenio });
    const registro = await onboardOrganization({
      organizationName,
      fullName: "Dueña",
      email: emailDuenio,
      password: PASSWORD,
      otp: await obtenerCodigo(emailDuenio),
    });
    organizationId = registro.organization.id;

    // Alguien sin ningún código válido prueba el MISMO nombre desde otro email.
    // Antes del fix esto daba 409 ("Ya existe una organización con ese
    // nombre"): el pre-chequeo corría sin haber probado nada. Ahora tiene que
    // ser el 401 del OTP, indistinguible del que daría un nombre libre.
    let capturado: unknown;
    try {
      await onboardOrganization({
        organizationName,
        fullName: "Curioso",
        email: emailAjeno,
        password: PASSWORD,
        otp: "000000",
      });
      assert.fail("onboardOrganization debía rechazar el código inválido");
    } catch (err) {
      capturado = err;
    }

    assert.ok(capturado instanceof AppError);
    assert.equal(capturado.statusCode, 401, "antes del fix: 409, el oráculo de nombres");
    assert.equal(capturado.message, "El código de verificación es inválido o expiró");
  } finally {
    await limpiar(emailAjeno);
    await limpiar(emailDuenio, organizationId);
  }
});

test("M-13: con el OTP correcto, el nombre YA EXISTENTE sigue respondiendo 409 — mover el chequeo no lo rompió", async () => {
  const emailDuenio = emailDePrueba("dup-nombre-duenio");
  const emailSegundo = emailDePrueba("dup-nombre-segundo");
  const organizationName = `M-13 nombre repetido ${randomUUID()}`;
  let organizationId: string | undefined;
  try {
    await requestOnboardingOtp({ email: emailDuenio });
    const registro = await onboardOrganization({
      organizationName,
      fullName: "Dueña",
      email: emailDuenio,
      password: PASSWORD,
      otp: await obtenerCodigo(emailDuenio),
    });
    organizationId = registro.organization.id;

    await requestOnboardingOtp({ email: emailSegundo });
    const codigoValido = await obtenerCodigo(emailSegundo);

    let capturado: unknown;
    try {
      await onboardOrganization({
        organizationName,
        fullName: "Segunda",
        email: emailSegundo,
        password: PASSWORD,
        otp: codigoValido,
      });
      assert.fail("onboardOrganization debía rechazar el nombre repetido");
    } catch (err) {
      capturado = err;
    }

    assert.ok(capturado instanceof AppError);
    assert.equal(capturado.statusCode, 409);
    assert.equal(capturado.message, "Ya existe una organización con ese nombre");

    // Y no se creó nada para el segundo email.
    assert.equal(await prisma.user.count({ where: { email: emailSegundo } }), 0);
    assert.equal(await prisma.organization.count({ where: { name: organizationName } }), 1);
  } finally {
    await limpiar(emailSegundo);
    await limpiar(emailDuenio, organizationId);
  }
});

test("onboardOrganization rechaza con 409 un email que ya tiene cuenta, y NO borra la identidad existente", async () => {
  const email = emailDePrueba("duplicado");
  let organizationId: string | undefined;
  try {
    await requestOnboardingOtp({ email });
    const primerCodigo = await obtenerCodigo(email);

    const primero = await onboardOrganization({
      organizationName: `ALTO-2 dup uno ${randomUUID()}`,
      fullName: "Primera",
      email,
      password: PASSWORD,
      otp: primerCodigo,
    });
    organizationId = primero.organization.id;

    // Segundo intento con el MISMO email y un código igualmente válido.
    const segundoCodigo = await obtenerCodigo(email);

    let capturado: unknown;
    try {
      await onboardOrganization({
        organizationName: `ALTO-2 dup dos ${randomUUID()}`,
        fullName: "Segunda",
        email,
        password: PASSWORD,
        otp: segundoCodigo,
      });
      assert.fail("onboardOrganization debía rechazar un email que ya tiene cuenta");
    } catch (err) {
      capturado = err;
    }

    assert.ok(capturado instanceof AppError);
    assert.equal(capturado.statusCode, 409);
    assert.equal(capturado.message, "Ya existe una cuenta con ese email");

    // LO QUE ESTE TEST PROTEGE DE VERDAD: que el rechazo no dispare la
    // compensación. Con el OTP, la identidad puede existir porque la creamos
    // nosotros al emitir el código — pero también porque es de alguien. Borrarla
    // acá destruiría la cuenta real de otra persona.
    const identidad = await buscarIdentidad(email);
    assert.ok(identidad, "la identidad de la cuenta existente NO debe haberse borrado");

    const usuario = await prisma.user.findUnique({ where: { id: primero.user.id } });
    assert.ok(usuario, "el perfil de negocio de la cuenta existente debe seguir ahí");
  } finally {
    await limpiar(email, organizationId);
  }
});

// ---------------------------------------------------------------------------
// M-11 (b), §28.7 de docs/bitacora-2026-08-29.md — el sitio "No se encontró el
// rol ADMIN" es un error de configuración del servidor (falta el seed) y va
// con isOperational: false. Este test dispara ESE throw de verdad, con el
// flujo real completo hasta la transacción.
//
// POR QUÉ NO SE BORRA NI SE RENOMBRA EL ROL ADMIN DE LA BASE: es una fila
// global, sembrada una vez, que todos los archivos de integración leen en sus
// fixtures — y el runner los corre en paralelo. Tocarla aunque sea unos
// cientos de milisegundos es una receta de fallos espurios en OTROS archivos.
// En su lugar se dobla prisma.$transaction con mock.method de node:test, solo
// en este proceso y solo durante este test: la callback del service recibe un
// tx cuyo role.findUnique devuelve null, que es exactamente "una base sin el
// rol ADMIN" desde el punto de vista del código que se está probando.
// ---------------------------------------------------------------------------

test("M-11 b: sin el rol ADMIN en la base, onboardOrganization lanza un AppError 500 NO operacional", async () => {
  const email = emailDePrueba("sin-rol-admin");
  const organizationName = `M-11 sin rol ADMIN ${randomUUID()}`;

  const transaccion = mock.method(prisma, "$transaction", ((
    fn: (tx: unknown) => Promise<unknown>,
  ) => fn({ role: { findUnique: async () => null } })) as never);

  try {
    await requestOnboardingOtp({ email });
    const codigo = await obtenerCodigo(email);

    let capturado: unknown;
    try {
      await onboardOrganization({
        organizationName,
        fullName: "Sin Rol",
        email,
        password: PASSWORD,
        otp: codigo,
      });
    } catch (err) {
      capturado = err;
    }

    assert.equal(
      transaccion.mock.callCount(),
      1,
      "el flujo tiene que haber llegado a la transacción",
    );
    assert.ok(capturado instanceof AppError, String(capturado));
    assert.equal(capturado.statusCode, 500);
    assert.equal(capturado.isOperational, false);
    // El mensaje sigue intacto: es para el log.
    assert.equal(
      capturado.message,
      "No se encontró el rol ADMIN. Contactá al administrador del sistema.",
    );

    // Y no quedó nada a medias: ni Organization, ni identidad (la compensación
    // del service la revierte).
    assert.equal(await prisma.organization.count({ where: { name: organizationName } }), 0);
    assert.equal(await buscarIdentidad(email), undefined);
  } finally {
    transaccion.mock.restore();
    await limpiar(email);
  }
});

// ---------------------------------------------------------------------------
// B-22 de docs/auditoria-2026-08-29.md — requestOnboardingOtp aplastaba TODO
// error de signInWithOtp en el 502 genérico, incluido el 429 real de
// over_email_send_rate_limit (el mismo que ya se observó E2E, ver
// docs/project-overview.md): un cliente rate-limiteado tiene que hacer
// backoff, no reintentar contra un "error de servidor".
//
// Gatillar el rate limit REAL sería lento y no determinístico (depende del
// contador de envíos de GoTrue, compartido por toda la suite), así que el
// error se dobla en el cliente singleton — mismo criterio que el doble de
// prisma.$transaction de M-11 b acá arriba: la rama decide sobre el error
// que recibe, no hace falta producir la condición de verdad. Sin gancho de
// producción: getSupabaseAnon() ya expone el singleton que usa el service.
// ---------------------------------------------------------------------------

async function conSignInWithOtpDoblado<T>(error: unknown, fn: () => Promise<T>): Promise<T> {
  const auth = getSupabaseAnon().auth as unknown as { signInWithOtp: unknown };
  const original = auth.signInWithOtp;
  auth.signInWithOtp = async () => ({ data: { user: null, session: null }, error });
  try {
    return await fn();
  } finally {
    auth.signInWithOtp = original;
  }
}

test("B-22: over_email_send_rate_limit en signInWithOtp → 429 con mensaje de backoff, no el 502 genérico", async () => {
  await conSignInWithOtpDoblado(
    {
      code: "over_email_send_rate_limit",
      status: 429,
      message: "For security purposes, you can only request this once every 60 seconds",
    },
    () =>
      assert.rejects(
        () => requestOnboardingOtp({ email: emailDePrueba("b22-rate-limit") }),
        (err) => {
          assert.ok(err instanceof AppError, "debe ser AppError, no un error crudo");
          assert.equal(err.statusCode, 429);
          assert.equal(
            err.message,
            "Demasiados intentos. Esperá antes de volver a pedir el código.",
          );
          return true;
        },
      ),
  );
});

test("B-22: cualquier otro error de signInWithOtp sigue en el 502 genérico, sin filtrar el motivo real", async () => {
  await conSignInWithOtpDoblado(
    // Un error cuyo mensaje distingue algo que el endpoint público no debe
    // revelar — la respuesta tiene que seguir siendo la genérica de siempre.
    { code: "unexpected_failure", status: 500, message: "Database error finding user" },
    () =>
      assert.rejects(
        () => requestOnboardingOtp({ email: emailDePrueba("b22-otro-error") }),
        (err) => {
          assert.ok(err instanceof AppError, "debe ser AppError, no un error crudo");
          assert.equal(err.statusCode, 502);
          assert.equal(err.message, "No se pudo enviar el código de verificación. Probá de nuevo.");
          return true;
        },
      ),
  );
});

// ---------------------------------------------------------------------------
// V-5 (docs/verificacion-v1-v14-estado.md) — el espejo de B-22 del lado de
// verifyOtp. onboardOrganization aplastaba TODO error de verifyOtp en el 401
// genérico "inválido o expiró", incluido over_request_rate_limit: el 429 por
// IP de /verify, que —como el registro entero pasa server-side— es la IP del
// backend y un cupo compartido por toda la plataforma. Quien lo recibía leía
// "tu código está mal" y pedía otro código, en vez de esperar.
//
// Ojo, son dos códigos distintos: over_email_send_rate_limit es del envío
// (signInWithOtp, B-22 arriba); over_request_rate_limit es de la verificación
// (verifyOtp, esto). Mismo mecanismo de doble que conSignInWithOtpDoblado, y
// por la misma razón: gatillar el rate limit real de GoTrue sería lento y no
// determinístico, compartido por toda la suite.
// ---------------------------------------------------------------------------

async function conVerifyOtpDoblado<T>(error: unknown, fn: () => Promise<T>): Promise<T> {
  const auth = getSupabaseAnon().auth as unknown as { verifyOtp: unknown };
  const original = auth.verifyOtp;
  auth.verifyOtp = async () => ({ data: { user: null, session: null }, error });
  try {
    return await fn();
  } finally {
    auth.verifyOtp = original;
  }
}

function intentoDeRegistro(etiqueta: string) {
  return onboardOrganization({
    organizationName: `V-5 ${etiqueta} ${randomUUID()}`,
    fullName: "Quien Sea",
    email: emailDePrueba(etiqueta),
    password: PASSWORD,
    otp: "000000",
  });
}

test("V-5: over_request_rate_limit en verifyOtp → 429 con mensaje de backoff, no el 401 genérico", async () => {
  await conVerifyOtpDoblado(
    {
      code: "over_request_rate_limit",
      status: 429,
      message: "Request rate limit reached",
    },
    () =>
      assert.rejects(
        () => intentoDeRegistro("v5-rate-limit"),
        (err) => {
          assert.ok(err instanceof AppError, "debe ser AppError, no un error crudo");
          assert.equal(err.statusCode, 429, "antes del fix: el 401 genérico");
          assert.equal(
            err.message,
            "Demasiados intentos de verificación. Esperá antes de volver a intentar.",
          );
          return true;
        },
      ),
  );
});

// El test "rechaza con 401 un código incorrecto" de arriba ya cubre el error
// REAL de GoTrue para un código malo. Este cubre lo que aquel no puede: que un
// error de verifyOtp con cualquier OTRO código —incluso uno que no habla de
// códigos— siga cayendo en el 401 genérico, sin filtrar el motivo. Es la rama
// que el chequeo nuevo de V-5 tiene que dejar intacta.
test("V-5: cualquier otro error de verifyOtp sigue en el 401 genérico, sin filtrar el motivo real", async () => {
  await conVerifyOtpDoblado(
    { code: "unexpected_failure", status: 500, message: "Database error finding user" },
    () =>
      assert.rejects(
        () => intentoDeRegistro("v5-otro-error"),
        (err) => {
          assert.ok(err instanceof AppError, "debe ser AppError, no un error crudo");
          assert.equal(err.statusCode, 401);
          assert.equal(err.message, "El código de verificación es inválido o expiró");
          return true;
        },
      ),
  );
});
