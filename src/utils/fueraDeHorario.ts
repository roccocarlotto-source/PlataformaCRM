import type { Weekday } from "@prisma/client";
import { DateTime } from "luxon";
import { proximoMomentoParaEnviar } from "./horarioDeAtencion";
import type { FranjaSemanal } from "./workingHours";

// ---------------------------------------------------------------------------
// Qué decirle al cliente cuando pide una persona y la sucursal está cerrada.
//
// Una derivación a las 3 de la mañana no puede prometer "alguien te va a
// contactar a la brevedad": el cliente espera y nadie aparece hasta que abre
// la sucursal. Fuera de horario, el mensaje dice cuándo atiende el equipo y
// cuándo le van a escribir ("mañana a partir de las 9"), en la zona de la
// sucursal.
//
// SOLO CON HORARIO CARGADO. Una sucursal que no cargó el suyo se comporta como
// antes de esto (sin aviso de horario): el default de lunes a sábado de 9 a 20
// (HORARIO_POR_DEFECTO) sirve para no mandar un seguimiento de madrugada, pero
// no es algo que el negocio haya dicho, y prometerle al cliente un horario que
// el negocio nunca cargó sería inventarlo.
//
// Lo usan el cierre de una derivación (agentOrchestration.service.ts) y el
// aviso de "no hay nadie disponible" (avisoSinRespuesta.service.ts).
// ---------------------------------------------------------------------------

export interface AtencionFueraDeHorario {
  // "de lunes a sábado de 9 a 20 h"
  horario: string;
  // "mañana a partir de las 9"
  cuando: string;
  proximaApertura: Date;
}

const DIAS: readonly Weekday[] = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

const NOMBRE_DEL_DIA: Record<Weekday, string> = {
  MONDAY: "lunes",
  TUESDAY: "martes",
  WEDNESDAY: "miércoles",
  THURSDAY: "jueves",
  FRIDAY: "viernes",
  SATURDAY: "sábado",
  SUNDAY: "domingo",
};

// "los sábados", "los lunes": para un día suelto del horario.
function enPlural(dia: Weekday): string {
  const nombre = NOMBRE_DEL_DIA[dia];
  return nombre.endsWith("s") ? nombre : `${nombre}s`;
}

// 540 → "9", 570 → "9:30", 1440 → "24".
function hora(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? String(h) : `${h}:${String(m).padStart(2, "0")}`;
}

function enumerar(partes: string[]): string {
  if (partes.length <= 1) return partes.join("");
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

// El horario semanal en una frase: los días seguidos con las mismas franjas se
// agrupan ("de lunes a viernes de 9 a 20 h y los sábados de 9 a 13 h").
export function describirHorario(franjas: readonly FranjaSemanal[]): string {
  const franjasDelDia = (dia: Weekday) =>
    franjas
      .filter((f) => f.weekday === dia)
      .sort((a, b) => a.startMinute - b.startMinute)
      .map((f) => `de ${hora(f.startMinute)} a ${hora(f.endMinute)}`);

  const grupos: { dias: Weekday[]; franjas: string }[] = [];
  for (const dia of DIAS) {
    const delDia = franjasDelDia(dia);
    if (delDia.length === 0) continue;
    const texto = `${enumerar(delDia)} h`;
    const ultimo = grupos[grupos.length - 1];
    const anterior = ultimo?.dias[ultimo.dias.length - 1];
    if (
      ultimo &&
      anterior &&
      DIAS.indexOf(anterior) === DIAS.indexOf(dia) - 1 &&
      ultimo.franjas === texto
    ) {
      ultimo.dias.push(dia);
    } else {
      grupos.push({ dias: [dia], franjas: texto });
    }
  }

  return enumerar(
    grupos.map(({ dias, franjas: texto }) => {
      const primero = dias[0]!;
      const ultimo = dias[dias.length - 1]!;
      const cuales =
        dias.length === 1
          ? `los ${enPlural(primero)}`
          : dias.length === 2
            ? `${NOMBRE_DEL_DIA[primero]} y ${NOMBRE_DEL_DIA[ultimo]}`
            : `de ${NOMBRE_DEL_DIA[primero]} a ${NOMBRE_DEL_DIA[ultimo]}`;
      return `${cuales} ${texto}`;
    }),
  );
}

// Cuándo abre, relativo a hoy en la zona de la sucursal: "hoy a partir de las
// 9", "mañana a partir de las 9:30", "el lunes a partir de las 9". A una
// semana o más (un horario de un solo día por semana), con la fecha.
export function describirApertura(apertura: Date, zona: string, ahora: Date): string {
  const abre = DateTime.fromJSDate(apertura, { zone: zona });
  const hoy = DateTime.fromJSDate(ahora, { zone: zona }).startOf("day");
  const dias = Math.round(abre.startOf("day").diff(hoy, "days").days);
  const minutos = abre.hour * 60 + abre.minute;
  const aLas = `a partir de ${abre.hour === 1 ? "la" : "las"} ${hora(minutos)}`;
  const dia = NOMBRE_DEL_DIA[DIAS[abre.weekday - 1]!];
  if (dias <= 0) return `hoy ${aLas}`;
  if (dias === 1) return `mañana ${aLas}`;
  if (dias < 7) return `el ${dia} ${aLas}`;
  return `el ${dia} ${abre.setLocale("es").toFormat("d 'de' MMMM")} ${aLas}`;
}

// null si la sucursal está abierta o no tiene horario cargado: el mensaje
// queda como siempre. `zona` es Branch.timezone.
export function atencionFueraDeHorario(
  franjas: readonly FranjaSemanal[],
  zona: string,
  ahora: Date,
): AtencionFueraDeHorario | null {
  if (franjas.length === 0) return null;
  const proximaApertura = proximoMomentoParaEnviar(franjas, zona, ahora);
  if (proximaApertura.getTime() <= ahora.getTime()) return null;
  return {
    horario: describirHorario(franjas),
    cuando: describirApertura(proximaApertura, zona, ahora),
    proximaApertura,
  };
}

// "Nuestro equipo atiende de lunes a sábado de 9 a 20 h. Te vamos a escribir
// mañana a partir de las 9."
export function fraseFueraDeHorario(atencion: AtencionFueraDeHorario): string {
  return `Nuestro equipo atiende ${atencion.horario}. Te vamos a escribir ${atencion.cuando}.`;
}
