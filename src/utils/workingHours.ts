import type { Weekday } from "@prisma/client";
import { DateTime } from "luxon";

// ---------------------------------------------------------------------------
// Horario de trabajo: de "los lunes de 9 a 13" a instantes concretos.
//
// ESTE ARCHIVO ES PURO. No toca Postgres, no toca Google, no lee el entorno.
// Recibe franjas, una zona y un rango, y devuelve intervalos. Es lo que permite
// que toda la aritmética del módulo —la parte donde un error produce turnos a la
// hora equivocada sin ningún síntoma— se pruebe como test unitario.
//
// ---------------------------------------------------------------------------
// POR QUÉ ENTRÓ LUXON, QUE ES LA ÚNICA DEPENDENCIA NUEVA DEL PASO 3
// ---------------------------------------------------------------------------
//
// Se verificó primero que el repositorio no tuviera ya una librería de fechas
// (no la tenía: ni luxon, ni date-fns, ni dayjs, ni moment) y que `Temporal` no
// estuviera disponible en el runtime (no lo está, ni en el Node 22 del CI ni en
// el Node 24 local). `src/utils/timezone.ts` existe pero solo VALIDA una zona
// IANA con `Intl`; no convierte nada.
//
// La operación que hace falta es una sola, y es la difícil:
//
//     (día de semana + hora de pared + zona IANA + fecha) -> instante UTC
//
// `Intl` resuelve bien la dirección CONTRARIA (instante -> partes locales). Para
// ésta hay que invertirla, y la técnica sin librería es adivinar el offset,
// aplicarlo, recalcular el offset en el instante resultante e iterar hasta que
// converja. Converge, pero tiene dos casos borde que no son teóricos:
//
//   - El SALTO de primavera: a las 2 de la mañana el reloj salta a las 3, así
//     que las 2:30 locales NO EXISTEN ese día. ¿Qué instante es "las 2:30"?
//   - El SOLAPAMIENTO de otoño: el reloj vuelve atrás y la 1:30 local ocurre
//     DOS VECES. ¿Cuál de las dos?
//
// Escribir eso a mano es exactamente donde se cuelan los bugs, y son bugs
// silenciosos: producen horarios correctos medio año y corridos una hora el otro
// medio, sin ningún error visible — el mismo modo de falla que `timezone.ts` ya
// documenta al rechazar los offsets crudos.
//
// Argentina no tiene horario de verano desde 2009, así que en el mercado
// inmediato esto no se notaría. Pero el sistema es multi-tenant y la zona es un
// dato por sucursal: Chile, Paraguay, Estados Unidos y Europa sí lo tienen.
//
// Luxon pesa poco, no arrastra dependencias transitivas, y el gate de auditoría
// del CI pasa limpio con ella. Es la elección aburrida y correcta.
//
// LO QUE LUXON DECIDE POR NOSOTROS, y queda fijado con tests para que sea una
// decisión y no una casualidad de la implementación: ante una hora local
// inexistente adelanta al instante posterior al salto, y ante una ambigua elige
// la PRIMERA ocurrencia. Ver workingHours.test.ts.
// ---------------------------------------------------------------------------

// El mapeo entre el enum de Prisma y el número de día de Luxon vive ACÁ Y EN UN
// SOLO LUGAR. Luxon usa la convención ISO —1 = lunes ... 7 = domingo— que NO es
// la de `Date.getDay()` (0 = domingo). Tener las dos convenciones circulando por
// el código es el origen del bug de "el horario quedó corrido un día", y el enum
// del schema existe justamente para que ese número no viaje.
const DIAS_POR_NUMERO_ISO: readonly Weekday[] = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

export function weekdayDesdeIso(numeroIso: number): Weekday {
  const dia = DIAS_POR_NUMERO_ISO[numeroIso - 1];
  if (!dia) {
    throw new Error(`Número de día ISO fuera de rango: ${numeroIso}`);
  }
  return dia;
}

// Minutos desde la medianoche local. 1440 = medianoche del día siguiente.
export const MINUTOS_POR_DIA = 1440;

export interface FranjaSemanal {
  weekday: Weekday;
  startMinute: number;
  endMinute: number;
}

// Un intervalo concreto, en instantes reales. `fin` es EXCLUSIVO: un turno de
// 9:00 a 9:30 y otro de 9:30 a 10:00 NO se superponen. Toda la aritmética de
// abajo asume esa convención, y es la que hace que dos turnos consecutivos sean
// posibles.
export interface Intervalo {
  inicio: Date;
  fin: Date;
}

// ---------------------------------------------------------------------------
// Aritmética de intervalos
// ---------------------------------------------------------------------------

// [a.inicio, a.fin) ∩ [b.inicio, b.fin) ≠ ∅
//
// LA COMPARACIÓN ES ESTRICTA EN LOS DOS LADOS, y ese detalle es la diferencia
// entre "dos turnos consecutivos se pueden agendar" y "el sistema los rechaza
// por chocar". Con `<=` en cualquiera de las dos, 9:00-9:30 y 9:30-10:00 se
// considerarían superpuestos.
export function seSuperponen(a: Intervalo, b: Intervalo): boolean {
  return a.inicio.getTime() < b.fin.getTime() && a.fin.getTime() > b.inicio.getTime();
}

// [contenido] ⊆ [contenedor]
export function estaContenido(contenido: Intervalo, contenedor: Intervalo): boolean {
  return (
    contenido.inicio.getTime() >= contenedor.inicio.getTime() &&
    contenido.fin.getTime() <= contenedor.fin.getTime()
  );
}

// ¿El intervalo cae ENTERO dentro de alguna de las franjas de trabajo?
//
// ES LA FUNCIÓN QUE COMPARTEN LA DISPONIBILIDAD Y LA RESERVA, y compartirla no
// es una comodidad: que "los horarios que el sistema ofrece" y "los horarios que
// el sistema acepta" se calculen con dos códigos distintos es la clase de
// inconsistencia que nadie ve hasta que un cliente reserva un horario que
// después le rechazan. Un solo lugar, una sola respuesta.
//
// "Dentro de ALGUNA" y no "de la unión": un turno no puede empezar en la franja
// de la mañana y terminar en la de la tarde. Si el recurso trabaja 9-13 y 16-20,
// un turno de 12:30 a 16:30 NO es válido aunque las dos puntas caigan en
// horario — en el medio el recurso no está.
export function estaDentroDelHorario(intervalo: Intervalo, franjas: Intervalo[]): boolean {
  return franjas.some((franja) => estaContenido(intervalo, franja));
}

// ---------------------------------------------------------------------------
// La grilla de turnos — V-2 de docs/auditoria-2026-08-29.md
// ---------------------------------------------------------------------------

// Los turnos de UNA franja: arrancan en el borde real de la franja y avanzan de
// a `duracionMin`, consecutivos y sin huecos, hasta el último que entra entero.
// NO es una grilla de reloj ("siempre en punto y media"): es relativa a cuándo
// abre esa franja ese día — un recurso que abre 9:15 tiene turnos 9:15, 9:45…
//
// ES LA ÚNICA ARITMÉTICA DE PASO DEL MÓDULO, y las dos puntas la comparten:
// calcularTurnos (availability.service.ts) la recorre para OFRECER, y
// estaEnLaGrilla la recorre para ACEPTAR. Hasta V-2 el bucle vivía adentro de
// calcularTurnos y createBooking solo validaba contención (estaDentroDelHorario):
// una reserva a las 9:07 con turnos de 30 minutos era válida y tapaba los
// turnos de 9:00 y 9:30 de la grilla que todo el mundo ve. Mismo criterio que
// compartir estaDentroDelHorario: un solo lugar, una sola respuesta.
export function generarGrilla(franja: Intervalo, duracionMin: number): Intervalo[] {
  const duracionMs = duracionMin * 60 * 1000;
  const turnos: Intervalo[] = [];
  for (
    let inicio = franja.inicio.getTime();
    inicio + duracionMs <= franja.fin.getTime();
    inicio += duracionMs
  ) {
    turnos.push({ inicio: new Date(inicio), fin: new Date(inicio + duracionMs) });
  }
  return turnos;
}

// ¿El intervalo es EXACTAMENTE uno de los turnos que la grilla generaría? Implica
// contención en alguna franja (los turnos nacen adentro), alineación al paso
// desde el borde de ESA franja, y duración igual al paso. Un intervalo que cae
// en el hueco entre dos franjas no está en la grilla de ninguna; uno que empieza
// a las 9:07 tampoco, aunque esté contenido.
//
// Se pregunta por enumeración y no por módulo ((inicio - franja.inicio) %
// duración) a propósito: enumerar es la misma función que ofrece los turnos, así
// que "lo que se acepta" no puede divergir de "lo que se ofrece" ni por un
// detalle de redondeo. Una franja tiene a lo sumo unas decenas de turnos.
export function estaEnLaGrilla(
  intervalo: Intervalo,
  franjas: Intervalo[],
  duracionMin: number,
): boolean {
  const inicio = intervalo.inicio.getTime();
  const fin = intervalo.fin.getTime();
  return franjas.some((franja) =>
    generarGrilla(franja, duracionMin).some(
      (turno) => turno.inicio.getTime() === inicio && turno.fin.getTime() === fin,
    ),
  );
}

// ---------------------------------------------------------------------------
// La conversión que motiva el archivo
// ---------------------------------------------------------------------------

// Convierte una hora de pared (fecha local + minutos desde medianoche) al
// instante UTC que le corresponde en `zona`.
//
// El caso de los 1440 minutos se resuelve pidiéndole a Luxon el día siguiente a
// las 00:00 en vez de intentar construir una hora 24, que no existe.
function instanteDeHoraLocal(fechaLocal: DateTime, minutos: number, zona: string): Date {
  const base =
    minutos >= MINUTOS_POR_DIA
      ? fechaLocal.plus({ days: Math.floor(minutos / MINUTOS_POR_DIA) })
      : fechaLocal;
  const restante = minutos % MINUTOS_POR_DIA;

  // set() sobre hora/minuto fija la HORA DE PARED, que es lo que hace falta.
  // Sumar minutos desde la medianoche (`startOf("day").plus(...)`) sería
  // incorrecto: suma tiempo transcurrido, así que en el día del salto de
  // primavera 00:00 + 540 minutos da las 10:00 locales y no las 9:00.
  return base
    .set({ hour: Math.floor(restante / 60), minute: restante % 60, second: 0, millisecond: 0 })
    .setZone(zona, { keepLocalTime: false })
    .toJSDate();
}

export interface ParametrosDeExpansion {
  franjas: FranjaSemanal[];
  // Zona IANA de la sucursal (Branch.timezone). Nunca la del servidor — §4 de
  // docs/booking-architecture.md.
  zona: string;
  desde: Date;
  hasta: Date;
}

// Expande el horario semanal recurrente a los intervalos CONCRETOS que se
// superponen con [desde, hasta).
//
// EL INICIO DE UNA FRANJA NUNCA SE RECORTA A `desde` — A-5 de
// docs/auditoria-2026-08-29.md. Antes sí: si alguien pedía disponibilidad del
// martes a las 11:10, la franja "martes de 9 a 13" salía como 11:10-13:00, y
// como la grilla de turnos arranca en el borde de cada franja, los turnos
// salían 11:10, 11:40, 12:10… en vez de 11:30, 12:00, 12:30. Dos clientes que
// consultaban en momentos distintos veían grillas distintas, y una reserva
// hecha desde una grilla corrida tapaba DOS turnos de la grilla real. El
// objetivo del recorte ("no ofrecer horarios que ya pasaron") sigue vigente,
// pero se cumple FILTRANDO los turnos ya generados (calcularTurnos, `desde`),
// no moviendo el borde del horario: la franja expresa el horario real del
// recurso, y si abre a las 9 empieza a las 9 se pida lo que se pida.
//
// Lo que SÍ se recorta:
//   - el FIN, a `hasta`: no mueve la grilla (que arranca en el inicio) y evita
//     generar turnos más allá del rango pedido;
//   - las franjas que quedan ENTERAS fuera del rango (terminan antes de
//     `desde` o empiezan en `hasta` o después): no aportan nada y no vale la
//     pena expandirlas.
export function expandirFranjas({
  franjas,
  zona,
  desde,
  hasta,
}: ParametrosDeExpansion): Intervalo[] {
  if (franjas.length === 0 || desde.getTime() >= hasta.getTime()) {
    return [];
  }

  const porDia = new Map<Weekday, FranjaSemanal[]>();
  for (const franja of franjas) {
    const existentes = porDia.get(franja.weekday);
    if (existentes) {
      existentes.push(franja);
    } else {
      porDia.set(franja.weekday, [franja]);
    }
  }

  // Se itera por DÍA LOCAL, no por día UTC: el día de la semana de una franja es
  // el de la sucursal. Un lunes a las 22 en Buenos Aires ya es martes en UTC, y
  // recorrer días UTC dejaría esa franja del lado equivocado.
  //
  // Se arranca un día antes del comienzo del rango: una franja que empieza el
  // domingo a las 23:30 y termina a las 24:00 puede solaparse con un rango que
  // arranca el lunes a las 00:00 en otra zona. Es barato y cierra el borde.
  const primerDia = DateTime.fromJSDate(desde, { zone: zona }).startOf("day").minus({ days: 1 });
  const ultimoDia = DateTime.fromJSDate(hasta, { zone: zona }).startOf("day");

  const intervalos: Intervalo[] = [];

  for (let dia = primerDia; dia <= ultimoDia; dia = dia.plus({ days: 1 })) {
    const delDia = porDia.get(weekdayDesdeIso(dia.weekday));
    if (!delDia) {
      continue;
    }

    for (const franja of delDia) {
      const inicio = instanteDeHoraLocal(dia, franja.startMinute, zona);
      const fin = instanteDeHoraLocal(dia, franja.endMinute, zona);

      // Fuera del rango por completo: no aporta nada.
      if (fin.getTime() <= desde.getTime() || inicio.getTime() >= hasta.getTime()) {
        continue;
      }

      // El inicio queda ENTERO (ver el comentario de la función); solo el fin
      // se recorta a `hasta`.
      const finRecortado = new Date(Math.min(fin.getTime(), hasta.getTime()));

      if (inicio.getTime() < finRecortado.getTime()) {
        intervalos.push({ inicio, fin: finRecortado });
      }
    }
  }

  // Ordenados: quien genera turnos los recorre en orden, y la salida de la
  // disponibilidad tiene que ser cronológica.
  intervalos.sort((a, b) => a.inicio.getTime() - b.inicio.getTime());

  return intervalos;
}

// ---------------------------------------------------------------------------
// Validación de un horario semanal completo
// ---------------------------------------------------------------------------

// Detecta franjas superpuestas DENTRO del mismo día. "Lunes 9-13" y "lunes
// 12-20" es un error de carga, no una configuración exótica: produciría
// intervalos duplicados en la disponibilidad y haría que un mismo turno aparezca
// dos veces.
//
// Franjas ADYACENTES (9-13 y 13-20) son válidas: el fin es exclusivo.
export function encontrarFranjasSuperpuestas(franjas: FranjaSemanal[]): FranjaSemanal | undefined {
  const porDia = new Map<Weekday, FranjaSemanal[]>();

  for (const franja of franjas) {
    const existentes = porDia.get(franja.weekday) ?? [];
    existentes.push(franja);
    porDia.set(franja.weekday, existentes);
  }

  for (const delDia of porDia.values()) {
    const ordenadas = [...delDia].sort((a, b) => a.startMinute - b.startMinute);

    for (let i = 1; i < ordenadas.length; i++) {
      if (ordenadas[i].startMinute < ordenadas[i - 1].endMinute) {
        return ordenadas[i];
      }
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// "HH:MM" <-> minutos — la traducción del borde HTTP
//
// La API habla en horas legibles porque del otro lado hay una persona cargando
// el horario de su negocio; la base guarda enteros porque toda la lógica es
// aritmética. La conversión vive acá para que las dos direcciones estén juntas y
// no se desincronicen.
// ---------------------------------------------------------------------------

const FORMA_HH_MM = /^([01]\d|2[0-4]):([0-5]\d)$/;

export function minutosDesdeHoraLocal(hhmm: string): number | undefined {
  const coincidencia = FORMA_HH_MM.exec(hhmm);
  if (!coincidencia) {
    return undefined;
  }

  const horas = Number(coincidencia[1]);
  const minutos = Number(coincidencia[2]);
  const total = horas * 60 + minutos;

  // "24:00" es válido (medianoche del día siguiente, el tope de una franja);
  // "24:30" no.
  if (total > MINUTOS_POR_DIA) {
    return undefined;
  }

  return total;
}

export function horaLocalDesdeMinutos(minutos: number): string {
  const horas = Math.floor(minutos / 60);
  const restante = minutos % 60;
  return `${String(horas).padStart(2, "0")}:${String(restante).padStart(2, "0")}`;
}
