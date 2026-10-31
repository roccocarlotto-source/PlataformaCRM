import { env } from "../config/env";
import { versionDesplegada } from "../config/operacion";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { estadoDeLaKeyDelLlm, type EstadoDeLaKey } from "./llmKeyBalance.service";

// /health es PÚBLICO, y esto es todo lo que dice (decisión de Rocco del
// 2026-10-30, SEG-C-04 y OPS-08 de docs-privados/auditoria-2026-10-21, local):
// estado, versión desplegada y los dos chequeos. Sin `uptime` (le decía a
// cualquiera cuándo se reinició el proceso) ni montos de saldo. Las palabras
// de `llmKey` no se cambian: los monitores de UptimeRobot buscan "saldo-bajo"
// y "sin-saldo" en esta respuesta.
export interface HealthStatus {
  status: "ok" | "error";
  // El commit desplegado, 7 caracteres ("local" sin RENDER_GIT_COMMIT ni
  // GIT_COMMIT). Es como se confirma desde afuera que un deploy entró.
  version: string;
  checks: {
    database: "ok" | "error";
    // FABLE-G-10 (docs-privados, local): el saldo de la key del proveedor de
    // LLM. Informativo: "saldo-bajo" NO pone /health en error ni cambia el
    // 200 —un 503 acá haría que la plataforma trate el servicio como caído
    // cuando lo único que pasa es que hay que recargar—. Lo mismo "sin-saldo"
    // (OpenRouter ya rechazó una llamada con 402). Un monitor externo puede
    // alertar buscando esas palabras en la respuesta.
    llmKey: EstadoDeLaKey;
  };
}

export async function checkHealth(
  estadoDeLaKey: () => EstadoDeLaKey = estadoDeLaKeyDelLlm,
): Promise<HealthStatus> {
  // Sin inicializador: las dos ramas del try/catch asignan, así que el valor
  // inicial nunca llegaba a leerse. No cambiaba el comportamiento, pero sugería
  // un default que no existe — el estado de la base lo decide exactamente una
  // de las dos ramas, nunca la declaración.
  let database: "ok" | "error";

  try {
    await prisma.$queryRaw`SELECT 1`;
    database = "ok";
  } catch (err) {
    // EL ERROR QUEDA EN EL LOG — B-19 de docs-privados/auditoria-2026-08-29.md (local, no está en GitHub) (B-13 del
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
    version: versionDesplegada(env),
    checks: { database, llmKey: estadoDeLaKey() },
  };
}
