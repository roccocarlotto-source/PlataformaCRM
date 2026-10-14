import { PrismaClient } from "@prisma/client";
import { assertBaseLocalEnTest } from "../utils/baseLocal";

// ---------------------------------------------------------------------------
// Cuenta las consultas SQL que llegan a la base. Se importa ANTES que cualquier
// módulo que importe lib/prisma: deja en globalThis un cliente que emite un
// evento por consulta, y lib/prisma reutiliza ese singleton (fuera de
// producción). Cada consulta es una ida y vuelta a la base: en producción
// (Render → Supabase en São Paulo, pooler) cuesta ~100-250 ms, así que la
// cantidad manda en la latencia de un request.
// ---------------------------------------------------------------------------

assertBaseLocalEnTest(process.env);

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
if (globalForPrisma.prisma) {
  throw new Error("contarConsultas.test-helper tiene que importarse antes que lib/prisma");
}

const cliente = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
globalForPrisma.prisma = cliente;

let contando = false;
let consultas: string[] = [];
cliente.$on("query", (e) => {
  if (contando) consultas.push(e.query);
});

/** Corre `fn` y devuelve su resultado y las consultas SQL que hizo (BEGIN y
 *  COMMIT incluidos: también son idas y vueltas). */
export async function contarConsultas<T>(
  fn: () => Promise<T>,
): Promise<{ resultado: T; consultas: string[] }> {
  consultas = [];
  contando = true;
  try {
    const resultado = await fn();
    return { resultado, consultas };
  } finally {
    contando = false;
  }
}
