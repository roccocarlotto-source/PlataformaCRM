import { env } from "../config/env";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// El saldo de la key del proveedor de LLM (FABLE-G-10 de
// docs-privados/auditoria-2026-10-05-FABLE.md, local).
//
// La key de OpenRouter puede tener un límite propio. Cuando se agota,
// OpenRouter rechaza cada llamada, todos los turnos de todos los negocios
// terminan en derivación, y hasta ahora nadie se enteraba antes que un
// cliente. Esto consulta `GET {baseUrl}/key` (gratis, no gasta saldo), y
// cuando a la key le queda menos que OPENROUTER_KEY_ALERT_THRESHOLD_USD:
//   - loguea un error en cada lectura (una cada TTL_MS como mucho);
//   - /health lo muestra en checks.llmKey ("saldo-bajo").
//
// /health dice el ESTADO, no el monto: es un endpoint sin sesión.
//
// NADIE ESPERA A OPENROUTER. La lectura se guarda TTL_MS y se refresca en
// segundo plano: /health y el final de cada turno piden el estado, reciben lo
// último que se supo al instante y, si está vencido, disparan una lectura que
// no bloquea a nadie. Si OpenRouter no responde, el estado es "desconocido" y
// se reintenta en el próximo pedido pasado un REINTENTO_MS.
// ---------------------------------------------------------------------------

export type EstadoDeLaKey =
  // Tiene límite y le queda más que el umbral.
  | "ok"
  | "saldo-bajo"
  // La key no tiene límite propio: no hay saldo que vigilar acá.
  | "sin-limite"
  // Todavía no se leyó, o la última lectura falló.
  | "desconocido"
  // Sin OPENROUTER_API_KEY, o con la alerta apagada (umbral 0).
  | "no-configurada";

const TTL_MS = 10 * 60_000;
const REINTENTO_MS = 60_000;
const TIMEOUT_MS = 5_000;

// Pura: el estado según lo que devolvió `GET /key`. `limit_remaining` null o
// ausente es una key sin límite.
export function estadoSegunElSaldo(limitRemaining: unknown, umbralUsd: number): EstadoDeLaKey {
  if (limitRemaining === null || limitRemaining === undefined) {
    return "sin-limite";
  }
  if (typeof limitRemaining !== "number" || !Number.isFinite(limitRemaining)) {
    return "desconocido";
  }
  return limitRemaining < umbralUsd ? "saldo-bajo" : "ok";
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ConfiguracionDelMonitor {
  apiKey: string | undefined;
  baseUrl: string;
  umbralUsd: number;
  fetch?: FetchLike;
  ahora?: () => number;
}

export interface MonitorDeLaKey {
  // Lo último que se supo, al instante. Dispara un refresco si está vencido.
  estado(): EstadoDeLaKey;
  // La lectura en curso, si hay una. Solo para tests.
  enCurso(): Promise<void> | null;
}

export function crearMonitorDeLaKey(config: ConfiguracionDelMonitor): MonitorDeLaKey {
  const hacerFetch = config.fetch ?? ((url, init) => fetch(url, init));
  const ahora = config.ahora ?? (() => Date.now());
  const url = `${config.baseUrl.replace(/\/+$/, "")}/key`;

  let ultimo: EstadoDeLaKey = "desconocido";
  let proximaLectura = 0;
  let lectura: Promise<void> | null = null;

  async function leer(): Promise<void> {
    try {
      const res = await hacerFetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${config.apiKey ?? ""}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${String(res.status)}`);
      }
      const cuerpo = (await res.json()) as { data?: { limit_remaining?: unknown } };
      const limitRemaining = cuerpo.data?.limit_remaining;
      ultimo = estadoSegunElSaldo(limitRemaining, config.umbralUsd);
      proximaLectura = ahora() + TTL_MS;
      if (ultimo === "saldo-bajo") {
        logger.error(
          { limitRemaining, umbralUsd: config.umbralUsd },
          "A la key del proveedor de LLM le queda poco saldo: cuando se agote, el agente deja de responder en todos los negocios",
        );
      }
    } catch (err) {
      ultimo = "desconocido";
      proximaLectura = ahora() + REINTENTO_MS;
      logger.warn({ err }, "No se pudo consultar el saldo de la key del proveedor de LLM");
    }
  }

  return {
    estado() {
      if (!config.apiKey || config.umbralUsd <= 0) {
        return "no-configurada";
      }
      if (lectura === null && ahora() >= proximaLectura) {
        lectura = leer().finally(() => {
          lectura = null;
        });
      }
      return ultimo;
    },
    enCurso: () => lectura,
  };
}

// Uno por proceso, perezoso: en test no hay key y nunca sale un request.
let monitor: MonitorDeLaKey | undefined;

function getMonitor(): MonitorDeLaKey {
  monitor ??= crearMonitorDeLaKey({
    apiKey: env.OPENROUTER_API_KEY,
    baseUrl: env.OPENROUTER_BASE_URL,
    umbralUsd: env.OPENROUTER_KEY_ALERT_THRESHOLD_USD,
  });
  return monitor;
}

export function estadoDeLaKeyDelLlm(): EstadoDeLaKey {
  return getMonitor().estado();
}

// Al final de cada turno: mantiene la lectura fresca aunque nadie pegue a
// /health. No espera ni devuelve nada.
export function revisarSaldoDeLaKey(): void {
  getMonitor().estado();
}
