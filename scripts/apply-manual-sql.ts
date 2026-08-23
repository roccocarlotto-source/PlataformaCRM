import "dotenv/config";
import { spawnSync } from "node:child_process";

// R1.5 — reemplaza el paso manual documentado en README.md ("después de
// generar una migración nueva, reaplicar ambos a mano") por un único
// comando. Encadena, en orden:
//
//   1. `prisma migrate deploy` — aplica migraciones pendientes; a
//      diferencia de `migrate dev`, no interactúa ni regenera migraciones,
//      es el comando pensado para CI/producción.
//   2. Reaplicación de manual_constraints.sql (triggers, índices únicos
//      parciales, CHECK constraints).
//   3. Reaplicación de rls_policies.sql (políticas RLS).
//
// Ambos .sql son idempotentes (cada objeto se dropea antes de recrearse),
// así que correr este script en un deploy donde ninguno cambió es un no-op
// seguro, no un error.
//
// Requiere DIRECT_URL — se pasa como argumento explícito a cada comando en
// vez de interpolarse en un string de shell, para que el script funcione
// igual en bash (CI) y en PowerShell (desarrollo local en Windows).

const DIRECT_URL = process.env.DIRECT_URL;

if (!DIRECT_URL) {
  console.error(
    "apply-manual-sql: falta DIRECT_URL en el entorno. Es la conexión directa " +
      "a Postgres (no el pooler de DATABASE_URL) que requieren `prisma migrate " +
      "deploy` y `prisma db execute`.",
  );
  process.exit(1);
}

type Step = { label: string; args: string[] };

const steps: Step[] = [
  { label: "prisma migrate deploy", args: ["migrate", "deploy"] },
  {
    label: "reaplicar manual_constraints.sql",
    args: [
      "db",
      "execute",
      "--file",
      "prisma/sql/manual_constraints.sql",
      "--url",
      DIRECT_URL,
    ],
  },
  {
    label: "reaplicar rls_policies.sql",
    args: [
      "db",
      "execute",
      "--file",
      "prisma/sql/rls_policies.sql",
      "--url",
      DIRECT_URL,
    ],
  },
];

// Invoca el entry point JS de la CLI de Prisma directamente con el mismo
// binario de node que ya está corriendo este script, en vez de resolver
// "npx"/"prisma" por PATH. Evita por completo el problema de los shims
// .cmd en Windows (spawnSync falla con EINVAL al invocarlos sin shell, y
// shell:true con un array de args es exactamente lo que Node desaconseja:
// concatena los argumentos sin escapar en vez de pasarlos como argv real —
// riesgo real acá, ya que DIRECT_URL es una connection string con
// credenciales). node.exe es un ejecutable real en todas las plataformas,
// así que spawnSync lo resuelve sin necesidad de shell ni de extensión.
const prismaCli = require.resolve("prisma/build/index.js");

for (const step of steps) {
  console.log(`\n> ${step.label}`);
  const result = spawnSync(process.execPath, [prismaCli, ...step.args], {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    console.error(`\napply-manual-sql: falló "${step.label}" — abortando.`);
    process.exit(result.status ?? 1);
  }
}

console.log("\napply-manual-sql: migraciones y SQL manual aplicados.");
