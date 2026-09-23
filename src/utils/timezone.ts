// Valida que una cadena sea una zona horaria IANA que este runtime reconoce
// ("America/Argentina/Buenos_Aires", "UTC").
//
// POR QUÉ SE VALIDA Y NO ALCANZA UN String. §4 de docs/booking-architecture.md
// es explícito en que cada sucursal necesita su propia zona horaria y que no se
// asume la del servidor. Una zona mal tipeada —"Buenos Aires" con espacio,
// "GMT-3", "America/Buenos_Aires" sin el tramo Argentina— no falla al guardarse:
// falla mucho después, cuando alguien calcule un horario, y con un turno a la
// hora equivocada como único síntoma.
//
// SE PREGUNTA AL RUNTIME, NO A UNA LISTA PROPIA. Una lista embebida se
// desactualiza sola —la base de datos IANA cambia varias veces por año— y
// mantenerla sería asumir un trabajo que Node ya hace. `Intl.DateTimeFormat`
// lanza RangeError ante una zona que no conoce, y esa excepción es la
// validación.
//
// SE RECHAZAN LOS OFFSETS CRUDOS, y esto NO es un extra: es el requisito.
//
// ECMA-402 acepta desplazamientos como zona horaria — `-03:00` y `+03:00`
// construyen un formateador sin protestar (verificado contra este runtime, no
// supuesto; `GMT-3` en cambio sí lo rechaza por formato). Pero un offset **no
// sabe nada de horario de verano**: guardarlo produce horarios correctos medio
// año y equivocados el otro medio, sin ningún síntoma hasta que un cliente no
// aparece. Es exactamente el error que §4 de docs/booking-architecture.md quiere
// evitar cuando pide la zona de la sucursal en vez de asumir la del servidor.
//
// Se detecta por la forma RESUELTA y no por la escrita: `resolvedOptions()`
// normaliza, así que alcanza con ver si lo que quedó es un desplazamiento.
//
// `Etc/GMT+3` SÍ se acepta, y la diferencia importa: es una zona IANA real —
// resuelve a `Etc/GMT+3`, no a un offset— así que es una elección legítima,
// rara pero deliberada, y no un dedo resbalado.
//
// LÍMITE CONOCIDO: acepta también los alias históricos que IANA mantiene por
// compatibilidad ("America/Buenos_Aires" a secas es uno, y resuelve a la zona
// correcta). No se filtran: son zonas válidas, no errores.
const FORMA_DE_OFFSET = /^[+-]\d{2}:\d{2}$/;

export function esZonaHorariaValida(zona: string): boolean {
  try {
    const resuelta = new Intl.DateTimeFormat("en-US", { timeZone: zona }).resolvedOptions()
      .timeZone;
    return !FORMA_DE_OFFSET.test(resuelta);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// ISO 8601 EN LA ZONA DE LA SUCURSAL (ítem 104)
// ---------------------------------------------------------------------------
// `Date.toISOString()` siempre escribe en UTC ("2026-09-30T14:00:00.000Z"), y
// eso es correcto para una API y desastroso para un LLM: el agente leyó ese
// "14:00" como hora local y le dijo a un cliente de Montevideo que a las 11 no
// había lugar y que el primer turno era a las 14 — cuando 14:00Z ES las 11:00
// ahí. Todas las horas que daba el agente estaban corridas por el offset.
//
// Esto devuelve el MISMO instante escrito en la zona del negocio, con offset
// explícito ("2026-09-30T11:00:00-03:00"): sin ambigüedad para el modelo, y en
// el mismo formato que las tools de agenda piden de vuelta, así que un horario
// que el agente leyó se puede reservar tal cual.
export function isoEnZona(fecha: Date, zona: string): string {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zona,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(fecha)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  // El offset se deduce comparando la hora de pared en esa zona contra el
  // instante real: no hay API directa, y hacerlo así respeta el horario de
  // verano sin tablas propias.
  const comoSiFueraUtc = Date.UTC(
    Number(partes.year),
    Number(partes.month) - 1,
    Number(partes.day),
    Number(partes.hour),
    Number(partes.minute),
    Number(partes.second),
  );
  const offsetMin = Math.round((comoSiFueraUtc - fecha.getTime()) / 60_000);
  const signo = offsetMin < 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");

  return `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}:${partes.second}${signo}${hh}:${mm}`;
}
