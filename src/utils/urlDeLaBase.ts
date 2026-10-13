// ---------------------------------------------------------------------------
// LA URL DE LA BASE CONTRA EL POOLER DE SUPABASE (docs/deployment.md §2.3).
//
// El pooler en el puerto 6543 trabaja en modo transacción: cada consulta puede
// ir por una conexión distinta a Postgres. Sin `pgbouncer=true`, Prisma 5
// prepara cada consulta con nombre ("s0", "s1"…) en una conexión y la ejecuta
// en otra, y con varias consultas en paralelo falla con `prepared statement
// "sN" does not exist`. Pasó en producción el 2026-10-12: al reiniciar con la
// URL sin el parámetro, todos los workers fallaron.
//
// Se revisa al arrancar y se avisa en el log. NUNCA se imprime la URL: tiene
// la contraseña.
// ---------------------------------------------------------------------------

export const PUERTO_DEL_POOLER_EN_MODO_TRANSACCION = "6543";

/** Lo que está mal en DATABASE_URL para usarla contra el pooler, o null. */
export function problemaDeLaUrlDeLaBase(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return "DATABASE_URL no es una URL válida: Prisma la va a rechazar (P1013).";
  }
  // Un "?" de más (".../postgres??connection_limit=10") deja un parámetro
  // cuyo nombre empieza con "?": Prisma rechaza la URL (P1013).
  if ([...url.searchParams.keys()].some((nombre) => nombre.startsWith("?"))) {
    return 'DATABASE_URL tiene un "?" de más en los parámetros: Prisma la va a rechazar (P1013). Tiene que terminar en "?pgbouncer=true&connection_limit=10".';
  }
  if (url.port !== PUERTO_DEL_POOLER_EN_MODO_TRANSACCION) {
    return null;
  }
  if (url.searchParams.get("pgbouncer") !== "true") {
    return 'DATABASE_URL usa el pooler en modo transacción (puerto 6543) sin "pgbouncer=true": con consultas en paralelo Prisma falla con "prepared statement sN does not exist". Tiene que terminar en "?pgbouncer=true&connection_limit=10" (docs/deployment.md §2.3).';
  }
  return null;
}
