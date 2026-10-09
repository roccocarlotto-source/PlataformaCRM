import type {
  ContextoDeLaRegla,
  DecisionDelRubro,
  ReglasDelRubro,
} from "../services/reglasDelRubro";
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
  callaDespuesDeDerivar: true,
  // Capa 2.
  instruccionesDelPrompt: [INSTRUCCION_SALUD],
  // §8.2: sin texto libre del agente sobre el paciente.
  camposFueraDeLasTools: {
    create_lead: ["notes", "aiData"],
    update_lead: ["notes", "aiData"],
  },
};
