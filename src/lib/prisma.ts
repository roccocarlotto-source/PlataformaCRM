import { PrismaClient, type Prisma } from "@prisma/client";
import { env } from "../config/env";
import { assertBaseLocalEnTest } from "../utils/baseLocal";

// El freno DEFINITIVO de la suite de integración contra una base real
// (incidente del 27/09/2026, ver utils/baseLocal.ts). Va acá y no solo en
// config/env.ts porque este es el único punto donde DATABASE_URL ya es la que
// va a usar el cliente: @prisma/client, importado arriba, ya cargó su `.env`
// si iba a cargarlo. Sin importar en qué orden se importó todo, con
// NODE_ENV=test no se construye un cliente contra una base remota.
assertBaseLocalEnTest(process.env);

// Singleton con guard en globalThis: evita que "tsx watch" cree una instancia
// nueva de PrismaClient (y agote el pool de conexiones) en cada hot-reload
// durante desarrollo.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isDevelopment ? ["error", "warn"] : ["error"],
  });

if (!env.isProduction) {
  globalForPrisma.prisma = prisma;
}

// Tipo compartido para funciones de repositorio que deben poder participar
// de una transacción: reciben el cliente singleton por defecto, o el `tx`
// que entrega `prisma.$transaction(async (tx) => { ... })` cuando el service
// necesita que varias escrituras sean atómicas (ver onboarding.service.ts).
export type Db = PrismaClient | Prisma.TransactionClient;

// Para las transacciones interactivas LARGAS: 8 o más consultas en serie en el
// peor caso, un loop que crece con los datos o una llamada HTTP adentro. El
// default de Prisma es 5 s, y en producción cada consulta cuesta varias idas y
// vueltas hasta la base (Supabase en São Paulo, pooler con pgbouncer): el
// borrado de datos personales, ~22 consultas, midió ~52 idas y vueltas y
// vencía con P2028 ("conflicto temporal"). maxWait: cuánto se espera una
// conexión libre del pool antes de abrirla (default 2 s). Mismos valores que
// la unión de contactos. Una transacción corta no los necesita.
export const OPCIONES_DE_TRANSACCION_LARGA = { maxWait: 10_000, timeout: 20_000 } as const;
