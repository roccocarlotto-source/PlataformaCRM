import { logger } from "../lib/logger";
import { findReglasParaReintentar, reclamarReintento } from "../repositories/automation.repository";
import { reintentoAutomaticoDeLaPlantilla } from "../services/automationWhatsapp.service";
import { anotarSiLaBaseNoResponde, laBaseEstaCaida } from "./esperaDeLaBase";

// ---------------------------------------------------------------------------
// H-1: reintenta mandar a Meta la plantilla de WhatsApp de las reglas cuyo
// alta falló por algo temporal (services/whatsappTemplateReintento.ts). Cada 5
// minutos toma las reglas con el próximo intento vencido, de todas las
// organizaciones, y las sincroniza de nuevo; cada intento deja en la regla el
// próximo (espera creciente) o el aviso final.
//
// El reclamo corre el próximo intento 10 minutos antes de llamar a Meta: si
// el proceso se cae a mitad, la regla se retoma sola en la pasada siguiente, y
// dos instancias no reintentan la misma regla a la vez. Las fechas las escribe
// y las lee Node (no hay now() de Postgres en juego).
// ---------------------------------------------------------------------------

const POLL_MS = 5 * 60 * 1000;
const POR_PASADA = 20;
const RECLAMO_MS = 10 * 60 * 1000;

export interface ResumenDeReintentos {
  reintentadas: number;
  conExito: number;
  fallidas: number;
}

export async function reintentarPlantillasVencidas(
  opciones: {
    ahora?: Date;
    reintentar?: typeof reintentoAutomaticoDeLaPlantilla;
  } = {},
): Promise<ResumenDeReintentos> {
  const ahora = opciones.ahora ?? new Date();
  const reintentar = opciones.reintentar ?? reintentoAutomaticoDeLaPlantilla;
  const resumen: ResumenDeReintentos = { reintentadas: 0, conExito: 0, fallidas: 0 };
  for (const regla of await findReglasParaReintentar(ahora, POR_PASADA)) {
    if (!regla.templateSyncNextAt) continue;
    const hasta = new Date(ahora.getTime() + RECLAMO_MS);
    if (!(await reclamarReintento(regla.id, regla.templateSyncNextAt, hasta))) continue;
    resumen.reintentadas++;
    try {
      const estado = await reintentar(regla);
      if (estado === null) resumen.conExito++;
    } catch (err) {
      // Un error que no es de Meta (la base, un bug): la regla queda con el
      // reclamo y se retoma en 10 minutos; la pasada sigue con las demás.
      resumen.fallidas++;
      logger.error(
        { err, organizationId: regla.organizationId, automationId: regla.id },
        "No se pudo reintentar la plantilla de WhatsApp de la regla",
      );
    }
  }
  return resumen;
}

export function iniciarWorkerDeReintentoDePlantillas(
  opciones: { pollMs?: number; pasada?: () => Promise<ResumenDeReintentos> } = {},
): () => Promise<void> {
  const pollMs = opciones.pollMs ?? POLL_MS;
  const pasada = opciones.pasada ?? (() => reintentarPlantillasVencidas());
  let detenido = false;
  let timer: NodeJS.Timeout | undefined;
  let tickEnCurso: Promise<void> | undefined;

  const tick = async () => {
    if (detenido) return;
    tickEnCurso = (async () => {
      try {
        if (laBaseEstaCaida()) return;
        const r = await pasada();
        if (r.reintentadas > 0) logger.info(r, "Reintento de plantillas de WhatsApp");
      } catch (err) {
        if (!anotarSiLaBaseNoResponde(err)) {
          logger.error({ err }, "Fallo inesperado en el reintento de plantillas de WhatsApp");
        }
      }
    })();
    await tickEnCurso;
    if (!detenido) timer = setTimeout(() => void tick(), pollMs);
  };

  logger.info({ pollMs }, "Worker de reintento de plantillas de WhatsApp iniciado");
  timer = setTimeout(() => void tick(), 0);
  return async () => {
    detenido = true;
    if (timer) clearTimeout(timer);
    await tickEnCurso;
  };
}
