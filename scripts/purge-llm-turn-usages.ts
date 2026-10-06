import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  countLlmTurnUsagesPurgables,
  DIAS_DE_RETENCION_LLM_TURN_USAGE,
  fechaDeCorteDeRetencionLlmTurnUsage,
  purgeLlmTurnUsages,
} from "../src/repositories/llmTurnUsage.repository";

// ---------------------------------------------------------------------------
// Purga de retención de `llm_turn_usages` (B4) — la misma forma que
// scripts/purge-outbox-events.ts, con el mismo criterio.
//
// QUÉ BORRA: las filas de uso más viejas que la retención (365 días; ver
// DIAS_DE_RETENCION_LLM_TURN_USAGE). No hay estados: toda fila vencida es
// purgable. Lo que se pierde es el detalle por turno de hace más de un año;
// el log de producción (FABLE-G-04) sigue teniendo cada turno.
//
// ESTE ARCHIVO NO DECIDE NADA: el qué se borra vive en el repositorio, en un
// único `where` que comparten el conteo y el borrado, así que --dry-run no
// puede mentir sobre lo que el borrado real haría.
//
// POR QUÉ MANUAL Y NO UN CRON: el proyecto no tiene scheduler ni pipeline de
// CD. Mismo razonamiento que las otras purgas.
// ---------------------------------------------------------------------------

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const corte = fechaDeCorteDeRetencionLlmTurnUsage();

  console.log("Purga de retención de llm_turn_usages");
  console.log(`  Política: ${String(DIAS_DE_RETENCION_LLM_TURN_USAGE)} días`);
  console.log(`  Corte:    created_at < ${corte.toISOString()}`);
  console.log(`  Modo:     ${dryRun ? "DRY-RUN (no borra nada)" : "BORRADO REAL"}`);
  console.log("");

  if (dryRun) {
    const alcanzados = await countLlmTurnUsagesPurgables(corte);
    console.log(`${String(alcanzados)} fila(s) serían borradas. No se borró nada.`);
    return;
  }

  const { count } = await purgeLlmTurnUsages(corte);
  // NUNCA en silencio: un 0 también es información.
  console.log(`${String(count)} fila(s) borradas.`);
}

main()
  .catch((err: unknown) => {
    console.error(
      `\npurge-llm-turn-usages: la purga falló — ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
