import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  countOutboxEventsPurgables,
  DIAS_DE_RETENCION_OUTBOX_EVENT,
  fechaDeCorteDeRetencionOutbox,
  purgeOutboxEvents,
} from "../src/repositories/outboxEvent.repository";

// ---------------------------------------------------------------------------
// Purga de retención de `outbox_events` — la contracara de
// scripts/purge-ingestion-events.ts, con el mismo criterio y la misma forma.
//
// QUÉ BORRA: las filas PROCESSED y DEAD_LETTER más viejas que la retención. Las
// PENDING no se tocan nunca, por vieja que sea la fila — una PENDING vieja es
// un evento que todavía no se entregó, o sea un problema que hay que mirar, no
// basura que haya que barrer.
//
// DEAD_LETTER se purga junto con PROCESSED, y es una decisión, no un descuido.
// Es tentador conservarlo para siempre "por si alguien lo mira", pero un
// DEAD_LETTER de hace tres meses ya no se puede accionar: el destino cambió y el
// payload describe un estado que no existe. Lo que hay que hacer con un
// DEAD_LETTER es mirarlo DENTRO de la ventana; el worker lo avisa con un warn
// dedicado cuando ocurre, justamente para que eso pase.
//
// ESTE ARCHIVO NO DECIDE NADA, mismo criterio que la otra purga: el qué se borra
// vive en el repositorio, en un único `where` que comparten el conteo y el
// borrado, así que --dry-run no puede mentir sobre lo que el borrado real haría.
//
// POR QUÉ MANUAL Y NO UN CRON: el proyecto no tiene scheduler ni pipeline de CD.
// Declarar un cron que nada ejecuta sería peor que no tenerlo, porque daría la
// retención por resuelta. Mismo razonamiento que en la purga de ingesta y en la
// de identidades sin confirmar.
// ---------------------------------------------------------------------------

async function main() {
  // --dry-run cuenta y no borra. Existe porque esto es un DELETE físico sobre
  // datos que no se recuperan: ver el número antes de ejecutar es la diferencia
  // entre una purga y un accidente.
  const dryRun = process.argv.includes("--dry-run");
  const corte = fechaDeCorteDeRetencionOutbox();

  console.log("Purga de retención de outbox_events");
  console.log(`  Política: ${String(DIAS_DE_RETENCION_OUTBOX_EVENT)} días (PROCESSED/DEAD_LETTER)`);
  console.log(`  Corte:    created_at < ${corte.toISOString()}`);
  console.log(`  Modo:     ${dryRun ? "DRY-RUN (no borra nada)" : "BORRADO REAL"}`);
  console.log("");

  if (dryRun) {
    const alcanzados = await countOutboxEventsPurgables(corte);
    console.log(`${String(alcanzados)} evento(s) serían borrados. No se borró nada.`);
    return;
  }

  const { count } = await purgeOutboxEvents(corte);

  // NUNCA en silencio: una purga que no dice cuánto borró no deja rastro de
  // haberse cumplido. Un 0 también es información — significa que no había nada
  // vencido, no que el script no corrió.
  console.log(`${String(count)} evento(s) borrados.`);
}

main()
  .catch((err: unknown) => {
    // Falla ruidoso y con código distinto de cero: una purga que se cortó a
    // mitad de camino no puede leerse como una purga hecha.
    console.error(
      `\npurge-outbox-events: la purga falló — ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
