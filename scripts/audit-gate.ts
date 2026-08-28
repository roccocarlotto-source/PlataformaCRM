import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Gate de vulnerabilidades de dependencias — hallazgo S-3 de
// docs/review-ingesta-2026-08-27.md.
//
// EL PROBLEMA QUE RESUELVE: el pipeline corría typecheck, build, unit, lint,
// prettier, migraciones, verify:schema e integración, y NADA que mirara las
// dependencias. Las dos vulnerabilidades que encontró el review (S-1 y S-2)
// aparecieron corriendo `npm audit` a mano. Sin un gate, la próxima entra sin
// que nada lo diga.
//
// POR QUÉ UN SCRIPT PROPIO Y NO `audit-ci` U OTRO PAQUETE: el proyecto ya
// resuelve esta clase de cosas sin dependencias externas (el runner de tests es
// el nativo de node, `npm test`). Todo lo que hace falta acá es parsear un JSON
// y compararlo contra una lista — agregar un paquete para eso sumaría una
// dependencia más al árbol que este mismo script tiene que auditar.
//
// POR QUÉ NO ALCANZA `--audit-level=high` A SECAS: silenciaría por severidad,
// no por advisory. Eso deja pasar cualquier vulnerabilidad futura que caiga en
// el mismo nivel que la que decidimos aceptar, sin que nadie lo decida. Acá la
// excepción es por GHSA ID, con su motivo escrito y su hallazgo referenciado:
// si aparece otra cosa high o critical, esto falla aunque sea de la misma
// severidad que una ya aceptada.
//
// POR QUÉ LEE UN ARCHIVO Y NO EJECUTA `npm audit` ÉL MISMO: en Windows `npm` es
// un shim .cmd, y spawnSync sobre un .cmd sin shell falla con EINVAL — el mismo
// problema que documenta scripts/apply-manual-sql.ts. Que el JSON lo produzca
// quien invoca (CI o la persona) mantiene este script portable y, de paso,
// testeable contra un archivo armado a mano.
//
// POR QUÉ CONOCE EL WORKSPACE — hallazgo S2-1 de
// docs/review-fase2-2026-08-28.md. El gate cubría solo el paquete raíz, y el
// frontend —la mitad de la Fase 2— no lo pasaba por ningún lado. Extenderlo era
// correr el mismo script sobre un segundo JSON, pero las excepciones NO son
// compartidas: la de uuid/exceljs es un árbol de dependencias que el frontend
// ni siquiera tiene. Una excepción heredada silenciaría en un paquete una
// advisory que nadie verificó ahí, que es exactamente lo que este gate existe
// para no permitir. Por eso cada excepción declara a qué workspace pertenece y
// solo se aplica en ese.
// ---------------------------------------------------------------------------

// Los dos paquetes del repo. No es una lista abierta a propósito: si algún día
// hay un tercero, agregarlo acá obliga a decidir qué excepciones le tocan.
const WORKSPACES = ["backend", "frontend"] as const;
type Workspace = (typeof WORKSPACES)[number];

interface Excepcion {
  // El identificador estable de la advisory. Es lo que se comparte entre
  // versiones y ecosistemas; el `source` numérico de npm no lo es.
  ghsa: string;
  paquete: string;
  // En qué workspace se verificó que no es alcanzable. Una excepción vale para
  // ESE árbol de dependencias y no para el otro: el mismo GHSA puede llegar por
  // otro camino, en otra versión y con otro uso, y ahí la verificación que
  // respalda esta línea ya no dice nada.
  workspace: Workspace;
  motivo: string;
  // De dónde sale la decisión de aceptarla. Sin esto, dentro de seis meses la
  // excepción es una línea sin dueño que nadie se anima a sacar.
  hallazgo: string;
}

// ---------------------------------------------------------------------------
// LA LISTA DE EXCEPCIONES. Agregar una entrada acá es una DECISIÓN, no un
// trámite para desbloquear el pipeline: exige haber verificado por qué la
// vulnerabilidad no es alcanzable en este código, y dejarlo escrito.
// ---------------------------------------------------------------------------
const EXCEPCIONES: Excepcion[] = [
  {
    ghsa: "GHSA-w5hq-g745-h8pq",
    paquete: "uuid",
    workspace: "backend",
    motivo:
      "Llega como dependencia transitiva de exceljs (uuid@8.3.2). La advisory afecta a v3/v5/v6 " +
      "cuando se pasa el argumento `buf`, y exceljs usa exclusivamente v4 sin `buf` " +
      "(lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js): verificado no alcanzable. No hay " +
      "arreglo no disruptivo — `npm audit fix --force` degradaría exceljs a 3.4.0.",
    hallazgo: "S-1, docs/review-ingesta-2026-08-27.md",
  },
];

// Severidades que bloquean. `moderate` y por debajo se reportan en el resumen
// de npm pero no frenan el pipeline: el umbral es el mismo que usa el review.
const BLOQUEAN = new Set(["high", "critical"]);

// Forma del JSON de `npm audit --json` (auditReportVersion 2). Solo se declara
// lo que este script lee.
interface ViaObjeto {
  source?: number;
  name?: string;
  url?: string;
  severity?: string;
  title?: string;
}

interface Vulnerabilidad {
  name?: string;
  severity?: string;
  // Un string significa "afectado a través de este otro paquete"; la advisory
  // real vive en la entrada de ese otro paquete. Un objeto ES la advisory.
  via?: (string | ViaObjeto)[];
}

interface ReporteAudit {
  auditReportVersion?: number;
  vulnerabilities?: Record<string, Vulnerabilidad>;
  metadata?: { vulnerabilities?: Record<string, number> };
}

// ---------------------------------------------------------------------------
// Argumentos: [archivo] [--workspace=backend|frontend].
//
// El workspace por defecto es `backend` para que la invocación histórica
// —`npm run audit:gate` sin argumentos, desde la raíz— siga significando
// exactamente lo mismo que antes de S2-1.
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const archivo = args.find((a) => !a.startsWith("--")) ?? "npm-audit.json";

const workspaceArg = args.find((a) => a.startsWith("--workspace="))?.split("=")[1];

if (workspaceArg !== undefined && !WORKSPACES.includes(workspaceArg as Workspace)) {
  // FALLA RUIDOSO, por el mismo criterio que el JSON ilegible: un workspace mal
  // escrito no debe degradar a "el de siempre" en silencio. Con un typo, el
  // gate estaría auditando el JSON de un paquete con las excepciones de otro.
  console.error(
    `audit-gate: workspace desconocido "${workspaceArg}". Valores válidos: ${WORKSPACES.join(", ")}.`,
  );
  process.exit(1);
}

const workspace: Workspace = (workspaceArg as Workspace | undefined) ?? "backend";

// Solo las excepciones verificadas para ESTE workspace. El resto no existe acá.
const EXCEPCIONES_DEL_WORKSPACE = EXCEPCIONES.filter((e) => e.workspace === workspace);

let reporte: ReporteAudit;

try {
  reporte = JSON.parse(readFileSync(archivo, "utf8")) as ReporteAudit;
} catch (err) {
  // FALLA RUIDOSO Y NO PASA. Un JSON ausente o ilegible significa que `npm
  // audit` no corrió como se esperaba (red caída, flag mal escrito), y tratar
  // eso como "no hay vulnerabilidades" convertiría el gate en decoración.
  console.error(
    `audit-gate: no se pudo leer el reporte de auditoría en "${archivo}": ` +
      `${err instanceof Error ? err.message : String(err)}`,
  );
  console.error(
    "audit-gate: se esperaba la salida de `npm audit --omit=dev --json`. El gate NO pasa sin ella.",
  );
  process.exit(1);
}

if (reporte.auditReportVersion !== 2) {
  // La forma del JSON cambió entre versiones mayores de npm. Adivinar cómo
  // leerlo sería peor que avisar: un parseo equivocado no encuentra nada y el
  // gate diría OK sobre un reporte que no entendió.
  console.error(
    `audit-gate: auditReportVersion inesperado (${String(reporte.auditReportVersion)}); ` +
      "este script está escrito contra la versión 2. Revisar el formato antes de confiar en el gate.",
  );
  process.exit(1);
}

interface Advisory {
  ghsa: string;
  paquete: string;
  severidad: string;
  titulo: string;
  url: string;
}

// Se recorren TODAS las vulnerabilidades y se juntan las advisories reales (las
// entradas `via` que son objetos). Las `via` de tipo string son punteros al
// paquete que las arrastra, y su advisory ya aparece en la entrada de ese otro
// paquete — juntarlas de nuevo sería contar dos veces lo mismo.
const advisories = new Map<string, Advisory>();

for (const vuln of Object.values(reporte.vulnerabilities ?? {})) {
  for (const via of vuln.via ?? []) {
    if (typeof via === "string") continue;

    const severidad = (via.severity ?? vuln.severity ?? "unknown").toLowerCase();
    if (!BLOQUEAN.has(severidad)) continue;

    // Si no hay GHSA identificable se usa el `source` numérico. Nunca va a
    // matchear una excepción, así que el caso desconocido BLOQUEA en vez de
    // colarse: fail-closed a propósito.
    const ghsa = /GHSA-[a-z0-9-]+/i.exec(via.url ?? "")?.[0] ?? `npm-source-${String(via.source)}`;

    advisories.set(ghsa, {
      ghsa,
      paquete: via.name ?? vuln.name ?? "(desconocido)",
      severidad,
      titulo: via.title ?? "(sin título)",
      url: via.url ?? "(sin url)",
    });
  }
}

const exceptuadas = new Set(EXCEPCIONES_DEL_WORKSPACE.map((e) => e.ghsa));
const bloqueantes = [...advisories.values()].filter((a) => !exceptuadas.has(a.ghsa));
const aceptadas = [...advisories.values()].filter((a) => exceptuadas.has(a.ghsa));

const totales = reporte.metadata?.vulnerabilities ?? {};

console.log(`Gate de auditoría de dependencias (high/critical) — workspace: ${workspace}\n`);
console.log(
  `  Resumen de npm: ${String(totales.total ?? 0)} vulnerabilidad(es) — ` +
    `critical ${String(totales.critical ?? 0)}, high ${String(totales.high ?? 0)}, ` +
    `moderate ${String(totales.moderate ?? 0)}, low ${String(totales.low ?? 0)}`,
);
console.log(`  Advisories high/critical detectadas: ${String(advisories.size)}`);
console.log(
  `  Excepciones declaradas para este workspace: ${String(EXCEPCIONES_DEL_WORKSPACE.length)}` +
    ` (de ${String(EXCEPCIONES.length)} en total)`,
);

for (const exc of EXCEPCIONES_DEL_WORKSPACE) {
  const activa = advisories.has(exc.ghsa);
  console.log(
    `    · ${exc.ghsa} (${exc.paquete}) — ${
      activa
        ? "aceptada explícitamente (high/critical)"
        : "declarada, hoy no alcanza el umbral high/critical"
    } — ${exc.hallazgo}`,
  );
}

if (aceptadas.length > 0) {
  console.log("");
  for (const a of aceptadas) {
    const exc = EXCEPCIONES_DEL_WORKSPACE.find((e) => e.ghsa === a.ghsa);
    console.log(`  ACEPTADA  ${a.ghsa} (${a.paquete}, ${a.severidad}): ${a.titulo}`);
    console.log(`            motivo: ${exc?.motivo ?? "(sin motivo declarado)"}`);
  }
}

if (bloqueantes.length > 0) {
  console.error(
    `\nBLOQUEA: ${String(bloqueantes.length)} advisory high/critical sin excepción declarada.\n`,
  );
  for (const a of bloqueantes) {
    console.error(`  · ${a.ghsa} — ${a.paquete} (${a.severidad})`);
    console.error(`    ${a.titulo}`);
    console.error(`    ${a.url}`);
  }
  console.error(
    "\nResolvela con `npm audit fix`, o —si verificaste que no es alcanzable en este código—\n" +
      "agregá su GHSA a EXCEPCIONES en scripts/audit-gate.ts CON el motivo verificado, el\n" +
      "hallazgo que lo respalda y el workspace en el que lo verificaste — una excepción vale\n" +
      "para ese árbol de dependencias y no para el otro. Subir el umbral de severidad no es\n" +
      "una opción: silenciaría también todo lo que venga después.",
  );
  process.exit(1);
}

console.log("\nOK: ninguna advisory high/critical sin excepción declarada.");
