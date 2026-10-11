import type { ToolCallDelTurno } from "../services/agentOrchestration.service";
import type {
  ContextoDeLaRegla,
  DecisionDelRubro,
  DesenlaceDeLasTools,
  ReglasDelRubro,
} from "../services/reglasDelRubro";
import { afirmacionesSinRespaldo } from "./afirmacionesDeTurnos";
import {
  CUERPO_DE_LA_TAREA_CLINICA,
  CUERPO_DE_LA_TAREA_DE_URGENCIA,
  MOTIVO_CONSULTA_CLINICA,
  MOTIVO_URGENCIA_DE_SALUD,
  mensajeDeConsultaClinica,
  mensajeDeUrgencia,
} from "./config/mensajesDeSalud";
import {
  INSTRUCCION_SALUD,
  clasificarMensajeDeSalud,
  daIndicacionClinica,
} from "./guardrailsDeSalud";
import { TOOLS_DE_AGENDA_DE_CLINICA } from "./toolsDeAgenda";
import { TOOLS_DE_TURNOS_DE_CLINICA } from "./toolsDeTurnos";
import { TERMINO_DEL_CONTACTO } from "./config/rubro";
import {
  CUERPO_DE_LA_TAREA_FUERA_DE_PLAZO,
  CUERPO_DE_LA_TAREA_SIN_AUTOR,
  INSTRUCCION_DE_FECHAS_DE_CLINICA,
  INSTRUCCION_DE_TONO_DE_CLINICA,
  MENSAJE_AFIRMACION_SIN_ACCION,
  MOTIVO_CAMBIO_FUERA_DE_PLAZO,
  MOTIVO_CAMBIO_SIN_AUTOR,
  mensajeDeCambioFueraDePlazo,
  mensajeDeCambioSinAutor,
  sinDeEjemplo,
  textosDeClinica,
} from "./config/textosDelAgente";
import {
  REGLA_INDICACIONES_TEXTUALES,
  textoDeLasIndicaciones,
  toolsDeIndicaciones,
} from "./toolDeIndicaciones";
import { CODIGO_FUERA_DE_PLAZO, CODIGO_SIN_AUTOR } from "./toolsDeTurnos";
import { leerConfiguracionDeClinica } from "./repositories/clinicSettings.repository";

// ---------------------------------------------------------------------------
// Las reglas del rubro CLINICA para el loop del agente (docs/rubros.md §5.3 y
// §8.2), enchufadas en los puntos de extensión de
// src/services/reglasDelRubro.ts. NINGUNA es configurable por el ADMIN.
// ---------------------------------------------------------------------------

function urgencia(contexto: ContextoDeLaRegla): DecisionDelRubro {
  return {
    regla: "urgencia_de_salud",
    motivo: MOTIVO_URGENCIA_DE_SALUD,
    mensaje: mensajeDeUrgencia(contexto.nombreDeLaOrganizacion),
    aviso: { cuerpo: CUERPO_DE_LA_TAREA_DE_URGENCIA, urgente: true },
  };
}

function consultaClinica(regla: string, contexto: ContextoDeLaRegla): DecisionDelRubro {
  return {
    regla,
    motivo: MOTIVO_CONSULTA_CLINICA,
    mensaje: mensajeDeConsultaClinica(contexto.nombreDeLaOrganizacion),
    aviso: { cuerpo: CUERPO_DE_LA_TAREA_CLINICA, urgente: false },
  };
}

// Los rechazos de las tools de turnos que derivan desde el código, por su
// `codigo` (toolsDeTurnos.ts, docs/rubros.md §5.1). Sin aviso urgente.
const DERIVACION_POR_CODIGO: Readonly<
  Record<string, (contexto: ContextoDeLaRegla) => DecisionDelRubro>
> = {
  [CODIGO_FUERA_DE_PLAZO]: (contexto) => ({
    regla: "cambio_de_turno_fuera_de_plazo",
    motivo: MOTIVO_CAMBIO_FUERA_DE_PLAZO,
    mensaje: mensajeDeCambioFueraDePlazo(contexto.nombreDeLaOrganizacion),
    aviso: { cuerpo: CUERPO_DE_LA_TAREA_FUERA_DE_PLAZO, urgente: false },
  }),
  [CODIGO_SIN_AUTOR]: (contexto) => ({
    regla: "cambio_de_turno_sin_autor",
    motivo: MOTIVO_CAMBIO_SIN_AUTOR,
    mensaje: mensajeDeCambioSinAutor(contexto.nombreDeLaOrganizacion),
    aviso: { cuerpo: CUERPO_DE_LA_TAREA_SIN_AUTOR, urgente: false },
  }),
};

/** Después de una ronda de tools: primero una derivación por un rechazo con
 *  código (gana sobre todo lo demás de la ronda), después las indicaciones
 *  tal cual (toolDeIndicaciones.ts). Pura. */
export function desenlaceDeClinica(
  entradas: readonly ToolCallDelTurno[],
  contexto: ContextoDeLaRegla,
): DesenlaceDeLasTools | null {
  for (const entrada of entradas) {
    const resultado = entrada.result;
    if (resultado?.ok === false && resultado.codigo !== undefined) {
      const decidir = Object.hasOwn(DERIVACION_POR_CODIGO, resultado.codigo)
        ? DERIVACION_POR_CODIGO[resultado.codigo]
        : undefined;
      if (decidir) return { tipo: "derivar", decision: decidir(contexto) };
    }
  }
  const indicaciones = textoDeLasIndicaciones(entradas);
  return indicaciones === null
    ? null
    : { tipo: "textual", regla: REGLA_INDICACIONES_TEXTUALES, mensaje: indicaciones };
}

export const REGLAS_DE_CLINICA: ReglasDelRubro = {
  // Capa 1, urgencia: gana sobre una persona atendiendo, sobre el silencio y
  // sobre el agente apagado.
  entradaPrioritaria: [
    (textos, contexto) =>
      textos.some((texto) => clasificarMensajeDeSalud(texto) === "URGENCIA")
        ? urgencia(contexto)
        : null,
  ],
  // Capa 1, consulta clínica.
  entrada: [
    (textos, contexto) =>
      textos.some((texto) => clasificarMensajeDeSalud(texto) === "CLINICA")
        ? consultaClinica("consulta_clinica", contexto)
        : null,
  ],
  // Capa 3, la respuesta del modelo.
  salida: [
    (respuesta, contexto) =>
      daIndicacionClinica(respuesta)
        ? consultaClinica("indicacion_clinica_saliente", contexto)
        : null,
  ],
  // No afirmar un turno agendado, movido o cancelado que la tool no hizo en
  // este turno (afirmacionesDeTurnos.ts): va un mensaje fijo, sin derivar.
  correccionesDeSalida: [
    (respuesta, toolsDelTurno) =>
      afirmacionesSinRespaldo(respuesta, toolsDelTurno).length > 0
        ? { regla: "afirmacion_de_turno_sin_accion", mensaje: MENSAJE_AFIRMACION_SIN_ACCION }
        : null,
  ],
  // Nunca "de ejemplo" (prueba de la Clínica Demo).
  retoquesDeSalida: [sinDeEjemplo],
  // Derivar por un rechazo de las tools de turnos, o mandar las indicaciones
  // tal cual.
  desenlaceDeLasTools: desenlaceDeClinica,
  // §5.4: mandar una indicación tal cual (solo si la sede tiene alguna).
  toolsDelSistema: toolsDeIndicaciones,
  callaDespuesDeDerivar: true,
  // Capa 2, más el tono y las fechas de una clínica.
  instruccionesDelPrompt: [
    INSTRUCCION_SALUD,
    INSTRUCCION_DE_TONO_DE_CLINICA,
    INSTRUCCION_DE_FECHAS_DE_CLINICA,
  ],
  // §8.2: sin texto libre del agente sobre el paciente.
  camposFueraDeLasTools: {
    create_lead: ["notes", "aiData"],
    update_lead: ["notes", "aiData"],
  },
  // §4.3 y §5.1 (R5): la agenda con profesionales.
  toolsPropias: TOOLS_DE_AGENDA_DE_CLINICA,
  // §5.1 (R11): ver, reprogramar y cancelar los turnos del paciente.
  toolsExclusivas: TOOLS_DE_TURNOS_DE_CLINICA,
  // §3.2 (R11): sin autos, con el término del contacto de la organización.
  async textosDelPrompt(organizationId, conGestionDeTurnos) {
    const { contactTerm } = await leerConfiguracionDeClinica(organizationId);
    return textosDeClinica(TERMINO_DEL_CONTACTO[contactTerm], conGestionDeTurnos);
  },
};
