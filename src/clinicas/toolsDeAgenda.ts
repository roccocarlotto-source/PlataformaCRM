import { countFutureConfirmedBookingsOfContact } from "../repositories/booking.repository";
import { findManyServiceTypes, findServiceTypeById } from "../repositories/serviceType.repository";
import {
  MAX_RESERVAS_FUTURAS_POR_CONTACTO,
  MAX_TIPOS_DE_SERVICIO,
  MENSAJE_TOPE_DE_RESERVAS,
  bloqueoPorIdentidad,
  conErroresDeNegocio,
  createBookingArgs,
  exito,
  exitoVacio,
  fallo,
  getAvailabilityArgs,
  resolverServicio,
  sinParametros,
  validarArgs,
  zonaDeLaSucursal,
  type ContextoDeEjecucionDeTool,
  type ResultadoDeTool,
  type ToolDelAgente,
} from "../services/agentTools.service";
import { relojDeReservas } from "../services/booking.service";
import { isoEnZona } from "../utils/timezone";
import { profesionalesDeLasPrestaciones } from "./repositories/serviceTypeResource.repository";
import {
  MENSAJE_PROFESIONAL_NO_ATIENDE,
  crearTurnoDeClinica,
  disponibilidadDeLaPrestacion,
} from "./services/agendaClinica.service";

// ---------------------------------------------------------------------------
// Las tools de agenda del agente de una CLÍNICA (docs/rubros.md §4.3 y §5.1,
// R5): las mismas tres que la de una automotora, con el MISMO nombre y los
// mismos argumentos, pero con profesionales. Reemplazan a las del catálogo
// solo en CLINICA (reglasDeClinica.ts → toolsPropias); el agente de una
// automotora sigue con las de agentTools.service.ts, sin cambios.
//
//   - get_service_types: cada prestación con sus profesionales (id, name).
//   - get_availability: sin resourceId, los turnos de TODOS los profesionales
//     de la prestación, cada uno con su profesional; con resourceId, los de
//     ese profesional (el que eligió el paciente).
//   - create_booking: con resourceId, con ese profesional; sin él, el primero
//     libre (el de menos turnos ese día).
//
// Mismas reglas que las de siempre: identidad (bloqueoPorIdentidad), tope de
// reservas futuras, el contacto de la conversación y la sucursal del agente.
// Sin oportunidad: una clínica no tiene oportunidades (§2.1).
// ---------------------------------------------------------------------------

export const MENSAJE_PRESTACION_DE_OTRA_SEDE =
  "Esa prestación es de otra sede: solo podés agendar en la sede de esta conversación.";

async function prestacionDeLaSede(
  args: { serviceTypeId?: string; servicio?: string },
  contexto: ContextoDeEjecucionDeTool,
): Promise<{ ok: true; serviceTypeId: string } | { ok: false; resultado: ResultadoDeTool }> {
  const servicio = await resolverServicio(args, contexto);
  if (!servicio.ok) return servicio;
  const prestacion = await findServiceTypeById(servicio.serviceTypeId, contexto.organizationId);
  if (!prestacion) {
    return {
      ok: false,
      resultado: fallo(
        "La prestación indicada no existe. Usá el nombre tal cual figura en la lista de prestaciones.",
      ),
    };
  }
  if (prestacion.branchId !== contexto.conversation.branchId) {
    return { ok: false, resultado: fallo(MENSAJE_PRESTACION_DE_OTRA_SEDE) };
  }
  return servicio;
}

const getServiceTypesDeClinica: ToolDelAgente = {
  definition: {
    name: "get_service_types",
    description:
      "Lista las prestaciones de esta sede, con su duración y los profesionales que atienden cada una (id y nombre). Usala antes de consultar la disponibilidad para saber qué prestaciones existen y quién las hace. Si el paciente pide un profesional en particular, su id sale de acá.",
    parameters: sinParametros,
  },

  async ejecutar(_args, contexto) {
    const prestaciones = await findManyServiceTypes(
      contexto.organizationId,
      { branchId: contexto.conversation.branchId },
      { skip: 0, take: MAX_TIPOS_DE_SERVICIO },
      { sortBy: "name", sortOrder: "asc" },
    );
    if (prestaciones.length === 0) {
      return exitoVacio(
        { serviceTypes: [] },
        "Esta sede NO tiene ninguna prestación configurada. NO le ofrezcas al paciente ningún turno ni prestación: no existe ninguna cargada. Decile que por este medio todavía no podés agendar y ofrecé que lo coordine alguien del equipo.",
      );
    }
    const profesionales = await profesionalesDeLasPrestaciones(
      contexto.organizationId,
      prestaciones,
    );
    return exito({
      proximosPasos:
        "Estas son las ÚNICAS prestaciones que existen: no ofrezcas ninguna que no esté acá. Para consultar disponibilidad y para reservar, referite a la prestación por su NOMBRE tal cual figura acá (campo `servicio`). Si el paciente quiere un profesional en particular, mandá su id como resourceId; si le da lo mismo, no lo mandes y se le ofrecen todos. NO le digas que el turno quedó agendado hasta que la reserva te devuelva un resultado exitoso.",
      serviceTypes: prestaciones.map((p) => ({
        id: p.id,
        name: p.name,
        durationMin: p.durationMin,
        profesionales: (profesionales.get(p.id) ?? []).map((r) => ({ id: r.id, name: r.name })),
      })),
    });
  },
};

const getAvailabilityDeClinica: ToolDelAgente = {
  definition: {
    name: "get_availability",
    description:
      "Consulta los turnos disponibles de una prestación. Devuelve los horarios libres, cada uno con el profesional que lo atiende. Sin resourceId, se miran TODOS los profesionales de la prestación; con resourceId, solo ese (el que pidió el paciente). Alcanza con el nombre de la prestación y el desde; sin hasta, se miran las 24 horas siguientes. Usala antes de reservar, y también cuando el paciente pregunta cuándo puede ir: no le pidas que proponga él un día antes de mirar la agenda.",
    parameters: {
      type: "object",
      properties: {
        resourceId: {
          type: "string",
          description:
            "Id del profesional, solo si el paciente pidió uno en particular. Sale de la lista de prestaciones. Si le da lo mismo, no lo mandes.",
        },
        servicio: {
          type: "string",
          description:
            "Nombre de la prestación, tal cual aparece en la lista de prestaciones. Es la forma preferida.",
        },
        serviceTypeId: {
          type: "string",
          description:
            "Id de la prestación. Alternativa a `servicio`, solo si lo tenés copiado EXACTO de la lista.",
        },
        desde: { type: "string", description: "Inicio del rango, ISO 8601 con zona." },
        hasta: {
          type: "string",
          description:
            "Fin del rango, ISO 8601 con zona. OPCIONAL: sin él se consultan las 24 horas siguientes a desde.",
        },
      },
      required: ["desde"],
      additionalProperties: false,
    },
  },

  ejecutar(args, contexto) {
    const validacion = validarArgs(getAvailabilityArgs, args);
    if (!validacion.ok) {
      return Promise.resolve(validacion.resultado);
    }
    const params = validacion.value;

    return conErroresDeNegocio(async () => {
      const prestacion = await prestacionDeLaSede(params, contexto);
      if (!prestacion.ok) return prestacion.resultado;

      const turnos = await disponibilidadDeLaPrestacion(contexto.organizationId, {
        serviceTypeId: prestacion.serviceTypeId,
        ...(params.resourceId !== undefined ? { resourceId: params.resourceId } : {}),
        desde: params.desde,
        hasta: params.hasta,
      });
      const zona = await zonaDeLaSucursal(contexto);
      return exito({
        zonaHoraria: zona,
        turnos: turnos.map((t) => ({
          inicio: isoEnZona(t.inicio, zona),
          fin: isoEnZona(t.fin, zona),
          profesional: t.profesional,
        })),
      });
    });
  },
};

const createBookingDeClinica: ToolDelAgente = {
  definition: {
    name: "create_booking",
    description:
      "Reserva de verdad un turno para el paciente de esta conversación: hasta que esta tool no devuelva un resultado exitoso, el turno NO existe y no se lo podés confirmar. Reservá en el mismo turno en que el paciente acepta un horario, sin volver a pedirle que confirme. Si el paciente eligió un profesional, mandá su id como resourceId; si le da lo mismo, no lo mandes y se asigna el primero libre en ese horario. El horario tiene que ser uno de los que devolvió la consulta de disponibilidad.",
    parameters: {
      type: "object",
      properties: {
        resourceId: {
          type: "string",
          description:
            "Id del profesional que eligió el paciente. Sin él, el primero libre en ese horario.",
        },
        servicio: {
          type: "string",
          description: "Nombre de la prestación, tal cual aparece en la lista de prestaciones.",
        },
        serviceTypeId: {
          type: "string",
          description: "Id de la prestación. Alternativa a `servicio`.",
        },
        startsAt: { type: "string", description: "Inicio del turno, ISO 8601 con zona." },
      },
      required: ["startsAt"],
      additionalProperties: false,
    },
  },

  ejecutar(args, contexto) {
    const validacion = validarArgs(createBookingArgs, args);
    if (!validacion.ok) {
      return Promise.resolve(validacion.resultado);
    }
    const input = validacion.value;

    return conErroresDeNegocio(async () => {
      const bloqueo = await bloqueoPorIdentidad(contexto);
      if (bloqueo) return bloqueo;
      const futuras = await countFutureConfirmedBookingsOfContact(
        contexto.conversation.contactId,
        contexto.organizationId,
        relojDeReservas.ahora(),
      );
      if (futuras >= MAX_RESERVAS_FUTURAS_POR_CONTACTO) {
        return fallo(MENSAJE_TOPE_DE_RESERVAS);
      }
      const prestacion = await prestacionDeLaSede(input, contexto);
      if (!prestacion.ok) return prestacion.resultado;

      const booking = await crearTurnoDeClinica(contexto.organizationId, {
        serviceTypeId: prestacion.serviceTypeId,
        contactId: contexto.conversation.contactId,
        startsAt: input.startsAt,
        ...(input.resourceId !== undefined ? { resourceId: input.resourceId } : {}),
      });
      const zona = await zonaDeLaSucursal(contexto);
      return exito({
        bookingId: booking.id,
        zonaHoraria: zona,
        startsAt: isoEnZona(booking.startsAt, zona),
        endsAt: isoEnZona(booking.endsAt, zona),
        status: booking.status,
        profesionalId: booking.resourceId,
      });
    });
  },
};

/** Las tools de agenda de una clínica, por nombre: reemplazan a las del
 *  catálogo con el mismo nombre. */
export const TOOLS_DE_AGENDA_DE_CLINICA: Readonly<Record<string, ToolDelAgente>> = {
  get_service_types: getServiceTypesDeClinica,
  get_availability: getAvailabilityDeClinica,
  create_booking: createBookingDeClinica,
};

// Exportado para el test: el mensaje cuando el paciente pide un profesional
// que no atiende esa prestación lo arma el service.
export { MENSAJE_PROFESIONAL_NO_ATIENDE };
