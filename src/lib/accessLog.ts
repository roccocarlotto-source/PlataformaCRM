import type { Logger } from "pino";
import { logger } from "./logger";
import type { AuthContext } from "../types/auth";

// ---------------------------------------------------------------------------
// Registro de acceso a datos personales — hallazgo D2-5 de
// docs/review-fase2-2026-08-28.md.
//
// `STD-LEG-002` es literal: todo acceso a datos Sensitive debe quedar
// registrado — quién accedió a qué, y cuándo. La Fase 2 estrenó los primeros
// accesos HUMANOS a datos personales de leads (IngestionEventListPage,
// ImportPage) y no quedaba registro de ninguno.
//
// LO QUE ESTO NO ES: no reemplaza ni duplica a pino-http, que ya escribe
// método, path, status y duración de cada request. Eso responde "hubo un
// request"; esto responde "se accedió a datos personales de la categoría X",
// que es lo que el estándar pide y lo que ninguna línea de pino-http dice.
// Por eso la línea lleva `evento` con un valor fijo: es lo que hace que estos
// accesos sean filtrables como conjunto, sin depender de matchear rutas.
//
// POR QUÉ UN LOG ESTRUCTURADO Y NO UNA TABLA (decisión de producto, no
// técnica): una tabla de auditoría es otro lugar donde viven datos personales
// —con su propia retención, su propio borrado a pedido y su propio control de
// acceso—, y el estándar la pediría cubierta igual que a la original. El log
// estructurado ya existe, ya está redactado (ver logger.ts) y sale del proceso
// hacia donde lo recoja la infraestructura.
//
// QUÉ NO SE ESCRIBE ACÁ, y es deliberado: NINGÚN valor de dato personal. Se
// registra QUIÉN accedió y A QUÉ recurso, nunca el nombre ni el email que vio.
// Un log de accesos que copia los datos que audita duplica exactamente el
// problema que existe para controlar.
// ---------------------------------------------------------------------------

// Las clases de STD-LEG-002 que obligan a registrar el acceso. `Public` e
// `Internal` no entran: si algún día se llama a esta función con un dato
// Internal, el tipo lo frena.
export type ClaseRegistrable = "Sensitive" | "Regulated";

export interface AccesoADatosPersonales {
  // De dónde sale la identidad: siempre el AuthContext ya resuelto contra
  // Postgres, nunca claims sueltos del JWT.
  auth: AuthContext;
  // El recurso lógico al que se accedió, en la forma "MÉTODO /ruta". Se pasa
  // explícito en vez de derivarlo del request para que el valor sea estable
  // aunque la ruta se monte en otro lado.
  recurso: string;
  clase: ClaseRegistrable;
  // Qué se pidió exactamente: filtros, identificadores. Sin valores de datos
  // personales — ver el comentario de arriba.
  detalle?: Record<string, unknown>;
}

// `log` inyectable con el logger real por defecto — mismo patrón que
// `db: Db = prisma` en los repositorios. Existe para que el test pueda leer la
// línea que sale de acá en vez de afirmar sobre el código que la arma.
export function logAccesoADatosPersonales(
  { auth, recurso, clase, detalle }: AccesoADatosPersonales,
  log: Pick<Logger, "info"> = logger,
): void {
  log.info(
    {
      evento: "acceso_datos_personales",
      userId: auth.userId,
      organizationId: auth.organizationId,
      rol: auth.role,
      recurso,
      clase,
      ...detalle,
    },
    "Acceso a datos personales",
  );
}
