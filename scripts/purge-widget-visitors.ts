import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  countVisitantesPurgables,
  DIAS_DE_GRACIA_VISITANTE_SIN_MENSAJES,
  fechaDeCorteDeVisitantes,
  purgeVisitantesSinMensajes,
} from "../src/services/widgetContact.service";

// ---------------------------------------------------------------------------
// Purga de los Contact "Visitante" del widget que nunca escribieron — ítem 138
// (B-10/F-05) de docs/auditoria-2026-09-24-punta-a-punta.md.
//
// ESTE ARCHIVO NO DECIDE NADA, igual que scripts/purge-ingestion-events.ts:
// qué entra en la purga vive en buildVisitantesPurgablesWhere
// (widgetContact.service.ts), un único `where` que comparten el conteo y la
// baja. Acá solo está el envoltorio de línea de comandos.
//
// ES UN SOFT DELETE (deletedAt), no un DELETE: el Contact desaparece del CRM
// pero la fila sigue ahí, y se revierte con un UPDATE. Ver el porqué en el
// servicio.
//
// MANUAL, SIN CRON: mismo motivo que las otras purgas — el proyecto no tiene
// scheduler, y declarar uno que nada ejecuta daría el problema por resuelto.
// Cuándo y cómo programarlo (cron del PaaS, tarea manual periódica) queda
// para decidir.
//
// Uso:
//   npm run purge:widget-visitors -- --dry-run   # cuenta, no toca nada
//   npm run purge:widget-visitors                # da de baja
//
// Corre sobre TODAS las organizaciones y necesita DATABASE_URL de la base a
// purgar. Correr siempre primero el --dry-run.
// ---------------------------------------------------------------------------

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const corte = fechaDeCorteDeVisitantes();

  console.log('Purga de Contacts "Visitante" del widget sin mensajes del cliente');
  console.log(`  Gracia:  ${String(DIAS_DE_GRACIA_VISITANTE_SIN_MENSAJES)} días`);
  console.log(`  Corte:   created_at < ${corte.toISOString()}`);
  console.log(`  Modo:    ${dryRun ? "DRY-RUN (no toca nada)" : "BAJA REAL (soft delete)"}`);
  console.log("");

  if (dryRun) {
    const alcanzados = await countVisitantesPurgables(corte);
    console.log(`${String(alcanzados)} contacto(s) serían dados de baja. No se tocó nada.`);
    return;
  }

  const { count } = await purgeVisitantesSinMensajes(corte);

  // Nunca en silencio, mismo criterio que purge-ingestion-events: un 0 es
  // información (no había nada), no ausencia de corrida.
  console.log(`${String(count)} contacto(s) dados de baja.`);
}

main()
  .catch((err: unknown) => {
    console.error(
      `\npurge-widget-visitors: la purga falló — ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
