import { DateTime } from "luxon";

// ---------------------------------------------------------------------------
// El recordatorio del próximo service (docs/servicios.md §6, S7): las
// constantes, los textos fijos y las funciones puras. Nada de esto corre en una
// organización sin el módulo Servicios: no puede crear la regla (el trigger es
// del módulo) y el barrido solo mira organizaciones con el módulo activado.
// ---------------------------------------------------------------------------

export const TRIGGER_NEXT_SERVICE_DUE = "service.next_service_due";
export const ACTION_SEND_NEXT_SERVICE_REMINDER = "service.send_next_service_reminder";

/** El texto con el que arranca una regla nueva (espejo en
 *  frontend/src/features/automation/catalog.ts). Es el que se manda a aprobar
 *  a Meta: no empieza ni termina con una variable, la matrícula va dentro de
 *  {vehiculo} (Meta no acepta un parámetro vacío) y "previsto para" sirve
 *  antes y después de la fecha. */
export const TEXTO_POR_DEFECTO_DEL_PROXIMO_SERVICE =
  "Hola {nombre}, te escribimos de {lugar}. El próximo service de tu {vehiculo} está previsto para {fecha}. Si querés agendarlo, respondé este mensaje y te damos un turno.";

/** Los días antes (negativos) o después (positivos) de la fecha del service en
 *  que sale el aviso (§6.2). */
export const OFFSET_MINIMO = -60;
export const OFFSET_MAXIMO = 90;

/** El margen que cubre un día sin barrido (una caída, un deploy) sin mandar
 *  recordatorios de hace meses (§6.2). */
export const MARGEN_DE_DIAS = 7;

/** La hora local de la organización desde la que corre el barrido del día
 *  (§6.2): el tick es cada hora, y antes de las 10:00 no hace nada. */
export const HORA_DEL_BARRIDO = 10;

/** Por qué un recordatorio encolado ya no sale (§6.3), en last_error y
 *  cancel_reason. */
export const MOTIVO_SIN_MODULO = "El módulo Servicios está desactivado";
export const MOTIVO_REGLA_INACTIVA = "La regla está desactivada o se borró";
export const MOTIVO_FECHA_CAMBIO = "La fecha del próximo service del vehículo cambió";
export const MOTIVO_VEHICULO_NO_VIGENTE =
  "El vehículo ya no es del cliente, se borró o cambió de dueño";
export const MOTIVO_ORDEN_ABIERTA = "El vehículo tiene una orden abierta";
export const MOTIVO_NO_RECORDAR = "El vehículo está marcado No recordar";
export const MOTIVO_CONTACTO_NO_VIGENTE = "El cliente se borró o está marcado sin interés";
export const MOTIVO_SIN_WHATSAPP = "sin WhatsApp";
// D8: el cliente apagó los mensajes de marketing en WhatsApp. Para el taller es
// lo mismo que no tener WhatsApp: hay que llamarlo.
export const MOTIVO_SIN_MARKETING = "sin WhatsApp (el cliente apagó los mensajes de marketing)";
export const MOTIVO_SIN_NUMERO = "sin WhatsApp (la organización no tiene un número conectado)";
export const MOTIVO_SIN_PLANTILLA = "sin WhatsApp (la regla no tiene una plantilla aprobada)";

/** Los códigos de la Cloud API con los que Meta rechaza un envío de marketing a
 *  quien lo apagó (131050: "user has chosen to stop receiving marketing
 *  messages"). */
export const CODIGOS_SIN_MARKETING: ReadonlySet<number> = new Set([131050]);

/** Las fechas de service que tocan hoy para una regla (§6.2): las que,
 *  corridas `offsetDays`, caen en [hoy − 7, hoy]. Fechas @db.Date (medianoche
 *  UTC del día). */
export function ventanaDeFechas(hoy: Date, offsetDays: number): { desde: Date; hasta: Date } {
  const dia = DateTime.fromJSDate(hoy, { zone: "utc" }).startOf("day");
  return {
    desde: dia.minus({ days: MARGEN_DE_DIAS + offsetDays }).toJSDate(),
    hasta: dia.minus({ days: offsetDays }).toJSDate(),
  };
}

/** ¿Ya son las 10:00 en la zona de la organización? */
export function yaEsHoraDelBarrido(ahora: Date, timezone: string): boolean {
  const local = DateTime.fromJSDate(ahora).setZone(timezone);
  return local.isValid ? local.hour >= HORA_DEL_BARRIDO : true;
}

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** {fecha}: "el 15 de noviembre" (§6.4). La fecha es @db.Date (UTC). */
export function textoDeLaFecha(fecha: Date): string {
  return `el ${String(fecha.getUTCDate())} de ${MESES[fecha.getUTCMonth()]}`;
}

/** {vehiculo}: marca y modelo, con la matrícula entre paréntesis si la tiene
 *  ("Volkswagen Gol (ABC 1234)"). Nunca vacío: Meta no acepta un parámetro
 *  vacío. */
export function textoDelVehiculo(v: {
  make: string;
  model: string;
  licensePlate: string | null;
}): string {
  const base = `${v.make} ${v.model}`.trim() || "vehículo";
  const matricula = v.licensePlate?.trim();
  return matricula ? `${base} (${matricula})` : base;
}

/** El asunto de la tarea cuando la regla trae su propio título: se le suma el
 *  vehículo, porque el título de la regla es el mismo para todos los avisos y
 *  en Mis tareas no se sabía de qué auto era (prueba de S13). Si el título ya
 *  lo nombra, queda como está. Tope de 255, el de activities.subject. */
export function asuntoConElVehiculo(titulo: string, vehiculo: string): string {
  if (titulo.includes(vehiculo)) return titulo;
  return `${titulo} — ${vehiculo}`.slice(0, 255);
}

/** {lugar}: la organización, o "Organización (sucursal X)" con más de una
 *  sucursal, como el {lugar} del recordatorio de turno. */
export function textoDelLugar(
  organizacion: string,
  sucursal: string | null,
  sucursales: number,
): string {
  return sucursal && sucursales > 1 ? `${organizacion} (sucursal ${sucursal})` : organizacion;
}

/** El asunto de la tarea "Llamar a…" (§6.3), corto para la lista. */
export function asuntoDeLaTarea(cliente: string, vehiculo: string): string {
  return `Llamar a ${cliente} por el service de su ${vehiculo}`.slice(0, 255);
}
