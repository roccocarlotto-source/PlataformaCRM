import type { OrganizationIndustry } from "@prisma/client";

// ---------------------------------------------------------------------------
// Las columnas aditivas que solo usan las clínicas (docs/rubros.md §1.3, §13)
// no salen en las respuestas de una automotora: para ella la fila tiene las
// claves de antes y su respuesta no cambia (lo fija
// src/clinicas/automotoraSinCambios.integration-test.ts). En una clínica la
// fila sale entera.
//
// Un solo lugar para la lista de columnas por modelo: cada PR del plan que suma
// una columna de clínica a un modelo compartido la agrega acá.
// ---------------------------------------------------------------------------

export const CAMPOS_DE_CLINICA = {
  // R20: la sede de la tarea.
  // §7.3: el turno y la regla de la tarea después del turno.
  activity: ["branchId", "sourceBookingId", "sourceAutomationId"],
  // R6: sobreturnos del profesional. R8: su calendario de Google.
  resource: ["allowsOverbooking", "maxOverbookingsPerDay", "googleCalendarId"],
  // R6: el turno es un sobreturno. R8: el calendario del profesional donde
  // quedó el evento.
  booking: [
    "isOverbooking",
    "googleCalendarId",
    "completedAt",
    "completedBy",
    // R13: el paciente confirmó por el recordatorio.
    "patientConfirmedAt",
  ],
  // R18: indicaciones de la base de conocimiento.
  knowledgeBaseEntry: ["kind"],
  // R16: cuándo se le mandó el aviso de privacidad de la clínica.
  contact: ["privacyNoticeSentAt"],
  // R14: "Recordar control a los N días".
  serviceType: ["followUpAfterDays"],
} as const;

export function sinCamposDeClinica<T extends object>(
  fila: T,
  industry: OrganizationIndustry,
  campos: readonly string[],
): T {
  if (industry === "CLINICA") return fila;
  const copia = { ...fila } as Record<string, unknown>;
  for (const campo of campos) delete copia[campo];
  return copia as T;
}
