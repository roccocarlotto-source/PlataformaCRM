// ---------------------------------------------------------------------------
// Verificación MANUAL de la sesión por pestaña. No corre en el CI ni en
// `npm test`: necesita el stack local entero y un navegador de verdad.
//
// El bug que verifica: la sesión de Supabase vive en el sessionStorage de cada
// pestaña (lib/supabase.ts), pero supabase-js reenvía los eventos de una
// pestaña a las demás por un BroadcastChannel. Con otra pestaña de la app
// abierta sin sesión (en /forgot-password o /login), abrir el link de
// recuperación o el de una invitación terminaba en "Este enlace no es válido o
// expiró": la pestaña sin sesión recibía el evento, pedía /api/me sin token, el
// 401 hacía signOut y ese SIGNED_OUT volvía a la pestaña del link. Ver
// AuthContext (onAuthStateChange) y lib/api.ts (el 401 sin token).
//
// Casos (sale con 1 si alguno falla):
//   otra-pestana  — una pestaña en /forgot-password pide el mail y queda
//                   abierta; el link se abre en otra pestaña del MISMO
//                   navegador. Tiene que mostrar el formulario de contraseña, y
//                   la pestaña de /forgot-password no tiene que pedir /api/me.
//   limpio        — el mismo link, abierto en un navegador limpio (otro
//                   contexto de Playwright, como otro dispositivo). Formulario.
//   invitacion    — una pestaña en /login queda abierta; el link de una
//                   invitación se abre en otra pestaña del mismo navegador.
//                   Tiene que mostrar "Completá tu cuenta".
//
// Necesita, todo LOCAL (el script se niega a correr si alguna URL no es
// localhost/127.0.0.1, y además corta en el navegador cualquier request que
// salga de la máquina):
//   - Supabase local (`npm run supabase:start` en la raíz). Las claves salen de
//     `supabase status`, no se copian acá. Los mails van al Mailpit local: los
//     usuarios son @example.com y no sale ningún correo real.
//   - El backend (raíz) contra lo local, con CORS_ORIGIN igual a la URL del
//     frontend: `PORT=4100 CORS_ORIGIN=http://127.0.0.1:5174 npm run dev` (más
//     DATABASE_URL/DIRECT_URL/SUPABASE_URL locales; los workers pueden ir
//     apagados).
//   - El frontend en 127.0.0.1 y no en localhost: supabase/config.toml solo
//     permite redirects a 127.0.0.1, y con otro host GoTrue manda el link a
//     site_url y el caso no se puede probar. Desde frontend/:
//       VITE_API_URL=http://localhost:4100 \
//       VITE_SUPABASE_URL=http://127.0.0.1:54321 \
//       VITE_SUPABASE_ANON_KEY=<PUBLISHABLE_KEY de supabase status> \
//       npx vite --host 127.0.0.1 --port 5174 --strictPort
//     (frontend/.env apunta a producción: hay que pisarlo así.)
//   - Chromium de Playwright: `npx playwright install chromium` (una vez).
//
// uso (desde frontend/):
//   REPRO_FRONT_URL=http://127.0.0.1:5174 node scripts/repro-sesion-por-pestana.mjs [casos]
// `casos`: los nombres de arriba separados por coma (por defecto, todos).
// REPRO_MAIL_URL pisa la URL de Mailpit si `supabase status` no la da.
//
// Limpieza: borra al final (también si algo falla) los usuarios de Supabase
// Auth y los mails de Mailpit que creó. No crea filas en las tablas del CRM:
// para estas pantallas alcanza con una identidad de Supabase (la de
// recuperación no necesita perfil, y la invitada todavía no lo tiene).
// ---------------------------------------------------------------------------
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const FRONT = process.env.REPRO_FRONT_URL ?? "http://127.0.0.1:5174";
const CASOS_PEDIDOS = process.argv[2] ? process.argv[2].split(",") : null;

const esLocal = (url) => /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(url);

// Las claves del stack local salen de `supabase status`, no se copian acá.
function supabaseLocal() {
  const salida = execFileSync("npx", ["supabase", "status", "-o", "json"], {
    cwd: new URL("../..", import.meta.url),
    encoding: "utf8",
    shell: true,
  });
  return JSON.parse(salida.slice(salida.indexOf("{")));
}

const status = supabaseLocal();
const MAIL = process.env.REPRO_MAIL_URL ?? status.MAILPIT_URL ?? status.INBUCKET_URL;
for (const [nombre, url] of [
  ["REPRO_FRONT_URL", FRONT],
  ["Supabase (API_URL)", status.API_URL],
  ["Mailpit", MAIL],
]) {
  if (!url || !esLocal(url)) {
    console.error(
      `${nombre} no es local (${url ?? "sin valor"}): este script solo corre en local.`,
    );
    process.exit(2);
  }
}

const admin = createClient(status.API_URL, status.SECRET_KEY ?? status.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const creados = { usuarios: [], mails: [] };

async function usuarioDePrueba(caso) {
  const email = `repro-pestanas-${caso}-${randomUUID().slice(0, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: `Clave-${randomUUID()}`,
    email_confirm: true,
  });
  if (error) throw error;
  creados.usuarios.push(data.user.id);
  return email;
}

async function invitacionDePrueba() {
  // Invitación real de GoTrue, como la que manda createInvitation: el mail
  // llega a Mailpit y su link lleva a /invite/accept.
  const email = `repro-pestanas-invitacion-${randomUUID().slice(0, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { invitationId: randomUUID() },
    redirectTo: `${FRONT}/invite/accept`,
  });
  if (error) throw error;
  creados.usuarios.push(data.user.id);
  return email;
}

// El link de verificación del último mail de ese tipo para ese destinatario.
async function linkDelMail(email, tipo) {
  for (let intento = 0; intento < 40; intento++) {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const { messages = [] } = await r.json();
    for (const m of messages) {
      if (!creados.mails.includes(m.ID)) creados.mails.push(m.ID);
      const completo = await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json();
      const cuerpo = `${completo.HTML ?? ""}\n${completo.Text ?? ""}`;
      const links = [...cuerpo.matchAll(/https?:\/\/[^\s"'<>]+verify\?[^\s"'<>]+/g)].map((x) =>
        x[0].replace(/&amp;/g, "&"),
      );
      const link = links.find((l) => l.includes(`type=${tipo}`));
      if (link) {
        if (!esLocal(link)) throw new Error(`El link del mail no es local: ${new URL(link).host}`);
        return link;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No llegó a Mailpit el mail de ${tipo} para ${email}`);
}

// Las tipografías de index.html: lo único de afuera que la app pide siempre.
const EXTERNOS_PERMITIDOS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

// Un contexto de navegador (= un navegador con su sessionStorage por pestaña)
// que no deja salir nada más de la máquina: si el frontend apuntara a
// producción (frontend/.env), los requests se cortan acá y el caso falla en vez
// de pegarle.
async function navegador(browser, externos) {
  const ctx = await browser.newContext({ locale: "es-AR" });
  await ctx.route("**/*", (route) => {
    const url = route.request().url();
    if (esLocal(url) || url.startsWith("data:")) return route.continue();
    if (EXTERNOS_PERMITIDOS.has(new URL(url).host)) return route.continue();
    externos.push(new URL(url).host);
    return route.abort();
  });
  return ctx;
}

// /api/me de una pestaña: con qué status respondió cada vez.
function contarMe(page) {
  const statuses = [];
  page.on("response", (r) => {
    if (new URL(r.url()).pathname === "/api/me") statuses.push(r.status());
  });
  return statuses;
}

async function textoDe(page) {
  return (await page.innerText("body")).replace(/\s+/g, " ").trim();
}

async function casoRecuperacion(browser, nombre, { otraPestana }) {
  const externos = [];
  const email = await usuarioDePrueba(nombre);
  const ctxApp = await navegador(browser, externos);

  const app = await ctxApp.newPage();
  const meDeLaApp = contarMe(app);
  await app.goto(`${FRONT}/forgot-password`);
  await app.fill('input[type="email"]', email);
  await app.click('button[type="submit"]');
  await app.getByText("Revisá tu email").waitFor({ timeout: 15000 });
  const link = await linkDelMail(email, "recovery");

  // otra-pestana: el link en otra pestaña del mismo navegador, con la de
  // /forgot-password abierta. limpio: otro navegador, sin la pestaña.
  const ctxLink = otraPestana ? ctxApp : await navegador(browser, externos);
  if (!otraPestana) await app.close();
  const pestana = await ctxLink.newPage();
  await pestana.goto(link);
  await pestana.waitForLoadState("networkidle").catch(() => undefined);
  await pestana.waitForTimeout(3000);

  const texto = await textoDe(pestana);
  const formulario = await pestana.getByLabel("Confirmar contraseña").count();
  const fallas = [];
  if (!formulario) fallas.push("no se ve el formulario de nueva contraseña");
  if (/no es válido o expiró/.test(texto)) fallas.push('dice "no es válido o expiró"');
  if (otraPestana && meDeLaApp.length > 0) {
    fallas.push(`la pestaña de /forgot-password pidió /api/me (${meDeLaApp.join(", ")})`);
  }
  if (externos.length) fallas.push(`requests fuera de la máquina: ${[...new Set(externos)]}`);
  return { fallas, texto: texto.slice(0, 160) };
}

async function casoInvitacion(browser) {
  const externos = [];
  const ctx = await navegador(browser, externos);
  const app = await ctx.newPage();
  const meDeLaApp = contarMe(app);
  await app.goto(`${FRONT}/login`);
  await app.waitForLoadState("networkidle").catch(() => undefined);

  const email = await invitacionDePrueba();
  const link = await linkDelMail(email, "invite");
  const pestana = await ctx.newPage();
  await pestana.goto(link);
  await pestana.waitForLoadState("networkidle").catch(() => undefined);
  await pestana.waitForTimeout(3000);

  const texto = await textoDe(pestana);
  const fallas = [];
  if (!/Completá tu cuenta/.test(texto)) fallas.push('no se ve "Completá tu cuenta"');
  if (/no es válido o expiró/.test(texto)) fallas.push('dice "no es válido o expiró"');
  if (meDeLaApp.length > 0) {
    fallas.push(`la pestaña de /login pidió /api/me (${meDeLaApp.join(", ")})`);
  }
  if (externos.length) fallas.push(`requests fuera de la máquina: ${[...new Set(externos)]}`);
  return { fallas, texto: texto.slice(0, 160) };
}

const CASOS = {
  "otra-pestana": (browser) => casoRecuperacion(browser, "otra-pestana", { otraPestana: true }),
  limpio: (browser) => casoRecuperacion(browser, "limpio", { otraPestana: false }),
  invitacion: casoInvitacion,
};

let fallaron = 0;
const browser = await chromium.launch();
try {
  for (const [nombre, correr] of Object.entries(CASOS)) {
    if (CASOS_PEDIDOS && !CASOS_PEDIDOS.includes(nombre)) continue;
    try {
      const { fallas, texto } = await correr(browser);
      if (fallas.length) {
        fallaron++;
        console.log(`✗ ${nombre}: ${fallas.join("; ")}\n    pantalla: ${texto}`);
      } else {
        console.log(`✓ ${nombre}`);
      }
    } catch (error) {
      fallaron++;
      console.log(`✗ ${nombre}: ${error instanceof Error ? error.message : error}`);
    }
  }
} finally {
  await browser.close();
  for (const id of creados.usuarios) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.error(`No se pudo borrar el usuario de prueba ${id}: ${error.message}`);
  }
  if (creados.mails.length) {
    await fetch(`${MAIL}/api/v1/messages`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ IDs: creados.mails }),
    }).catch((error) => console.error(`No se pudieron borrar los mails de prueba: ${error}`));
  }
}

console.log(fallaron ? `\n${fallaron} caso(s) fallaron.` : "\nTodo bien.");
process.exit(fallaron ? 1 : 0);
