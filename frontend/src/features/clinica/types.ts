// Contrato de la agenda de clínica (src/clinicas/controllers/
// agendaClinica.controller.ts, docs/rubros.md §4.3, R5).

export interface Profesional {
  id: string;
  name: string;
  branchId: string;
}

// GET /api/clinica/prestaciones
export interface PrestacionConProfesionales {
  id: string;
  branchId: string;
  name: string;
  durationMin: number;
  capacity: number;
  // El profesional principal (ServiceType.resourceId): está siempre en
  // `profesionales` y no se puede sacar desde esta pantalla.
  resourceId: string;
  profesionales: Profesional[];
  // R14: "Recordar control a los N días" (null = sin control).
  followUpAfterDays: number | null;
}

export interface PrestacionesResponse {
  prestaciones: PrestacionConProfesionales[];
}

export interface ProfesionalesResponse {
  profesionales: Profesional[];
}

// R11: la configuración de clínica de una sede (GET/PUT /clinica/sedes/:id/configuracion).
export type PoliticaDeTurnoTardio = "NO_ENVIAR" | "EN_EL_MOMENTO" | "HORAS_ANTES";

export interface ConfiguracionDeSede {
  // null = sin plazo (docs/rubros.md D10: sin valor por defecto).
  minHoursToChangeBooking: number | null;
  // R13 (§6.2): el recordatorio.
  reminderHoursBefore: number;
  lateBookingReminder: PoliticaDeTurnoTardio;
  lateBookingHoursBefore: number;
}

// Lo que manda un PUT: solo lo que cambia.
export type CambiosDeConfiguracionDeSede = Partial<ConfiguracionDeSede>;
