import { logger } from "../lib/logger";
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
  } catch (err) {
    // EL ERROR QUEDA EN EL LOG — B-19 de docs/auditoria-2026-08-29.md (B-13 del
    // 21/08). El 503 ya salía bien, pero el catch descartaba el error: un
    // operador que veía el health check en rojo no tenía forma de saber QUÉ
    // rechazó la base (Postgres caído, credenciales rotadas, timeout de red) ni
    // desde cuándo. Logger raíz y no req.log: esto es un chequeo de
    // infraestructura, no una operación de un usuario, y el service no corre
    // dentro de ningún request — mismo criterio que los workers. `err` como
    // primer campo del payload es la convención de errorHandler y los workers.
    // Lo que NO cambia acá: rate limit y el costo del SELECT 1 por llamada son
    // M-17, otro hallazgo.
    logger.error(
      { err },
      "El chequeo de salud contra la base falló: /health responde 503 hasta que la base vuelva",
    );
    database = "error";
  }

  return {
    status: database === "ok" ? "ok" : "error",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    checks: { database },
  };
}
