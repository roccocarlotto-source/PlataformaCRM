// ---------------------------------------------------------------------------
// Los mensajes fijos de los guardrails de salud (docs/rubros.md §5.3) y la
// tarea que dejan. El nombre de la clínica es la ÚNICA variable: ningún texto
// del paciente entra acá.
//
// BORRADORES. El texto exacto y el número de emergencias los valida la
// clínica con un profesional antes del primer cliente (docs/rubros.md §10).
// ---------------------------------------------------------------------------

/** Los motivos de derivación de los guardrails. Son texto (el motivo de una
 *  derivación no es un enum de la base). */
export const MOTIVO_URGENCIA_DE_SALUD = "URGENCIA_DE_SALUD";
export const MOTIVO_CONSULTA_CLINICA = "CONSULTA_CLINICA";

export function mensajeDeUrgencia(nombreDeLaClinica: string): string {
  return `Si es una urgencia, llamá ya al 911 o a tu servicio de emergencia móvil. Este chat no puede ayudarte con eso. Ya le avisamos al equipo de ${nombreDeLaClinica}.`;
}

export function mensajeDeConsultaClinica(nombreDeLaClinica: string): string {
  return `Esa consulta la tiene que ver un profesional. Por acá no podemos darte indicaciones médicas. Ya le pasamos tu mensaje al equipo de ${nombreDeLaClinica} para que te contacte.`;
}

// La tarea de la derivación (docs/rubros.md §8.2): asunto y cuerpo FIJOS, sin
// resumen ni síntomas. Lo que el paciente escribió está en la conversación, y
// solo ahí.
export const CUERPO_DE_LA_TAREA_DE_URGENCIA =
  "Posible urgencia de salud: ver la conversación ya. El agente le pidió que llame a emergencias.";
export const CUERPO_DE_LA_TAREA_CLINICA = "Consulta clínica: ver la conversación.";
