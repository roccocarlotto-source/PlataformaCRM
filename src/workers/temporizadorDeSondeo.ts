import { alDespertar, type Cola } from "../lib/despertador";

// ---------------------------------------------------------------------------
// CUÁNDO VUELVE A MIRAR LA COLA UN WORKER (ancho de banda, decisión de Rocco
// del 2026-10-30).
//
// Antes cada worker miraba a ritmo fijo: el del agente cada 1 s, los de
// ingesta, outbox, lotes y fotos cada 5 s, haya o no trabajo. Cada mirada es
// una ida y vuelta a Supabase, y en reposo eso era casi todo el tráfico
// "Service-Initiated" que Render cobra (~172 MB por día sin clientes).
//
// Ahora:
//   - si la pasada encontró trabajo, la próxima va a su ritmo normal (minimoMs);
//   - si no encontró nada, espera el doble que la vez anterior, hasta maximoMs;
//   - cuando el código que encola llama despertar(cola) (lib/despertador.ts),
//     mira en el acto y queda a ritmo normal durante VENTANA_DESPIERTA_MS. La
//     ventana cubre el aviso que llega antes del COMMIT de la transacción que
//     encola.
//
// Lo que NO avisa nadie (un reintento programado para dentro de un rato, un
// lease vencido, algo encolado por otro proceso) se ve como mucho maximoMs
// más tarde.
// ---------------------------------------------------------------------------

export const VENTANA_DESPIERTA_MS = 30_000;

export interface ConfiguracionDelTemporizador {
  cola: Cola;
  minimoMs: number;
  maximoMs: number;
  // La pasada del worker. El worker llama programar() cuando termina.
  pasada: () => void;
  // Para los tests.
  ahora?: () => number;
}

export interface TemporizadorDeSondeo {
  // La primera pasada, a los `ms`.
  arrancar(ms: number): void;
  // Al terminar una pasada: agenda la siguiente según lo que encontró.
  programar(huboTrabajo: boolean): void;
  // Cancela la próxima pasada y deja de escuchar el despertador.
  detener(): void;
}

export function crearTemporizadorDeSondeo(
  config: ConfiguracionDelTemporizador,
): TemporizadorDeSondeo {
  const ahora = config.ahora ?? Date.now;
  const minimo = config.minimoMs;
  const maximo = Math.max(config.maximoMs, minimo);

  let espera = minimo;
  let atentoHasta = 0;
  let timer: NodeJS.Timeout | undefined;
  // Entre que sale el timer y que la pasada llama programar().
  let enPasada = false;
  // Un despertar que llegó con la pasada en curso: la siguiente va sin esperar.
  let otraVuelta = false;
  let detenido = false;

  const agendar = (ms: number) => {
    timer = setTimeout(() => {
      timer = undefined;
      enPasada = true;
      config.pasada();
    }, ms);
  };

  const dejarDeEscuchar = alDespertar(config.cola, () => {
    if (detenido) return;
    atentoHasta = ahora() + VENTANA_DESPIERTA_MS;
    espera = minimo;
    if (enPasada) {
      otraVuelta = true;
      return;
    }
    if (timer) clearTimeout(timer);
    agendar(0);
  });

  return {
    arrancar(ms) {
      if (!detenido) agendar(ms);
    },
    programar(huboTrabajo) {
      enPasada = false;
      if (detenido) return;
      if (otraVuelta) {
        otraVuelta = false;
        agendar(0);
        return;
      }
      espera = huboTrabajo || ahora() < atentoHasta ? minimo : Math.min(espera * 2, maximo);
      agendar(espera);
    },
    detener() {
      detenido = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      dejarDeEscuchar();
    },
  };
}
