import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  DIAS_DE_RETENCION_IDENTIDAD_SIN_CONFIRMAR,
  fechaDeCorteDeIdentidades,
  purgeUnconfirmedAuthUsers,
} from "../src/services/authCleanup.service";

// ---------------------------------------------------------------------------
// Purga de identidades de auth.users que nunca se confirmaron — contrapartida
// de ALTO-2 (verificación de email en el registro).
//
// EL RESIDUO QUE LIMPIA: `POST /api/onboarding/otp` crea la fila en auth.users
// antes de que nadie haya probado nada, porque es la única forma de emitir un
// código con la librería que el proyecto tiene fijada. Quien pide un código y
// abandona deja esa fila sin confirmar para siempre.
//
// ESTE ARCHIVO NO DECIDE NADA, mismo criterio que purge-ingestion-events.ts: el
// qué se borra vive en src/services/authCleanup.service.ts, con el predicado en
// una función pura y testeable sin red. Acá solo está el envoltorio de línea de
// comandos.
//
// POR QUÉ MANUAL Y NO UN CRON: el proyecto no tiene scheduler ni pipeline de CD.
// Declarar un cron que nada ejecuta sería peor que no tenerlo, porque daría la
// limpieza por resuelta. Mismo razonamiento, y misma consecuencia, que el otro
// script de purga.
// ---------------------------------------------------------------------------

async function main() {
  // --dry-run cuenta y no borra. Existe por el mismo motivo que en la otra
  // purga, y acá pesa más: esto borra IDENTIDADES, no filas de auditoría.
  const dryRun = process.argv.includes("--dry-run");
  const corte = fechaDeCorteDeIdentidades();

  console.log("Purga de identidades de auth.users sin confirmar");
  console.log(`  Política: ${String(DIAS_DE_RETENCION_IDENTIDAD_SIN_CONFIRMAR)} días`);
  console.log(`  Corte:    created_at < ${corte.toISOString()}`);
  console.log(`  Criterio: email_confirmed_at = null Y invited_at = null Y sin fila en users`);
  console.log(`  Modo:     ${dryRun ? "DRY-RUN (no borra nada)" : "BORRADO REAL"}`);
  console.log("");

  const resultado = await purgeUnconfirmedAuthUsers({ dryRun, corte });

  console.log(`  Identidades revisadas:              ${String(resultado.revisadas)}`);
  console.log(`  Candidatas por fecha y estado:      ${String(resultado.candidatas)}`);
  console.log(`  Excluidas por tener perfil en CRM:  ${String(resultado.conPerfilDeNegocio)}`);
  console.log("");

  if (dryRun) {
    const alcanzadas = resultado.candidatas - resultado.conPerfilDeNegocio;
    console.log(`${String(alcanzadas)} identidad(es) serían borradas. No se borró nada.`);
    return;
  }

  // Un 0 también es información: significa que no había nada que purgar, no
  // que el script no corrió.
  console.log(`${String(resultado.borradas)} identidad(es) borradas.`);

  if (resultado.fallidas > 0) {
    // Ruidoso y con código distinto de cero: una purga parcial no puede leerse
    // como una purga hecha.
    throw new Error(
      `${String(resultado.fallidas)} identidad(es) no se pudieron borrar — ver el log para el detalle`,
    );
  }
}

main()
  .catch((err: unknown) => {
    console.error(
      `\npurge-unconfirmed-auth-users: la purga falló — ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
