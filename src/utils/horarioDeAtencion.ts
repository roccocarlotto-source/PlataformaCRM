import { expandirFranjas, type FranjaSemanal } from "./workingHours";

// ---------------------------------------------------------------------------
// La ventana de envío de los mensajes que INICIA el negocio — G-07 de
// docs-privados/auditoria-2026-09-30-corta.md (local, no está en GitHub).
//
// Un seguimiento con QR o un cupón agendado para las 4 de la mañana (una
// oportunidad ganada a las 22 h + 6 h de demora, o una ráfaga acumulada
// mientras Render dormía) no sale a esa hora: se corre al próximo momento en
// que la sucursal atiende, en su zona horaria.
//
// SOLO para mensajes que inicia el negocio. Las respuestas del agente a un
// mensaje entrante del cliente no pasan por acá y siguen 24/7.
// ---------------------------------------------------------------------------

// El horario de una sucursal que no cargó el suyo: lunes a sábado de 9 a 20.
// Cargarlo es opcional (BranchBusinessHours).
export const HORARIO_POR_DEFECTO: readonly FranjaSemanal[] = (
  ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"] as const
).map((weekday) => ({ weekday, startMinute: 9 * 60, endMinute: 20 * 60 }));

// Cuánto hacia adelante se busca la próxima apertura. Una semana entera más un
// día alcanza para cualquier horario semanal con al menos una franja; el día
// extra cubre el borde de una franja que empieza justo cuando termina la
// ventana.
const VENTANA_DE_BUSQUEDA_MS = 8 * 24 * 60 * 60 * 1000;

// El momento en que se puede mandar: `ahora` si la sucursal está abierta, o el
// inicio de su próxima franja. `franjas` vacío = sucursal sin horario cargado →
// HORARIO_POR_DEFECTO. `zona` es Branch.timezone (IANA).
//
// El fin de una franja es exclusivo, igual que en la agenda: con "9 a 20", a
// las 20:00 en punto ya está cerrada y el envío pasa al día siguiente.
export function proximoMomentoParaEnviar(
  franjas: readonly FranjaSemanal[],
  zona: string,
  ahora: Date,
): Date {
  const efectivas = franjas.length > 0 ? franjas : HORARIO_POR_DEFECTO;

  const intervalos = expandirFranjas({
    franjas: [...efectivas],
    zona,
    desde: ahora,
    hasta: new Date(ahora.getTime() + VENTANA_DE_BUSQUEDA_MS),
  });

  // expandirFranjas devuelve los intervalos ordenados, sin recortar el inicio
  // a `desde` y descartando los que ya terminaron: el primero es o el que
  // contiene a `ahora`, o el próximo.
  const primero = intervalos[0];
  if (!primero) {
    // Inalcanzable con al menos una franja válida (0 <= start < end <= 1440):
    // toda semana tiene ese día. Si pasara, mandar ahora es preferible a
    // posponer para siempre un mensaje que el negocio pidió.
    return ahora;
  }
  return primero.inicio.getTime() > ahora.getTime() ? primero.inicio : ahora;
}
