import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  countIngestionEventsPurgables,
  DIAS_DE_RETENCION_INGESTION_EVENT,
  fechaDeCorteDeRetencion,
  purgeIngestionEvents,
} from "../src/repositories/ingestionEvent.repository";
import {
  contarSinConfirmarVencidos,
  corteDeSinConfirmar,
  descartarSinConfirmarVencidos,
  DIAS_PARA_DESCARTAR_SIN_CONFIRMAR,
} from "../src/repositories/importacion.repository";

// ---------------------------------------------------------------------------
// Purga de retención de `ingestion_events` — hallazgo D2-3 de
// docs-privados/review-fase2-2026-08-28.md (local, no está en GitHub).
//
// EL PROBLEMA QUE RESUELVE: `STD-LEG-002` exige que toda categoría de dato
// personal tenga política de retención, y `rawPayload` es el dato personal
// menos acotado del sistema — la fila cruda de un formulario, guardada
// indefinidamente. La política completa está en docs/data-classification.md
// §5.1; la consulta la especificaba §9.1 de docs/ingestion-architecture.md
// desde el ítem 2. Lo único que faltaba era algo que la corriera.
//
// ESTE ARCHIVO NO DECIDE NADA. El qué se borra vive en el repositorio
// (purgeIngestionEvents), en un único `where` que comparten el conteo y el
// borrado. Acá solo está el envoltorio de línea de comandos: parsear la
// bandera, imprimir y salir con el código correcto.
//
// POR QUÉ MANUAL Y NO UN CRON: el proyecto no tiene scheduler ni pipeline de
// CD. Declarar un cron que nada ejecuta sería peor que no tenerlo, porque
// daría la retención por resuelta. La consecuencia queda escrita en
// docs/data-classification.md §5.1: esto se cumple si alguien corre el
// comando.
//
// POR QUÉ IMPORTA src/ Y NO INVOCA LA CLI DE PRISMA, a diferencia de
// scripts/apply-manual-sql.ts: aquel encadena comandos de Prisma sobre
// archivos .sql y por eso necesita la CLI. Acá hay una sola operación de
// datos, con un `where` tipado que el cliente ya expresa; bajar a
// `prisma db execute` obligaría a interpolar la fecha en SQL crudo para no
// ganar nada, y dejaría la consulta duplicada fuera del alcance del test.
// ---------------------------------------------------------------------------

async function main() {
  // --dry-run cuenta y no borra. Existe porque esto es un DELETE físico sobre
  // datos que no se recuperan: ver el número antes de ejecutar es la
  // diferencia entre una purga y un accidente.
  const dryRun = process.argv.includes("--dry-run");
  const corte = fechaDeCorteDeRetencion();

  console.log("Purga de retención de ingestion_events");
  console.log(
    `  Política: ${String(DIAS_DE_RETENCION_INGESTION_EVENT)} días (PROCESSED/DUPLICATE)`,
  );
  console.log(`  Corte:    created_at < ${corte.toISOString()}`);
  console.log(`  Modo:     ${dryRun ? "DRY-RUN (no borra nada)" : "BORRADO REAL"}`);
  console.log("");

  // Las importaciones del asistente que nunca se confirmaron
  // (docs/importacion-de-datos.md §9.4): sus filas STAGED, a los 7 días.
  const corteSinConfirmar = corteDeSinConfirmar();
  console.log(
    `  Sin confirmar: ${String(DIAS_PARA_DESCARTAR_SIN_CONFIRMAR)} días (filas STAGED de un lote del asistente), created_at < ${corteSinConfirmar.toISOString()}`,
  );
  console.log("");

  if (dryRun) {
    const alcanzados = await countIngestionEventsPurgables(corte);
    const sinConfirmar = await contarSinConfirmarVencidos(corteSinConfirmar);
    console.log(`${String(alcanzados)} evento(s) serían borrados.`);
    console.log(
      `${String(sinConfirmar.filas)} fila(s) sin confirmar de ${String(sinConfirmar.lotes)} importación(es) serían borradas. No se borró nada.`,
    );
    return;
  }

  const { count } = await purgeIngestionEvents(corte);

  // NUNCA en silencio: el estándar pide que el borrado sea verificable, y una
  // purga que no dice cuánto borró no deja rastro de haberse cumplido. Un 0
  // también es información — significa que no había nada vencido, no que el
  // script no corrió.
  console.log(`${String(count)} evento(s) borrados.`);
  const sinConfirmar = await descartarSinConfirmarVencidos(corteSinConfirmar);
  console.log(
    `${String(sinConfirmar.filas)} fila(s) sin confirmar borradas; ${String(sinConfirmar.lotes)} importación(es) descartadas.`,
  );
}

main()
  .catch((err: unknown) => {
    // Falla ruidoso y con código distinto de cero, por el mismo criterio que
    // scripts/audit-gate.ts: una purga que se cortó a mitad de camino no puede
    // leerse como una purga hecha.
    console.error(
      `\npurge-ingestion-events: la purga falló — ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
