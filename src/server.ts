import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { registrarAutomatizaciones } from "./services/automationRegistrations";
import { crearShutdown } from "./shutdown";
import { workersHabilitados } from "./utils/workersHabilitados";
import { iniciarWorkerDeTurnosDeAgente } from "./workers/agentInboundWorker";
import { iniciarWorkerDeIngesta } from "./workers/ingestionWorker";
import { iniciarWorkerDeCotizaciones } from "./workers/exchangeRateWorker";
import { iniciarWorkerDeCanales } from "./workers/googleCalendarChannelWorker";
import { iniciarWorkerDeOportunidadesEstancadas } from "./workers/opportunityStaleWorker";
import { iniciarWorkerDeOutbox } from "./workers/outboxWorker";
import { iniciarWorkerDeSeguimientosQr } from "./workers/qrFollowUpWorker";

const server = app.listen(env.PORT, () => {
  logger.info(`Servidor escuchando en el puerto ${env.PORT} (${env.NODE_ENV})`);
});

// En development contra una base que no es local, ningún worker ni registro de
// automatizaciones arranca salvo DEV_ALLOW_REMOTE_DB=true (G-02 de
// docs/auditoria-2026-09-24-punta-a-punta.md): un `npm run dev` con el .env de
// producción procesaba las colas reales desde una laptop. Los detener*() de
// los workers apagados son no-ops para que el shutdown de abajo no cambie.
const decisionDeWorkers = workersHabilitados({
  nodeEnv: env.NODE_ENV,
  databaseUrl: env.DATABASE_URL,
  permitirBaseRemota: env.DEV_ALLOW_REMOTE_DB,
});
const arrancarWorkers = decisionDeWorkers.arrancar;
const sinWorker = async (): Promise<void> => {};
if (!arrancarWorkers) {
  logger.warn(
    `Workers y automatizaciones NO arrancaron: ${decisionDeWorkers.motivo}. Para forzarlos, DEV_ALLOW_REMOTE_DB=true.`,
  );
}

// El worker de ingesta arranca ACÁ y no en app.ts, y la distinción no es
// estilística: app.ts arma la instancia de Express y lo importan los tests de
// integración, que levantan sus propias apps. Un worker que arrancara ahí
// encendería un timer en cada test que importe una ruta, drenando la cola por
// debajo de las afirmaciones del propio test. Vive con el proceso servidor, que
// es lo único que de verdad tiene que drenarla.
const detenerWorker = arrancarWorkers ? iniciarWorkerDeIngesta() : sinWorker;

// Los registros del motor de automatizaciones (docs/automations-architecture.md
// §4 y §5) —las acciones del catálogo y un handler de despacho por cada
// trigger conocido— se pueblan ACÁ, antes de levantar el worker del outbox,
// para que su log de arranque ya liste los eventTypes que este proceso sabe
// atender. Es el primer consumidor real del outbox; hasta este punto el
// registro de handlers estaba vacío por diseño (outboxHandlers.ts).
if (arrancarWorkers) registrarAutomatizaciones();

// El worker de eventos salientes, por el mismo motivo y con el mismo criterio:
// vive con el proceso servidor, no con la instancia de Express. Son dos timers
// independientes a propósito — la cola de entrada y la de salida no comparten
// cadencia, ni lote, ni razones para estar caídas.
const detenerWorkerDeOutbox = arrancarWorkers ? iniciarWorkerDeOutbox() : sinWorker;

// El worker de canales de Google Calendar (paso 4 del módulo de agenda), por el
// mismo motivo que los otros dos: vive con el proceso servidor, no con la
// instancia de Express. Su cadencia es de UNA HORA y no de cinco segundos —
// vigila canales que duran siete días, no una cola— así que es el único de los
// tres cuyo tick normal no hace nada.
const detenerWorkerDeCanales = arrancarWorkers ? iniciarWorkerDeCanales() : sinWorker;

// El worker de cotizaciones (Fase 2c del módulo de stock de vehículos), por el
// mismo motivo que los otros tres: vive con el proceso servidor, no con la
// instancia de Express — los tests de integración que importan rutas no deben
// encender un timer real ni salir a una API pública. Cadencia de 24 horas con
// primera pasada inmediata.
const detenerWorkerDeCotizaciones = arrancarWorkers ? iniciarWorkerDeCotizaciones() : sinWorker;

// El worker de oportunidades estancadas (ítem 76 de
// docs/frontend-cambios-pendientes.md), por el mismo motivo que los otros
// cuatro. Es el productor del trigger opportunity.stale: una vez por día emite
// un evento al outbox por cada oportunidad que la regla de su organización
// considera quieta, y el resto lo hace el camino de siempre (worker del outbox
// -> dispatcher -> acción). Arranca DESPUÉS de registrarAutomatizaciones() por
// prolijidad, no por necesidad: sus eventos quedan en la cola y los atiende el
// worker del outbox, que es el que necesita los handlers.
const detenerWorkerDeOportunidadesEstancadas = arrancarWorkers
  ? iniciarWorkerDeOportunidadesEstancadas()
  : sinWorker;

// El worker de turnos de WhatsApp (ítem 125 de
// docs/auditoria-2026-09-24-punta-a-punta.md), por el mismo motivo que los
// otros cinco y detrás de la misma guarda de workersHabilitados(): un
// `npm run dev` contra la base real no puede ponerse a contestarles a los
// clientes de producción desde una laptop. Es el que más necesita esa guarda
// de los seis — cada job que reclama es un mensaje a una persona real.
const detenerWorkerDeTurnosDeAgente = arrancarWorkers ? iniciarWorkerDeTurnosDeAgente() : sinWorker;

// El worker de seguimientos por WhatsApp con el QR (ítem 159 de
// docs/frontend-cambios-pendientes.md), detrás de la misma guarda y por el
// mismo motivo que el de turnos: cada fila que reclama es un WhatsApp a un
// cliente real. Manda lo que la acción opportunity.send_qr_followup agendó
// cuando se ganó una oportunidad.
const detenerWorkerDeSeguimientosQr = arrancarWorkers ? iniciarWorkerDeSeguimientosQr() : sinWorker;

// El apagado ordenado (M-12 de docs/auditoria-2026-08-29.md). La orquestación
// vive en shutdown.ts, sin efectos de lado y con todo inyectado, para poder
// probarla sin señales reales; acá solo se cablean los efectos de verdad.
const shutdown = crearShutdown({
  cerrarServidor: () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
      // server.close() espera a TODAS las conexiones, incluidas las keep-alive
      // inactivas que un cliente puede sostener para siempre. Esto cierra ahora
      // mismo las que no tienen un request en vuelo; las que sí lo tienen se
      // dejan terminar solas, que es lo correcto.
      server.closeIdleConnections();
    }),
  // Los siete stops esperan a la pasada en curso de su worker (M-12 c): cada
  // evento va en su propia transacción y ninguna queda a medias, y los que no
  // llegó a tocar siguen en PENDING para el próximo arranque. El de turnos de
  // WhatsApp espera solo el job en curso; si un turno largo supera el tope del
  // apagado, su job queda en PROCESSING y se retoma cuando venza el lease.
  detenerWorkers: async () => {
    await Promise.all([
      detenerWorker(),
      detenerWorkerDeOutbox(),
      detenerWorkerDeCanales(),
      detenerWorkerDeCotizaciones(),
      detenerWorkerDeOportunidadesEstancadas(),
      detenerWorkerDeTurnosDeAgente(),
      detenerWorkerDeSeguimientosQr(),
    ]);
  },
  desconectarPrisma: () => prisma.$disconnect(),
  salir: (codigo) => process.exit(codigo),
  logger,
  timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
});

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// Node ≥ 15 termina el proceso ante un unhandledRejection SIN pasar por ningún
// handler de señal: sin esto no había $disconnect(), ni log estructurado de qué
// pasó, ni chance de que un worker terminara su pasada (M-12 b).
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandledRejection no manejado: iniciando shutdown");
  void shutdown("unhandledRejection");
});
