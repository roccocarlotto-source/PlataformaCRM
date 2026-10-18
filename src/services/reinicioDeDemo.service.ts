import {
  prepararReinicioDelTallerDemo,
  type ResultadoDelReinicioDelTaller,
} from "../automotora/demo/reinicioDelTallerDemo.service";
import {
  prepararReinicioDeLaDemo,
  type ResultadoDelReinicio,
} from "../clinicas/demo/reinicioDeLaDemo.service";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { NO_ES_UNA_DEMO, YA_SE_ESTA_REINICIANDO } from "./modoDemo.service";

// ---------------------------------------------------------------------------
// Reiniciar los datos de una demo: POST
// /api/admin/organizations/:organizationId/demo/reiniciar (platform admin).
// Un solo endpoint y un solo botón para las dos demos, despachado por rubro:
//
//   - CLINICA → la Clínica Demo (src/clinicas/demo/reinicioDeLaDemo.service.ts,
//     docs/rubros.md §12.3), sin cambios: sigue exigiendo su slug, la regla del
//     recordatorio inactiva y Google desconectado;
//   - AUTOMOTORA → el Taller Demo
//     (src/automotora/demo/reinicioDelTallerDemo.service.ts, docs/taller-demo.md).
//
// Antes que nada exige el MODO DEMO (organizations.is_demo): una organización
// sin la bandera da 400 sin tocar nada, se llame como se llame.
//
// EN SEGUNDO PLANO (2026-10-18). El reinicio del Taller tarda unos tres
// minutos, y esperar la respuesta en el POST terminó una vez en "Failed to
// fetch" a los dos minutos con el reinicio igual terminado del lado del
// servidor: el platform admin no sabía si había salido. Ahora:
//
//   - el POST hace lo que puede rechazar el reinicio (404/400/409, sin
//     escribir nada) y responde 202 con el estado REINICIANDO; el borrado y la
//     recarga siguen solos;
//   - GET .../demo/reinicio devuelve el estado: REINICIANDO, LISTO (con lo
//     borrado y lo cargado) o FALLO (con el motivo); NINGUNO si no hubo;
//   - un segundo POST mientras corre da 409, en las dos demos.
//
// El estado vive EN MEMORIA, como el candado que ya tenía el Taller: el
// backend corre en una sola instancia. Si el proceso se reinicia en medio, el
// estado se pierde (GET → NINGUNO) y la pantalla lo dice; reiniciar de nuevo
// deja la demo bien, porque el borrado es total.
// ---------------------------------------------------------------------------

export type ResultadoDelReinicioDeDemo = ResultadoDelReinicio | ResultadoDelReinicioDelTaller;

export type EstadoDelReinicioDeDemo =
  | { estado: "NINGUNO" }
  | { estado: "REINICIANDO"; iniciadoEn: string }
  | {
      estado: "LISTO";
      iniciadoEn: string;
      terminadoEn: string;
      resultado: ResultadoDelReinicioDeDemo;
    }
  | { estado: "FALLO"; iniciadoEn: string; terminadoEn: string; mensaje: string };

export const FALLO_INESPERADO_DEL_REINICIO =
  "No se pudo terminar el reinicio. Volvé a reiniciar: el borrado es total, así que la demo queda bien.";

type Preparar = (
  organizationId: string,
  opciones: { ahora?: Date },
) => Promise<() => Promise<ResultadoDelReinicioDeDemo>>;

/** Valida (404/400/409 sin escribir nada) y devuelve la parte que escribe. */
export async function prepararReinicioDeDemo(
  organizationId: string,
  opciones: { ahora?: Date } = {},
): Promise<() => Promise<ResultadoDelReinicioDeDemo>> {
  const org = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: { industry: true, isDemo: true },
  });
  if (!org) throw new AppError("Organización no encontrada", 404);
  if (!org.isDemo) throw new AppError(NO_ES_UNA_DEMO, 400);
  return org.industry === "CLINICA"
    ? prepararReinicioDeLaDemo(organizationId, opciones)
    : prepararReinicioDelTallerDemo(organizationId, opciones);
}

const reinicios = new Map<string, EstadoDelReinicioDeDemo>();

export interface DepsDelReinicio {
  preparar: Preparar;
  ahora: () => Date;
}

const depsReales: DepsDelReinicio = { preparar: prepararReinicioDeDemo, ahora: () => new Date() };

/** Arranca el reinicio en segundo plano. Lanza lo mismo que la validación
 *  (404/400/409) y 409 si esa demo ya se está reiniciando. */
export async function iniciarReinicioDeDemo(
  organizationId: string,
  opciones: { ahora?: Date } = {},
  deps: DepsDelReinicio = depsReales,
): Promise<EstadoDelReinicioDeDemo> {
  const anterior = reinicios.get(organizationId);
  if (anterior?.estado === "REINICIANDO") throw new AppError(YA_SE_ESTA_REINICIANDO, 409);

  // Se marca ANTES del primer await: dos POST seguidos no pueden pasar los dos
  // la validación y arrancar dos reinicios.
  const iniciadoEn = deps.ahora().toISOString();
  const enCurso: EstadoDelReinicioDeDemo = { estado: "REINICIANDO", iniciadoEn };
  reinicios.set(organizationId, enCurso);

  let ejecutar: () => Promise<ResultadoDelReinicioDeDemo>;
  try {
    ejecutar = await deps.preparar(organizationId, opciones);
  } catch (err) {
    // Rechazado antes de escribir nada: queda el estado que había.
    if (anterior) reinicios.set(organizationId, anterior);
    else reinicios.delete(organizationId);
    throw err;
  }

  void ejecutar().then(
    (resultado) => {
      reinicios.set(organizationId, {
        estado: "LISTO",
        iniciadoEn,
        terminadoEn: deps.ahora().toISOString(),
        resultado,
      });
    },
    (err: unknown) => {
      const conocido = err instanceof AppError && err.isOperational;
      if (!conocido) {
        logger.error({ err, organizationId }, "El reinicio de la demo falló a mitad");
      }
      reinicios.set(organizationId, {
        estado: "FALLO",
        iniciadoEn,
        terminadoEn: deps.ahora().toISOString(),
        mensaje: conocido ? err.message : FALLO_INESPERADO_DEL_REINICIO,
      });
    },
  );
  return enCurso;
}

export function estadoDelReinicioDeDemo(organizationId: string): EstadoDelReinicioDeDemo {
  return reinicios.get(organizationId) ?? { estado: "NINGUNO" };
}
