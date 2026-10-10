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
}

export interface PrestacionesResponse {
  prestaciones: PrestacionConProfesionales[];
}

export interface ProfesionalesResponse {
  profesionales: Profesional[];
}
