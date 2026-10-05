// ¿Esta connection string apunta a una base en esta misma máquina? Es la
// pregunta que se hacen los frenos de seguridad del repo antes de hacer algo
// que no debe pasar contra producción: los scripts de sondeo y siembra
// (scripts/sonda-matriz-crm.ts, scripts/seed-dev-data.ts) y el arranque de los
// workers en desarrollo (workersHabilitados.ts, G-02 de la auditoría del
// 24/09). Vive en un solo lugar para que los tres respondan lo mismo.
//
// Se compara el hostname PARSEADO, no un substring de la URL: una contraseña o
// un nombre de base que contengan "localhost" no pueden colar una URL remota.
// Una URL que no se puede parsear no es local: si no se puede comprobar, el
// freno frena.

// new URL() devuelve las IPv6 entre corchetes ("[::1]").
const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function esHostLocal(hostname: string): boolean {
  return HOSTS_LOCALES.has(hostname.toLowerCase());
}

export function hostDeLaUrl(url: string | undefined): string | null {
  if (!url || url.trim().length === 0) return null;
  try {
    return new URL(url.trim()).hostname;
  } catch {
    return null;
  }
}

export function esUrlDeBaseLocal(url: string | undefined): boolean {
  const host = hostDeLaUrl(url);
  return host !== null && esHostLocal(host);
}

// ---------------------------------------------------------------------------
// El freno de la suite de integración: con NODE_ENV=test, DATABASE_URL y
// DIRECT_URL tienen que ser locales, o el proceso aborta.
//
// POR QUÉ EXISTE — incidente del 27/09/2026: `npm run test:integration` corrió
// ~1100 tests contra la base de PRODUCCIÓN. @prisma/client carga `.env` por su
// cuenta AL IMPORTARSE (no al construir el cliente), y en los archivos de test
// se importaba antes que config/env.ts; como dotenv no pisa variables ya
// seteadas, `.env.test` llegaba tarde y DATABASE_URL quedaba la del `.env`
// (el proyecto real). El arreglo de raíz es la precarga de config/env.ts en
// `test:integration` (package.json); esto es la red por si otro camino vuelve
// a abrir el mismo agujero: la suite falla ruidosamente en el primer archivo
// en vez de correr contra producción.
//
// Una variable SIN setear no frena acá: sin URL no hay a qué conectarse, y
// Prisma falla solo. Lo peligroso es una URL remota.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// ¿ESTE PROCESO ESTÁ CORRIENDO TESTS? (FABLE-H-01 de
// docs-privados/auditoria-2026-10-05-FABLE.md, local.)
//
// El freno de arriba miraba solo NODE_ENV=test, que es lo que pone
// `npm run test:integration`. Pero un archivo de integración corrido suelto
// (`npx tsx --test src/x.integration-test.ts`, o desde el IDE) no lo trae:
// cargaba `.env` —que en la máquina de desarrollo apunta a la base real—, el
// freno no intervenía y el `before()` del test creaba organizaciones en
// producción. Lo mismo vale para los unitarios: ninguno debería tocar la
// base, y si uno lo hace por error no puede ser contra la real.
//
// Ahora "corriendo tests" es cualquiera de estas, sin depender de que alguien
// se acuerde de una variable:
//   - NODE_ENV=test;
//   - NODE_TEST_CONTEXT: la pone el test runner de Node en cada archivo que
//     lanza (`node --test`, `tsx --test`);
//   - el archivo que se ejecuta es un *.test.ts o *.integration-test.ts (el
//     caso de correrlo directo, sin `--test`).
// ---------------------------------------------------------------------------
const ARCHIVO_DE_TEST = /\.(integration-)?test\.[cm]?[jt]sx?$/;

export function correBajoTests(
  proceso: { env: Record<string, string | undefined>; argv: readonly string[] } = process,
): boolean {
  return (
    proceso.env.NODE_ENV === "test" ||
    proceso.env.NODE_TEST_CONTEXT !== undefined ||
    proceso.argv.slice(1).some((arg) => ARCHIVO_DE_TEST.test(arg))
  );
}

// Las variables que dicen CONTRA QUÉ se conecta un test: la base y Supabase
// Auth (los tests de integración crean usuarios con la service role).
const CONEXIONES_DE_TEST = [
  "DATABASE_URL",
  "DIRECT_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

// Corriendo tests, las conexiones son SIEMPRE las de `.env.test`, pisando lo
// que haya. Hace falta pisar: @prisma/client carga `.env` por su cuenta al
// importarse y dotenv no reemplaza variables ya puestas, así que sin esto un
// test que importa Prisma antes que config/env.ts se queda con la base del
// `.env`. Solo estas claves: el resto del entorno del test no cambia.
// Sin `.env.test` (el CI, que trae sus variables en el entorno) no hace nada,
// y el freno de abajo decide con lo que haya.
export function forzarConexionesDeTest(
  entorno: Record<string, string | undefined>,
  deEnvTest: Record<string, string> | null,
): void {
  if (deEnvTest === null) return;
  for (const nombre of CONEXIONES_DE_TEST) {
    const valor = deEnvTest[nombre];
    if (valor !== undefined) {
      entorno[nombre] = valor;
    }
  }
}

// El freno: corriendo tests, la base y Supabase tienen que ser locales, o el
// proceso aborta. `bajoTests` es inyectable para probarlo.
export function assertBaseLocalEnTest(
  entorno: {
    NODE_ENV?: string;
    DATABASE_URL?: string;
    DIRECT_URL?: string;
    SUPABASE_URL?: string;
  },
  bajoTests: boolean = correBajoTests(),
): void {
  if (entorno.NODE_ENV !== "test" && !bajoTests) return;
  for (const nombre of ["DATABASE_URL", "DIRECT_URL", "SUPABASE_URL"] as const) {
    const url = entorno[nombre];
    if (url !== undefined && url.trim() !== "" && !esUrlDeBaseLocal(url)) {
      throw new Error(
        `Corriendo tests con ${nombre} apuntando a un servidor que NO es local ` +
          `(${hostDeLaUrl(url) ?? "URL imparseable"}). Se aborta para no correr ` +
          "tests contra una base real. Los tests van contra el Supabase local " +
          "(`npm run supabase:start`), con sus URLs en `.env.test`.",
      );
    }
  }
}
