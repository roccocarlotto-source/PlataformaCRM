import { prisma } from "../lib/prisma";

export interface HealthStatus {
  status: "ok" | "error";
  uptime: number;
  timestamp: string;
  checks: {
    database: "ok" | "error";
  };
}

export async function checkHealth(): Promise<HealthStatus> {
  // Sin inicializador: las dos ramas del try/catch asignan, así que el valor
  // inicial nunca llegaba a leerse. No cambiaba el comportamiento, pero sugería
  // un default que no existe — el estado de la base lo decide exactamente una
  // de las dos ramas, nunca la declaración.
  let database: "ok" | "error";

  try {
    await prisma.$queryRaw`SELECT 1`;
    database = "ok";
  } catch {
    database = "error";
  }

  return {
    status: database === "ok" ? "ok" : "error",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    checks: { database },
  };
}
