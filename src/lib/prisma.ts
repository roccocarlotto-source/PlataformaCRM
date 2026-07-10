import { PrismaClient, type Prisma } from "@prisma/client";
import { env } from "../config/env";

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
