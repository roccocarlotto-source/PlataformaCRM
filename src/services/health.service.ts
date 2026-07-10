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
  let database: "ok" | "error" = "error";

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
