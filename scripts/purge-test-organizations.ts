import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  ejecutarPurga,
  parsearIdsProtegidos,
  PATRONES_DE_SLUG_DE_PRUEBA,
  simularPurga,
  type PlanDePurga,
} from "../src/services/testOrganizationsPurge.service";
import { hostDeLaUrl } from "../src/utils/baseLocal";

// ---------------------------------------------------------------------------
// Purga de las organizaciones que la suite de integración dejó en una base
// real (incidente del 27/09/2026).
//
// ESTE ARCHIVO NO DECIDE NADA, mismo criterio que las otras purgas: qué es una
// organización de test, cuáles están protegidas y en qué orden se borra vive
// en src/services/testOrganizationsPurge.service.ts. Acá solo está el
// envoltorio de línea de comandos.
//
// Uso:
//   PURGE_PROTECTED_ORG_IDS=<id>,<id> npm run purge:test-organizations
//       simulación (por defecto): lista qué se borraría, en una transacción
//       READ ONLY — no puede escribir nada.
//   PURGE_PROTECTED_ORG_IDS=<id>,<id> npm run purge:test-organizations -- --confirm
//       borra: una transacción por organización, más sus identidades de auth.
//
// PURGE_PROTECTED_ORG_IDS es obligatoria y lleva, como mínimo, AutoMax: los ids
// reales no se escriben en el repo, que es público. Las organizaciones de los
// platform admins se protegen solas. Correr SIEMPRE primero la simulación.
//
// Usa DATABASE_URL: la base que se purga es la que diga el entorno (.env).
// ---------------------------------------------------------------------------

const fecha = (d: Date): string => d.toISOString().replace("T", " ").slice(0, 19);

function imprimirPlan(plan: PlanDePurga): void {
  console.log("Organizaciones protegidas (no se tocan aunque coincidan):");
  for (const p of plan.protegidas) {
    const quien = p.name === null ? "(no existe en esta base)" : `${p.name} [${p.slug ?? ""}]`;
    const coincide = p.coincidiaConUnPatron ? " — COINCIDÍA con un patrón, excluida" : "";
    console.log(`  - ${p.id}  ${quien}  (${p.motivo})${coincide}`);
  }
  console.log("");

  const totales: Record<string, number> = {};
  plan.organizaciones.forEach((o, i) => {
    const filas = Object.entries(o.filasPorTabla).filter(([, n]) => n > 0);
    const total = filas.reduce((acc, [, n]) => acc + n, 0);
    for (const [t, n] of filas) totales[t] = (totales[t] ?? 0) + n;

    console.log(`[${String(i + 1)}/${String(plan.organizaciones.length)}] ${o.name}`);
    console.log(`    id:      ${o.id}`);
    console.log(`    slug:    ${o.slug}`);
    console.log(
      `    patrón:  ${o.patrones.map((p) => `${p.plantilla} (${p.origen})`).join(" | ")}`,
    );
    console.log(
      `    creada:  ${fecha(o.createdAt)} UTC${o.deletedAt ? `  · dada de baja ${fecha(o.deletedAt)} UTC` : ""}`,
    );
    console.log(
      `    filas:   ${filas.length === 0 ? "ninguna" : filas.map(([t, n]) => `${t} ${String(n)}`).join(" · ")}` +
        `  (total ${String(total)} + la organización; el resto de las tablas en 0)`,
    );
    if (o.identidades.length === 0) {
      console.log("    auth:    sin identidades vinculadas");
    }
    for (const id of o.identidades) {
      const destino = id.seBorra ? "SE BORRA" : `se conserva: ${id.motivoParaConservarla ?? ""}`;
      console.log(
        `    auth:    ${id.email ?? "(sin email)"}  ${id.id}  [${id.vinculo}] → ${destino}`,
      );
    }
  });

  console.log("");
  console.log(
    `Identidades de auth de test sin ninguna organización (${String(plan.identidadesHuerfanas.length)}, se borran):`,
  );
  for (const h of plan.identidadesHuerfanas) {
    console.log(`  - ${h.email}  ${h.id}  creada ${fecha(h.createdAt)} UTC`);
  }

  const identidades = plan.organizaciones.flatMap((o) => o.identidades);
  console.log("");
  console.log("Resumen");
  console.log(`  Organizaciones a borrar:          ${String(plan.organizaciones.length)}`);
  console.log(
    `  Filas por tabla:                  ${
      Object.keys(totales).length === 0
        ? "ninguna"
        : Object.entries(totales)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([t, n]) => `${t} ${String(n)}`)
            .join(" · ")
    }`,
  );
  console.log(
    `  Identidades de auth que se borran: ${String(identidades.filter((i) => i.seBorra).length)}` +
      ` (se conservan ${String(identidades.filter((i) => !i.seBorra).length)})` +
      ` + ${String(plan.identidadesHuerfanas.length)} sin organización`,
  );
  console.log(
    `  FKs que se anulan antes de borrar: ${plan.fksQueSeAnulan.join(", ") || "ninguna"}`,
  );
  console.log(
    `  Permiso DELETE sobre auth.users:  ${plan.puedeBorrarAuthUsers ? "sí" : "NO — el --confirm va a fallar"}`,
  );
}

async function main() {
  const confirmar = process.argv.includes("--confirm");
  const protegidas = parsearIdsProtegidos(process.env.PURGE_PROTECTED_ORG_IDS);

  console.log("Purga de organizaciones creadas por la suite de integración");
  console.log(`  Base:     ${hostDeLaUrl(process.env.DATABASE_URL) ?? "(DATABASE_URL sin host)"}`);
  console.log(
    `  Patrones: ${String(PATRONES_DE_SLUG_DE_PRUEBA.length)} (ver testOrganizationsPurge.service.ts)`,
  );
  console.log(
    `  Modo:     ${confirmar ? "BORRADO REAL" : "SIMULACIÓN (transacción read only, no borra nada)"}`,
  );
  console.log("");

  if (!confirmar) {
    imprimirPlan(await simularPurga(prisma, { protegidas }));
    console.log("\nNo se borró nada. Para borrar: --confirm");
    return;
  }

  const { plan, resultados, huerfanasBorradas } = await ejecutarPurga(prisma, { protegidas });
  imprimirPlan(plan);
  console.log("");
  for (const r of resultados) {
    console.log(
      r.ok
        ? `  OK     ${r.slug}: ${String(r.filasBorradas)} fila(s), ${String(r.identidadesBorradas)} identidad(es)`
        : `  FALLÓ  ${r.slug}: ${r.error ?? ""} (revertida entera)`,
    );
  }
  const fallidas = resultados.filter((r) => !r.ok).length;
  console.log(`\n${String(resultados.length - fallidas)} organización(es) borradas.`);
  console.log(`${String(huerfanasBorradas)} identidad(es) de test sin organización borradas.`);
  if (fallidas > 0) {
    // Ruidoso y con código distinto de cero: una purga parcial no puede leerse
    // como una purga hecha.
    throw new Error(`${String(fallidas)} organización(es) no se pudieron borrar`);
  }
}

main()
  .catch((err: unknown) => {
    console.error(
      `\npurge-test-organizations: la purga falló — ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
