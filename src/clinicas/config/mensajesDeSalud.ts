// ---------------------------------------------------------------------------
// Los mensajes fijos de los guardrails de salud (docs/rubros.md §5.3) y la
// tarea que dejan. El nombre de la clínica es la ÚNICA variable: ningún texto
// del paciente entra acá.
//
// D11 revisada (2026-10-12): el ADMIN de la clínica puede reemplazar los dos
// mensajes (ClinicSettings.urgencyMessageText y clinicalMessageText). Los de
// acá son el texto por defecto: el que se usa mientras la clínica no cargó el
// suyo, y el valor inicial de la pantalla. El contenido de un mensaje editado
// es responsabilidad de la clínica (docs/rubros.md §10).
//
// BORRADORES. El texto exacto y el número de emergencias los valida la
// clínica con un profesional antes del primer cliente (docs/rubros.md §10).
// ---------------------------------------------------------------------------

/** Los motivos de derivación de los guardrails. Son texto (el motivo de una
 *  derivación no es un enum de la base). */
export const MOTIVO_URGENCIA_DE_SALUD = "URGENCIA_DE_SALUD";
export const MOTIVO_CONSULTA_CLINICA = "CONSULTA_CLINICA";

/** La variable de un mensaje: el nombre de la clínica. */
export const VARIABLE_CLINICA = "{clinica}";

export const MENSAJE_DE_URGENCIA_POR_DEFECTO = `Si es una urgencia, llamá ya al 911 o a tu servicio de emergencia móvil. Este chat no puede ayudarte con eso. Ya le avisamos al equipo de ${VARIABLE_CLINICA}.`;

export const MENSAJE_DE_CONSULTA_CLINICA_POR_DEFECTO = `Esa consulta la tiene que ver un profesional. Por acá no podemos darte indicaciones médicas. Ya le pasamos tu mensaje al equipo de ${VARIABLE_CLINICA} para que te contacte.`;

/** El texto (el de la clínica o el por defecto) con el nombre de la clínica. */
export function componerMensajeDeSalud(plantilla: string, nombreDeLaClinica: string): string {
  return plantilla.split(VARIABLE_CLINICA).join(nombreDeLaClinica);
}

export function mensajeDeUrgencia(
  nombreDeLaClinica: string,
  textoDeLaClinica: string | null = null,
): string {
  return componerMensajeDeSalud(
    textoDeLaClinica ?? MENSAJE_DE_URGENCIA_POR_DEFECTO,
    nombreDeLaClinica,
  );
}

export function mensajeDeConsultaClinica(
  nombreDeLaClinica: string,
  textoDeLaClinica: string | null = null,
): string {
  return componerMensajeDeSalud(
    textoDeLaClinica ?? MENSAJE_DE_CONSULTA_CLINICA_POR_DEFECTO,
    nombreDeLaClinica,
  );
}

/** ¿El texto incluye un número de teléfono? Una secuencia de 3 a 15 dígitos,
 *  que puede tener espacios o guiones entre ellos (911, 105, 0800 1234,
 *  2487-1000). Es lo único que se puede verificar: que el número sea de
 *  emergencias es responsabilidad de la clínica. */
export function incluyeUnTelefono(texto: string): boolean {
  return /(?<!\d)\d(?:[ -]?\d){2,14}(?!\d)/.test(texto);
}

// La tarea de la derivación (docs/rubros.md §8.2): asunto y cuerpo FIJOS, sin
// resumen ni síntomas. Lo que el paciente escribió está en la conversación, y
// solo ahí. No son editables: no los ve el paciente.
export const CUERPO_DE_LA_TAREA_DE_URGENCIA =
  "Posible urgencia de salud: ver la conversación ya. El agente le pidió que llame a emergencias.";
export const CUERPO_DE_LA_TAREA_CLINICA = "Consulta clínica: ver la conversación.";
