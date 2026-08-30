// ---------------------------------------------------------------------------
// La orquestación del apagado — M-12 de docs/auditoria-2026-08-29.md.
//
// SIN NINGÚN EFECTO DE LADO AL IMPORTAR. Todo lo que hace falta para apagar
// —cerrar el servidor HTTP, detener los workers, desconectar Prisma, salir del
// proceso— llega inyectado desde server.ts, que es el único lugar con efectos
// reales. La razón es que esto se tiene que poder probar: mandarle señales de
// verdad a un proceso hijo no se comporta igual en Windows (donde SIGTERM no es
// una señal POSIX y Node la simula) que en Linux (donde corre el CI). Con las
// dependencias inyectadas se prueba la orquestación con dobles y con el reloj
// controlado, sin process.exit ni señales.
//
// LO QUE GARANTIZA:
//
//   - ESPERA A LOS WORKERS Y AL SERVIDOR, EN PARALELO, antes de desconectar
//     Prisma. Los detener*() de los workers esperan a que la pasada en curso
//     termine COMPLETA (M-12 c): sin eso, $disconnect() podía llegar entre el
//     efecto externo de un handler y el UPDATE que marca el evento PROCESSED —
//     la transacción se revertía y el evento se volvía a entregar al reiniciar.
//
//   - NO SE QUEDA COLGADO. server.close() espera a TODAS las conexiones,
//     incluidas las keep-alive inactivas que un cliente puede sostener para
//     siempre (M-12 a): un solo cliente dejaba el proceso vivo hasta el SIGKILL
//     del orquestador, sin $disconnect() prolijo. server.ts cierra las inactivas
//     con closeIdleConnections(), y acá hay además un tope: pasado timeoutMs se
//     sale con código 1, con un log que dice qué pasó. El timer lleva unref()
//     para que, si el apagado normal termina antes, no sea lo único que
//     mantenga vivo el proceso.
//
//   - ES IDEMPOTENTE. Dos señales seguidas, o una señal durante un
//     unhandledRejection que ya está cerrando (o al revés), no reinician el
//     apagado ni disparan un segundo $disconnect().
// ---------------------------------------------------------------------------

export interface LoggerDeShutdown {
  info: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
}

export interface DependenciasDeShutdown {
  // Cierra el servidor HTTP y resuelve cuando ya no acepta ni atiende nada.
  cerrarServidor: () => Promise<void>;
  // Detiene los workers y resuelve cuando ninguna pasada sigue en curso.
  detenerWorkers: () => Promise<void>;
  desconectarPrisma: () => Promise<void>;
  // process.exit en producción; un doble en los tests.
  salir: (codigo: number) => void;
  logger: LoggerDeShutdown;
  // Tope total del apagado. Tiene que ser MENOR que el grace period del
  // orquestador (SIGTERM → SIGKILL) del entorno real; ver SHUTDOWN_TIMEOUT_MS
  // en config/env.ts.
  timeoutMs: number;
}

export type Shutdown = (motivo: string) => Promise<void>;

export function crearShutdown(deps: DependenciasDeShutdown): Shutdown {
  let cerrando = false;

  return async function shutdown(motivo: string): Promise<void> {
    if (cerrando) {
      return;
    }
    cerrando = true;

    deps.logger.info(`${motivo} recibido, cerrando servidor...`);

    const forzarSalida = setTimeout(() => {
      deps.logger.error(
        { timeoutMs: deps.timeoutMs, motivo },
        "El shutdown no terminó a tiempo: forzando la salida",
      );
      deps.salir(1);
    }, deps.timeoutMs);
    forzarSalida.unref();

    try {
      // Workers y servidor en paralelo: no dependen uno del otro, y esperarlos
      // en serie solo alargaría el apagado. Prisma recién después de los dos,
      // porque los dos pueden estar usándolo.
      await Promise.all([deps.detenerWorkers(), deps.cerrarServidor()]);
      await deps.desconectarPrisma();
      deps.logger.info("Servidor cerrado correctamente");
      clearTimeout(forzarSalida);
      deps.salir(0);
    } catch (err) {
      deps.logger.error({ err }, "Error durante el shutdown");
      clearTimeout(forzarSalida);
      deps.salir(1);
    }
  };
}
