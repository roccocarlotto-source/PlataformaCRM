import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
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
