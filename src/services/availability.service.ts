import { logger } from "../lib/logger";
import { findConfirmedBookingsInRange } from "../repositories/booking.repository";
import { findResourceById } from "../repositories/resource.repository";
import { findWorkingHoursByResource } from "../repositories/workingHours.repository";
import { AppError } from "../utils/AppError";
import {
  estaDentroDelHorario,
  expandirFranjas,
  seSuperponen,
  type Intervalo,
} from "../utils/workingHours";
import { getBranchById } from "./branch.service";
import { consultarDisponibilidad } from "./googleCalendarConnection.service";
import type { ClienteGoogleCalendar } from "./googleCalendar.service";
import { getServiceTypeById } from "./serviceType.service";

// ---------------------------------------------------------------------------
// GET /api/availability — el endpoint que el paso 2 dejó explícitamente afuera.
//
// LA CUENTA, en una línea: los horarios que el recurso trabaja, MENOS lo que
// Google reporta ocupado, MENOS lo que ya está reservado acá cuando el cupo se
// agotó.
//
// LAS TRES RESTAS SON DE NATURALEZA DISTINTA y conviene tenerlo claro:
//
//   1. HORARIO DE TRABAJO (working_hours). Es configuración nuestra. Define el
//      universo de horarios posibles; sin franjas cargadas no hay
//      disponibilidad, y eso es correcto, no un error.
//   2. OCUPADO EN GOOGLE (freebusy). Es lo que el negocio ya tenía en su
//      calendario antes de usar este CRM, más lo que reflejamos nosotros. Es
//      información de un tercero y puede no estar disponible.
//   3. CUPO YA TOMADO (bookings). Es nuestro propio conteo, y es el único que
//      manda para ServiceType.capacity > 1 — una clase de yoga con 20 lugares
//      aparece OCUPADA en Google desde la primera inscripción, así que si
//      solamente restáramos Google, una clase con un solo inscripto se vería
//      llena.
//
// EL PUNTO 3 ES POR LO QUE LA CAPACIDAD NO PUEDE DELEGARSE EN GOOGLE, y es
// exactamente lo que §1 del documento de diseño ya anticipaba al decir que "el
// control de capacidad vive en este CRM, no en el proveedor de calendario".
// ---------------------------------------------------------------------------

// Tope de rango consultable. No es antojadizo: cada consulta expande franjas
// semanales día por día y hace UNA llamada a Google. Un rango de un año son 365
// iteraciones y una respuesta de freebusy potencialmente enorme, para una
// pantalla que nadie mira así. 62 días cubre "los próximos dos meses", que es el
// horizonte real de una agenda de turnos.
export const MAX_DIAS_DE_RANGO = 62;

export interface ParametrosDeDisponibilidad {
  resourceId: string;
  serviceTypeId: string;
  desde: Date;
  hasta: Date;
}

export interface TurnoDisponible {
  inicio: Date;
  fin: Date;
  // Cuántos lugares quedan. Para capacity = 1 siempre es 1 (si estuviera tomado,
  // el turno no aparecería). Para una clase, es lo que hay que mostrarle a quien
  // se está por inscribir.
  lugaresDisponibles: number;
}

// ---------------------------------------------------------------------------
// El núcleo, PURO: sin base y sin red. Recibe todo resuelto y devuelve turnos.
//
// Está separado del resto para que se pueda probar como test unitario — es
// donde vive la aritmética que decide qué se le ofrece a un cliente, y no
// debería hacer falta un Postgres ni un Google para verificarla.
// ---------------------------------------------------------------------------
export interface EntradaDelCalculo {
  franjasDeTrabajo: Intervalo[];
  ocupadosEnGoogle: Intervalo[];
  reservasConfirmadas: Intervalo[];
  duracionMin: number;
  capacidad: number;
  // A-5: los turnos que EMPIEZAN antes de este instante no se ofrecen (ya
  // pasaron, o quedan antes del rango pedido). Es un FILTRO sobre la grilla ya
  // generada, no un corrimiento de la grilla — ver el comentario del bucle.
  desde?: Date;
}

export function calcularTurnos({
  franjasDeTrabajo,
  ocupadosEnGoogle,
  reservasConfirmadas,
  duracionMin,
  capacidad,
  desde,
}: EntradaDelCalculo): TurnoDisponible[] {
  const duracionMs = duracionMin * 60 * 1000;
  const turnos: TurnoDisponible[] = [];

  for (const franja of franjasDeTrabajo) {
    // LA GRILLA ARRANCA EN EL BORDE REAL DE CADA FRANJA y avanza de a
    // `duracionMin`: turnos consecutivos, sin huecos. Es la política más simple
    // y la más predecible para quien mira la agenda — "cada media hora desde
    // las 9".
    //
    // "REAL" es la corrección de A-5 (docs/auditoria-2026-08-29.md): antes
    // expandirFranjas recortaba el inicio de la franja al `from` de la
    // consulta, así que la grilla arrancaba donde el cliente preguntó y no
    // donde el recurso abre — dos consultas a distinta hora del mismo día
    // daban grillas corridas, y una reserva hecha desde una tapaba dos turnos
    // de la otra. Ahora la franja llega entera y `desde` se aplica ABAJO, como
    // filtro sobre los turnos generados: la grilla es la misma para todos, y
    // quien pregunta más tarde ve la misma grilla con menos turnos al
    // principio.
    //
    // La alternativa sería una grilla independiente del horario (siempre en
    // punto y media, por ejemplo), que desperdicia el arranque cuando el
    // recurso abre 9:15. Si algún día hace falta, es un parámetro de esta
    // función y no un rediseño.
    for (
      let inicio = franja.inicio.getTime();
      inicio + duracionMs <= franja.fin.getTime();
      inicio += duracionMs
    ) {
      // El filtro de A-5: descarta lo que empieza antes de `desde` SIN cambiar
      // dónde arranca la grilla. Un turno que empieza antes y termina después
      // de `desde` tampoco se ofrece: ya empezó.
      if (desde && inicio < desde.getTime()) {
        continue;
      }

      const turno: Intervalo = { inicio: new Date(inicio), fin: new Date(inicio + duracionMs) };

      // Google: cualquier superposición descarta el turno, sin importar la
      // capacidad. Un evento ajeno en el calendario del recurso significa que el
      // recurso no está, y eso no se comparte entre cupos.
      if (ocupadosEnGoogle.some((ocupado) => seSuperponen(turno, ocupado))) {
        continue;
      }

      // Reservas propias: acá sí manda la capacidad. Se cuentan las que se
      // superponen —no solo las que coinciden exacto— porque dos turnos que se
      // pisan parcialmente compiten por el mismo recurso.
      const tomados = reservasConfirmadas.filter((reserva) => seSuperponen(turno, reserva)).length;

      if (tomados >= capacidad) {
        continue;
      }

      turnos.push({ ...turno, lugaresDisponibles: capacidad - tomados });
    }
  }

  return turnos;
}

// ---------------------------------------------------------------------------
// La versión con base y con Google.
// ---------------------------------------------------------------------------
export async function obtenerDisponibilidad(
  organizationId: string,
  params: ParametrosDeDisponibilidad,
  cliente?: ClienteGoogleCalendar,
): Promise<TurnoDisponible[]> {
  const { franjasDeTrabajo, serviceType } = await resolverContexto(organizationId, params);

  // ---------------------------------------------------------------------------
  // GOOGLE ES OPCIONAL Y SU FALLA NO ROMPE LA DISPONIBILIDAD.
  //
  // Mismo criterio que §4 impone para las reservas, aplicado acá por coherencia:
  // una sucursal sin Google conectado —o con Google caído— tiene que poder
  // seguir mostrando su agenda. Lo que se pierde es la resta de los eventos
  // ajenos del calendario del negocio, y eso puede hacer que se ofrezca un
  // horario que en Google estaba ocupado.
  //
  // ESE RIESGO ES ACEPTADO Y NO ES SIMÉTRICO CON EL DE ROMPER: mostrar un turno
  // de más se resuelve cuando alguien intenta reservarlo o cuando el negocio lo
  // ve; devolver un 500 deja la agenda entera inutilizable. Queda registrado en
  // el log para que no sea invisible.
  // ---------------------------------------------------------------------------
  let ocupadosEnGoogle: Intervalo[] = [];

  try {
    const intervalos = await consultarDisponibilidad(
      organizationId,
      serviceType.branchId,
      { timeMin: params.desde.toISOString(), timeMax: params.hasta.toISOString() },
      cliente,
    );

    ocupadosEnGoogle = intervalos.map((intervalo) => ({
      inicio: new Date(intervalo.inicio),
      fin: new Date(intervalo.fin),
    }));
  } catch (err) {
    const esSinConexion =
      err instanceof AppError && (err.statusCode === 404 || err.statusCode === 409);

    if (!esSinConexion) {
      logger.warn(
        { err, organizationId, branchId: serviceType.branchId },
        "No se pudo consultar la disponibilidad en Google; se calcula solo con el horario de trabajo y las reservas locales",
      );
    }
  }

  const reservas = await findConfirmedBookingsInRange(
    organizationId,
    params.resourceId,
    params.desde,
    params.hasta,
  );

  return calcularTurnos({
    franjasDeTrabajo,
    ocupadosEnGoogle,
    reservasConfirmadas: reservas.map((r) => ({ inicio: r.startsAt, fin: r.endsAt })),
    duracionMin: serviceType.durationMin,
    capacidad: serviceType.capacity,
    // A-5: el `from` de la consulta filtra los turnos ya generados; no mueve el
    // borde de la franja (resolverContexto la expande entera).
    desde: params.desde,
  });
}

// ---------------------------------------------------------------------------
// Resolución del contexto — COMPARTIDA con POST /api/bookings.
//
// Que la validación del horario de trabajo se calcule UNA sola vez, acá, es un
// requisito y no una refactorización oportunista: si la disponibilidad y la
// reserva usaran dos códigos distintos para decidir "¿este horario está dentro
// del horario de trabajo?", podrían divergir — y esa divergencia se manifiesta
// como un cliente que reserva un turno que el sistema le ofreció y después le
// rechaza. Es el tipo de inconsistencia que nadie ve hasta que la sufre alguien
// de afuera.
// ---------------------------------------------------------------------------
export async function resolverContexto(
  organizationId: string,
  params: { resourceId: string; serviceTypeId: string; desde: Date; hasta: Date },
) {
  const serviceType = await getServiceTypeById(organizationId, params.serviceTypeId);

  const resource = await findResourceById(params.resourceId, organizationId);
  if (!resource) {
    throw new AppError("El recurso indicado no existe o no pertenece a tu organización", 400);
  }

  // EL SERVICIO TIENE QUE SER PROVISTO POR ESE RECURSO. Sin este chequeo se
  // podría pedir disponibilidad de "corte de pelo" contra la sala de masajes, y
  // el resultado sería un horario que después POST /api/bookings rechaza — o
  // peor, acepta.
  if (serviceType.resourceId !== resource.id) {
    throw new AppError("El servicio indicado no lo provee ese recurso", 400);
  }

  // La zona horaria sale de la SUCURSAL del recurso, nunca del servidor.
  const branch = await getBranchById(organizationId, resource.branchId);

  const franjas = await findWorkingHoursByResource(params.resourceId, organizationId);

  const franjasDeTrabajo = expandirFranjas({
    franjas,
    zona: branch.timezone,
    desde: params.desde,
    hasta: params.hasta,
  });

  return { serviceType, resource, branch, franjasDeTrabajo };
}

// Reexportada para que booking.service.ts use LA MISMA función de contención que
// la disponibilidad, y no una copia.
export { estaDentroDelHorario };
