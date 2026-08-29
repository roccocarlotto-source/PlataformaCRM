import { env } from "../config/env";
import { logger } from "../lib/logger";
import { findConnectionsNeedingChannel } from "../repositories/googleCalendarConnection.repository";
import type { ClienteGoogleCalendar } from "../services/googleCalendar.service";
import { renovarCanal } from "../services/googleCalendarConnection.service";

// ---------------------------------------------------------------------------
// Worker de renovación de canales de notificaciones push (paso 4 de
// docs/booking-architecture.md §9, que lo pide explícitamente: "los canales de
// notificación push de Google expiran (máximo ~7 días) y hay que renovarlos
// antes de que caduquen — esto necesita un worker periódico, similar en espíritu
// al ingestionWorker.ts").
//
// El "~7 días" del documento se verificó y esta vez era correcto: el TTL por
// defecto de events.watch es 604800 segundos, o sea 7 días exactos.
//
// MISMO PATRÓN que ingestionWorker.ts y outboxWorker.ts —setTimeout encadenado,
// arranca en server.ts, se detiene en el shutdown— y por los mismos motivos, que
// no se repiten acá. Lo que SÍ cambia respecto de aquellos, y es lo único que
// vale la pena leer:
//
//   LA CADENCIA ES DE UNA HORA, no de cinco segundos. Aquellos drenan colas
//   donde un evento puede llegar en cualquier momento y alguien espera el
//   resultado; éste vigila canales que duran SIETE DÍAS. Con un margen de
//   renovación de 24 horas, una pasada por hora da 24 oportunidades de renovar
//   antes de que un canal venza — de sobra para absorber un deploy, un reinicio
//   o un rato de Google caído.
//
//   NO HAY RECLAMO NI LOCK POR FILA, a diferencia de ingestionWorker (que usa
//   FOR UPDATE SKIP LOCKED). Con varias instancias, dos procesos podrían renovar
//   el mismo canal en la misma pasada, y el peor caso es un canal de más abierto
//   en Google que nadie cierra hasta que vence: se pierde una cuota mínima y
//   llegan notificaciones duplicadas, que son INOFENSIVAS (procesar dos veces no
//   hace nada — el segundo pase no encuentra cambios, o encuentra un Booking ya
//   cancelado). No vale la pena el mecanismo de reclamo para eso; queda anotado
//   por si la topología cambia y el desperdicio empieza a importar.
//
// ---------------------------------------------------------------------------
// "SIN CANAL" Y "CANAL POR VENCER" SON EL MISMO CASO
// ---------------------------------------------------------------------------
//
// Y eso es lo que permite que el flujo OAuth del paso 2 no cree canales: una
// conexión recién creada simplemente no tiene uno, y este worker la levanta en
// su siguiente pasada. Cablear la creación dentro de completarConexion() habría
// significado tocar un camino ya revisado y mergeado para agregarle una llamada
// externa más que puede fallar — y la demora de hasta una hora no cuesta nada:
// un canal que todavía no existe solo significa que los cambios hechos en Google
// en esa ventana no se detectan, que es exactamente lo que pasaba antes de este
// paso.
// ---------------------------------------------------------------------------

export interface ResumenDeRenovacion {
  renovados: number;
  fallidos: number;
}

// Las dos opciones son SOLO PARA TESTS (A-8 de docs/auditoria-2026-08-29.md);
// el tick de producción (abajo) no pasa ninguna y el comportamiento sin ellas
// es el de siempre.
//
//   - `cliente`: el doble de Google, mismo patrón ClienteInyectado que ya usan
//     obtenerAccessToken y renovarCanal. Sin él, un test que llame a esta
//     función en CI —donde no hay ninguna GOOGLE_*— no ejercita nada: cada
//     conexión revienta en getClienteGoogleCalendar() con un 500 de
//     configuración ANTES de llegar a ninguna lógica, el bucle lo cuenta como
//     `fallidos` y sigue, y el test queda verde sin haber probado ni el filtro
//     de la consulta ni el ciclo de vida del canal.
//   - `organizationId`: acota el barrido a una organización. En producción
//     este worker recorre TODAS las conexiones ACTIVE de la base, que es su
//     trabajo; en la suite —que corre archivos en paralelo contra una base
//     compartida— un barrido sin alcance toca las conexiones de OTROS tests,
//     y con credenciales reales en .env las marcaría ERROR contra Google.
export interface OpcionesDeRenovacion {
  cliente?: ClienteGoogleCalendar;
  organizationId?: string;
}

export async function renovarCanalesVencidos(
  opciones: OpcionesDeRenovacion = {},
): Promise<ResumenDeRenovacion> {
  const resumen: ResumenDeRenovacion = { renovados: 0, fallidos: 0 };

  const limite = new Date(Date.now() + env.GOOGLE_CHANNEL_RENEW_MARGIN_MS);

  const conexiones = await findConnectionsNeedingChannel(limite, {
    organizationId: opciones.organizationId,
  });

  for (const conexion of conexiones) {
    try {
      const resultado = await renovarCanal(conexion, opciones.cliente);

      resumen.renovados++;

      logger.info(
        {
          organizationId: conexion.organizationId,
          branchId: conexion.branchId,
          channelId: resultado.channelId,
          expiration: resultado.expiration,
          reemplazaba: conexion.channelId ?? null,
        },
        "Canal de notificaciones de Google Calendar creado o renovado",
      );
    } catch (err) {
      // UNA CONEXIÓN QUE FALLA NO PUEDE CORTAR LA PASADA. Es el mismo requisito
      // que §5 de la ingesta impone para una fila mala, y acá es más importante
      // todavía: la causa más probable de un fallo es una sucursal puntual con
      // el grant roto, y dejar que eso impida renovar los canales de TODAS las
      // demás convertiría un problema de un cliente en una caída del módulo.
      resumen.fallidos++;

      logger.error(
        { err, organizationId: conexion.organizationId, branchId: conexion.branchId },
        "No se pudo crear o renovar el canal de notificaciones de esta sucursal; se sigue con las demás",
      );
    }
  }

  return resumen;
}

export function iniciarWorkerDeCanales(): () => void {
  if (!env.GOOGLE_CHANNEL_WORKER_ENABLED) {
    logger.info(
      "Worker de canales de Google Calendar deshabilitado por GOOGLE_CHANNEL_WORKER_ENABLED: no se renuevan canales y la sincronización inversa deja de funcionar cuando venzan",
    );
    return () => undefined;
  }

  // SIN GOOGLE_WEBHOOK_URL NO SE PUEDE ABRIR NINGÚN CANAL, así que el worker no
  // arranca y lo dice UNA vez, al inicio. La alternativa —arrancar igual y
  // fallar en cada pasada— llenaría el log de un error por sucursal por hora
  // para una condición que es de configuración y no cambia sola.
  if (!env.GOOGLE_WEBHOOK_URL) {
    logger.warn(
      "GOOGLE_WEBHOOK_URL no está configurada: el worker de canales no arranca y la sincronización inversa está inactiva. Requiere además un dominio verificado en Search Console.",
    );
    return () => undefined;
  }

  let detenido = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (detenido) {
      return;
    }

    try {
      const resumen = await renovarCanalesVencidos();

      if (resumen.renovados + resumen.fallidos > 0) {
        logger.info(resumen, "Pasada de renovación de canales de Google Calendar");
      }
    } catch (err) {
      // Red de seguridad del bucle: renovarCanalesVencidos ya atrapa por
      // conexión, así que llegar acá significa que falló la consulta misma. El
      // bucle NO puede morir por eso — si muere, los canales dejan de renovarse
      // en silencio y la sincronización inversa se apaga sola en siete días.
      logger.error({ err }, "Fallo inesperado en la pasada de renovación de canales");
    }

    if (!detenido) {
      timer = setTimeout(() => void tick(), env.GOOGLE_CHANNEL_WORKER_POLL_MS);
    }
  };

  logger.info(
    {
      pollMs: env.GOOGLE_CHANNEL_WORKER_POLL_MS,
      margenMs: env.GOOGLE_CHANNEL_RENEW_MARGIN_MS,
      ttlSegundos: env.GOOGLE_CHANNEL_TTL_SECONDS,
      webhookUrl: env.GOOGLE_WEBHOOK_URL,
    },
    "Worker de canales de Google Calendar iniciado",
  );

  // PRIMERA PASADA INMEDIATA, a diferencia de los otros dos workers, que esperan
  // su primer intervalo. Acá el intervalo es de una hora: arrancar el servidor y
  // que una sucursal recién conectada espere hasta 60 minutos por su canal es
  // una demora innecesaria, y una pasada extra al arrancar no cuesta nada
  // (normalmente no encuentra nada que renovar).
  timer = setTimeout(() => void tick(), 0);

  return () => {
    detenido = true;
    if (timer) {
      clearTimeout(timer);
    }
  };
}
