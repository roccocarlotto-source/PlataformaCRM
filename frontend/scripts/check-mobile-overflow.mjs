// ---------------------------------------------------------------------------
// Ninguna pantalla puede ser más ancha que un celular. Recorre las rutas del
// router a 375px (iPhone SE 3ª gen) y 390px (iPhone 13) con emulación de
// dispositivo real de Playwright (deviceScaleFactor, isMobile, touch) en
// WebKit, el motor de Safari y de Chrome en iPhone, y falla (exit 1) si
// alguna desborda.
//
// Por qué así y no con un viewport de escritorio angosto (como las capturas
// de la auditoría de diseño, que no lo vieron):
// - con isMobile, un contenido más ancho que la pantalla NO desborda: el
//   navegador agranda el viewport de layout (innerWidth pasa de 375 a 522) y
//   la página entera queda corrida — el "ashboard" cortado del iPhone. Por eso
//   todo se mide contra el ancho real del dispositivo (ver medir), y no solo
//   el scrollWidth del documento: también cada elemento que se pase de él;
// - el desborde lo disparaban datos de producción (montos grandes), no los
//   del seed: cada ruta se mide dos veces, con las respuestas del backend tal
//   cual y "estiradas" (nombres largos, un email largo, montos x1000).
//
// Las tablas anchas pueden deslizarse dentro de su .ds-table-wrap: eso no es
// desborde de página y no cuenta.
//
// También falla si algún campo editable (input de texto, select, textarea)
// tiene font-size computado menor a 16px: iOS hace zoom al enfocarlo y la
// página queda ampliada y deslizable de costado aunque nada sea más ancho.
// Las pantallas públicas (login, etc.) se miden además sin sesión.
//
// Necesita el stack LOCAL levantado, igual que test:integration:
//   - Supabase local (`npm run supabase:start` en la raíz);
//   - el backend en http://localhost:4000 y el frontend en
//     http://localhost:5173, ambos contra lo local (VITE_API_URL, etc.);
//   - un usuario ADMIN del Supabase local, por OVERFLOW_EMAIL. La sesión se
//     saca con un magic link del admin API, sin tocar su contraseña.
//   - WebKit de Playwright: `npx playwright install webkit` (una vez).
//
// uso (desde frontend/):
//   OVERFLOW_EMAIL=admin@example.com npm run check:mobile-overflow [-- filtro]
// El filtro es una regex sobre la ruta (ej. `-- "^/(|vouchers/scan)$"`).
//
// Las rutas con parámetros (/companies/:id/edit…) no se recorren: comparten
// el layout con su /new, que sí.
// ---------------------------------------------------------------------------
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { devices, webkit } from "playwright";

const FRONT = process.env.OVERFLOW_FRONT_URL ?? "http://localhost:5173";
const API = process.env.OVERFLOW_API_URL ?? "http://localhost:4000";
const EMAIL = process.env.OVERFLOW_EMAIL;
const FILTRO = process.argv[2] ? new RegExp(process.argv[2]) : null;
const DISPOSITIVOS = ["iPhone SE (3rd gen)", "iPhone 13"];

if (!EMAIL) {
  console.error("Falta OVERFLOW_EMAIL: el email de un ADMIN del Supabase local.");
  process.exit(2);
}

// Las rutas estáticas del router, leídas del propio router.tsx para que una
// pantalla nueva entre sola al chequeo.
function rutas() {
  const router = readFileSync(new URL("../src/app/router.tsx", import.meta.url), "utf8");
  const todas = [...router.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]);
  return [...new Set(todas)].filter((r) => !r.includes(":") && r !== "*");
}

// Las claves del stack local salen de `supabase status`, no se copian acá.
function supabaseLocal() {
  const salida = execFileSync("npx", ["supabase", "status", "-o", "json"], {
    cwd: new URL("../..", import.meta.url),
    encoding: "utf8",
    shell: true,
  });
  const status = JSON.parse(salida.slice(salida.indexOf("{")));
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(status.API_URL)) {
    throw new Error(`Supabase no es local: ${status.API_URL}`);
  }
  return status;
}

async function sesion({ API_URL, SECRET_KEY, PUBLISHABLE_KEY }) {
  const opciones = { auth: { persistSession: false } };
  const admin = createClient(API_URL, SECRET_KEY, opciones);
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
  if (error) throw error;
  const anon = createClient(API_URL, PUBLISHABLE_KEY, opciones);
  const verificado = await anon.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (verificado.error) throw verificado.error;
  // La misma clave que usa supabase-js en el navegador: sb-<host>-auth-token.
  const clave = `sb-${new URL(API_URL).hostname.split(".")[0]}-auth-token`;
  return { clave, valor: JSON.stringify(verificado.data.session) };
}

// Datos "de producción" sobre las respuestas reales. Solo nombres, emails y
// montos: tocar contadores (total, totalPages) rompe la paginación, no el
// layout.
const NOMBRES =
  /^(name|fullName|title|label|firstName|lastName|companyName|contactName|description|subject)$/;
const MONTOS = /amount|value|revenue|price/i;
function estirar(valor, clave) {
  if (Array.isArray(valor)) return valor.map((v) => estirar(v, clave));
  if (valor && typeof valor === "object") {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, estirar(v, k)]));
  }
  if (typeof valor === "string" && NOMBRES.test(clave)) {
    return `${valor} Distribuidora Automotriz del Litoral`;
  }
  if (typeof valor === "string" && /^email$/i.test(clave)) {
    return "administracion.comercial.sucursal@concesionaria-ejemplo.com.ar";
  }
  if (MONTOS.test(clave) && typeof valor === "number") return valor * 1000 + 123456789;
  if (MONTOS.test(clave) && typeof valor === "string" && /^-?\d+(\.\d+)?$/.test(valor)) {
    return String(Number(valor) * 1000 + 123456789);
  }
  return valor;
}

// Corre en la página. `dispositivo` es el ancho del descriptor; el ancho real
// es el menor entre ese, el viewport visual y el clientWidth del documento:
// con isMobile, innerWidth (y a veces el viewport visual, alejado para que
// entre todo) crecen con el contenido y un chequeo contra ellos da verde.
//
// Además de las medidas de documento, marca CUALQUIER elemento cuyo borde
// pase el ancho real, aunque el documento no desborde: html, body y
// .ds-shell-body recortan (overflow-x: clip), así que un contenido ancho ya
// no agranda nada medible a nivel página — queda cortado, que es el mismo
// defecto. Lo que vive dentro de un contenedor con scroll o recorte propio
// (.ds-table-wrap, el calendario, el hilo de un chat) no cuenta: se mide el
// contenedor, no lo de adentro.
function medir(dispositivo) {
  const ancho = Math.min(
    dispositivo,
    window.visualViewport?.width ?? dispositivo,
    document.documentElement.clientWidth || dispositivo,
  );
  const medidas = [
    ["innerWidth", window.innerWidth],
    ["documento", document.documentElement.scrollWidth],
  ];
  for (const selector of [".ds-shell-body", "main"]) {
    const el = document.querySelector(selector);
    if (el) medidas.push([selector, el.scrollWidth - el.clientWidth + ancho]);
  }
  const desbordes = medidas.filter(([, valor]) => valor > ancho + 1);

  // Las guardas de página: su recorte es justamente lo que esconde el
  // desborde, no un contenedor legítimo.
  const guardas = new Set([
    document.documentElement,
    document.body,
    ...document.querySelectorAll("#root, .ds-shell, .ds-shell-body, .ds-shell-body > main"),
  ]);
  const contenido = (el) => {
    for (let p = el.parentElement; p && !guardas.has(p); p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== "visible") return true;
    }
    return false;
  };
  const sale = (el) => {
    const caja = el.getBoundingClientRect();
    return caja.width > 0 && (caja.right > ancho + 1 || caja.left < -1);
  };
  const nombre = (el) => {
    const clase = String(el.className?.baseVal ?? el.className).split(" ")[0];
    return `${el.tagName.toLowerCase()}${clase ? `.${clase}` : ""}`;
  };
  const culpables = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest(".ds-sidebar") || getComputedStyle(el).visibility === "hidden") continue;
    if (!sale(el) || contenido(el)) continue;
    // Solo el más externo de cada rama: el que sale de un padre que entra.
    if (el.parentElement && !guardas.has(el.parentElement) && sale(el.parentElement)) continue;
    const caja = el.getBoundingClientRect();
    const padre =
      el.parentElement && !guardas.has(el.parentElement) ? `${nombre(el.parentElement)} > ` : "";
    culpables.push(`${padre}${nombre(el)} (${Math.round(caja.left)}–${Math.round(caja.right)}px)`);
    if (culpables.length >= 5) break;
  }
  if (culpables.length > 0 && desbordes.length === 0) desbordes.push(["elementos", ancho]);

  // Campos editables con menos de 16px: Safari y Chrome de iPhone hacen zoom
  // al enfocarlos y la página queda ampliada y deslizable de costado (ver la
  // regla de 16px en design-system.css). Se miran todos los del DOM, también
  // los ocultos: la regla es de CSS y no depende de que estén a la vista.
  const NO_EDITABLES = /^(checkbox|radio|range|color|file|button|submit|reset|image|hidden)$/;
  const chicos = [];
  for (const el of document.querySelectorAll(
    "input, select, textarea, [contenteditable]:not([contenteditable='false'])",
  )) {
    if (el.tagName === "INPUT" && NO_EDITABLES.test(el.type)) continue;
    const tamaño = parseFloat(getComputedStyle(el).fontSize);
    if (tamaño < 16) {
      const tipo = el.tagName === "INPUT" ? `[type=${el.type}]` : "";
      chicos.push(`${nombre(el)}${tipo} ${tamaño}px`);
      if (chicos.length >= 5) break;
    }
  }
  return { ancho, desbordes, culpables, chicos };
}

async function medirRuta(contexto, ruta, ancho, conDatosEstirados) {
  const pagina = await contexto.newPage();
  try {
    // Nada sale a internet salvo las fuentes.
    await pagina.route(
      /^https?:\/\/(?!localhost|127\.0\.0\.1|fonts\.(googleapis|gstatic)\.com)/,
      (r) => r.abort(),
    );
    if (conDatosEstirados) {
      await pagina.route(`${API}/api/**`, async (r) => {
        const respuesta = await r.fetch();
        const tipo = respuesta.headers()["content-type"] ?? "";
        if (!tipo.includes("json") || /\/api\/me(\?|$)/.test(r.request().url())) {
          return r.fulfill({ response: respuesta });
        }
        return r.fulfill({ response: respuesta, json: estirar(await respuesta.json(), "") });
      });
    }
    await pagina.goto(FRONT + ruta, { waitUntil: "domcontentloaded", timeout: 15000 });
    await pagina.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
    await pagina.waitForTimeout(300);
    return await pagina.evaluate(medir, ancho);
  } finally {
    await pagina.close();
  }
}

// Las rutas fuera de ProtectedRoute, que se miden también sin sesión.
const PUBLICAS = ["/login", "/forgot-password", "/reset-password", "/invite/accept"];

const status = supabaseLocal();
const { clave, valor } = await sesion(status);
const navegador = await webkit.launch();
const fallas = [];

function registrar(donde, { desbordes, culpables, chicos }) {
  if (desbordes.length > 0) {
    const detalle = desbordes
      .map(([que, px]) => (que === "elementos" ? `elementos fuera de ${px}px` : `${que} ${px}px`))
      .join(", ");
    fallas.push(`${donde}: ${detalle} — ${culpables.join(", ")}`);
  }
  if (chicos.length > 0) {
    fallas.push(
      `${donde}: campos con menos de 16px (zoom de iOS al enfocar) — ${chicos.join(", ")}`,
    );
  }
}
try {
  for (const nombre of DISPOSITIVOS) {
    // Sin defaultBrowserType: es un dato del descriptor, no una opción de contexto.
    const dispositivo = { ...devices[nombre] };
    delete dispositivo.defaultBrowserType;
    const contexto = await navegador.newContext({ ...dispositivo, locale: "es-AR" });
    await contexto.addInitScript(
      ([k, v]) => {
        try {
          sessionStorage.setItem(k, v);
        } catch {
          // Sin storage la ruta cae al login, que también se mide.
        }
      },
      [clave, valor],
    );
    for (const ruta of rutas()) {
      if (FILTRO && !FILTRO.test(ruta)) continue;
      for (const conDatosEstirados of [false, true]) {
        const datos = conDatosEstirados ? "datos estirados" : "datos reales";
        const ancho = dispositivo.viewport.width;
        // Un reintento si la página no carga (Vite en frío, la máquina
        // ocupada); si tampoco, cuenta como falla: no se pudo medir.
        let medida;
        try {
          medida = await medirRuta(contexto, ruta, ancho, conDatosEstirados).catch(() =>
            medirRuta(contexto, ruta, ancho, conDatosEstirados),
          );
        } catch (err) {
          fallas.push(`${nombre} · ${ruta} · ${datos}: no cargó (${err.message.split("\n")[0]})`);
          continue;
        }
        registrar(`${nombre} · ${ruta} · ${datos}`, medida);
      }
      process.stdout.write(".");
    }
    await contexto.close();

    // Las pantallas sin sesión (el login es el primer campo que se enfoca):
    // con sesión, /login redirige y sus campos nunca se medirían.
    const sinSesion = await navegador.newContext({ ...dispositivo, locale: "es-AR" });
    for (const ruta of PUBLICAS) {
      if (FILTRO && !FILTRO.test(ruta)) continue;
      try {
        registrar(
          `${nombre} · ${ruta} · sin sesión`,
          await medirRuta(sinSesion, ruta, dispositivo.viewport.width, false),
        );
      } catch (err) {
        fallas.push(`${nombre} · ${ruta} · sin sesión: no cargó (${err.message.split("\n")[0]})`);
      }
      process.stdout.write(".");
    }
    await sinSesion.close();
  }
} finally {
  await navegador.close();
}

console.log("");
if (fallas.length > 0) {
  console.error(`${fallas.length} pantalla(s) que no pasan en el celular:`);
  for (const falla of fallas) console.error(`  ${falla}`);
  process.exit(1);
}
console.log("Ninguna pantalla desborda a 375px ni a 390px, y ningún campo tiene menos de 16px.");
