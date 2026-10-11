import type { KnowledgeBaseEntryKind, Weekday } from "@prisma/client";

// ---------------------------------------------------------------------------
// Los datos de la Clínica Demo (docs/rubros.md §12.2, D14, R19). TODOS
// INVENTADOS: nombres de fantasía, emails @example.com, sin teléfonos, links a
// example.com. Nada de AutoMax ni de ningún cliente real (el repo es público).
// ---------------------------------------------------------------------------

/** El nombre de la organización. Con un sufijo opcional ("Clínica Demo
 *  Norte"), para poder tener más de una. */
export const NOMBRE_DE_LA_DEMO = "Clínica Demo";

/** El slug de una demo: `clinica-demo` o `clinica-demo-<sufijo>`. NO entra en
 *  PATRONES_DE_SLUG_DE_PRUEBA (§12.1): ninguna purga de organizaciones de test
 *  la toca. Rocco la borra a mano. */
export const SLUG_DE_LA_DEMO = "clinica-demo";

export function esSlugDeClinicaDemo(slug: string): boolean {
  return slug === SLUG_DE_LA_DEMO || slug.startsWith(`${SLUG_DE_LA_DEMO}-`);
}

export function nombreDeLaDemo(sufijo?: string): string {
  const limpio = sufijo?.trim();
  return limpio ? `${NOMBRE_DE_LA_DEMO} ${limpio}` : NOMBRE_DE_LA_DEMO;
}

export const ZONA_DE_LA_DEMO = "America/Montevideo";

export const NOMBRE_DE_LA_SEDE = "Sede Centro";

interface Franja {
  weekday: Weekday;
  startMinute: number;
  endMinute: number;
}

const h = (hora: number, minutos = 0) => hora * 60 + minutos;

const LUNES_A_VIERNES: Weekday[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];

function franjas(dias: Weekday[], desde: number, hasta: number): Franja[] {
  return dias.map((weekday) => ({ weekday, startMinute: desde, endMinute: hasta }));
}

/** Lunes a viernes de 9 a 19 y sábados de 9 a 13. */
export const HORARIO_DE_LA_SEDE: Franja[] = [
  ...franjas(LUNES_A_VIERNES, h(9), h(19)),
  ...franjas(["SATURDAY"], h(9), h(13)),
];

/** El recordatorio de la sede: los defaults de ClinicBranchSettings, escritos
 *  igual para que la demo no cambie si cambian los defaults. */
export const RECORDATORIO_DE_LA_SEDE = {
  reminderHoursBefore: 24,
  lateBookingReminder: "NO_ENVIAR",
} as const;

export type ClaveDeProfesional = "dra" | "martina" | "sofia";

export const PROFESIONALES: Record<ClaveDeProfesional, { nombre: string; horario: Franja[] }> = {
  // Dermatología.
  dra: { nombre: "Dra. Lucía Ejemplo", horario: franjas(LUNES_A_VIERNES, h(9), h(17)) },
  // Cosmetología.
  martina: {
    nombre: "Lic. Martina Prueba",
    horario: [...franjas(LUNES_A_VIERNES, h(9), h(19)), ...franjas(["SATURDAY"], h(9), h(13))],
  },
  sofia: {
    nombre: "Lic. Sofía Muestra",
    horario: [...franjas(LUNES_A_VIERNES, h(13), h(19)), ...franjas(["SATURDAY"], h(9), h(13))],
  },
};

export type ClaveDePrestacion = "consulta" | "limpieza" | "depilacion" | "peeling";

/** El primero de `profesionales` es el principal (ServiceType.resourceId). */
export const PRESTACIONES: Record<
  ClaveDePrestacion,
  {
    nombre: string;
    duracionMin: number;
    controlALosDias: number | null;
    profesionales: ClaveDeProfesional[];
  }
> = {
  consulta: {
    nombre: "Consulta dermatológica",
    duracionMin: 30,
    controlALosDias: 180,
    profesionales: ["dra"],
  },
  limpieza: {
    nombre: "Limpieza facial",
    duracionMin: 60,
    controlALosDias: 30,
    profesionales: ["martina", "sofia"],
  },
  depilacion: {
    nombre: "Depilación láser",
    duracionMin: 45,
    controlALosDias: 30,
    profesionales: ["sofia"],
  },
  peeling: {
    nombre: "Peeling químico",
    duracionMin: 45,
    controlALosDias: null,
    profesionales: ["dra"],
  },
};

/** "La Dra. Ejemplo no atiende el próximo viernes a la tarde": el viernes de
 *  la semana de los turnos, de 13 a 19. */
export const BLOQUEO = {
  profesional: "dra" as ClaveDeProfesional,
  desde: h(13),
  hasta: h(19),
  motivo: "Congreso (dato de ejemplo)",
};

export const AVISO_DE_EJEMPLO = "Texto de ejemplo de la Clínica Demo.";

export const BASE_DE_CONOCIMIENTO: {
  titulo: string;
  contenido: string;
  kind?: KnowledgeBaseEntryKind;
}[] = [
  {
    titulo: "Horarios",
    contenido:
      "Atendemos de lunes a viernes de 9 a 19 y los sábados de 9 a 13. Los domingos y feriados está cerrado.",
  },
  {
    titulo: "Cómo llegar",
    contenido: `Estamos en Calle Ejemplo 1234, en el centro. Hay estacionamiento en la cuadra. ${AVISO_DE_EJEMPLO}`,
  },
  {
    titulo: "Precios de ejemplo",
    contenido:
      "Consulta dermatológica: $ 2.000. Limpieza facial: $ 1.800. Depilación láser: desde $ 1.500 por zona. " +
      `Peeling químico: $ 2.500. Son precios de ejemplo, no los de ninguna clínica real. ${AVISO_DE_EJEMPLO}`,
  },
  {
    titulo: "Medios de pago",
    contenido:
      "Aceptamos efectivo, tarjetas de débito y crédito y transferencia bancaria. Se paga al terminar el turno.",
  },
  {
    titulo: "Coberturas",
    contenido: "No trabajamos con mutualistas. Todas las prestaciones son particulares.",
  },
  {
    titulo: "Política de cancelación",
    contenido:
      "Si no podés venir, avisanos con al menos 24 horas de anticipación para darle el turno a otra persona.",
  },
  {
    titulo: "Indicaciones antes de la depilación láser",
    contenido:
      "Texto de ejemplo. Los días previos, evitá el sol directo en la zona y no uses cera ni pinzas: " +
      "afeitate el día anterior. Vení sin cremas ni desodorante en la zona a tratar. " +
      "Si tenés dudas sobre tu caso, consultalo con la profesional en el turno.",
    kind: "INDICACIONES",
  },
];

/** Ocho pacientes con nombres de fantasía, emails @example.com y SIN
 *  teléfono (§12.2): la demo no puede mandarle nada a nadie. */
export const PACIENTES: { nombre: string; apellido: string; email: string }[] = [
  { nombre: "Valentina", apellido: "Ficticia", email: "valentina.ficticia@example.com" },
  { nombre: "Camila", apellido: "Inventada", email: "camila.inventada@example.com" },
  { nombre: "Florencia", apellido: "Supuesta", email: "florencia.supuesta@example.com" },
  { nombre: "Lucas", apellido: "Imaginario", email: "lucas.imaginario@example.com" },
  { nombre: "Agustina", apellido: "Modelo", email: "agustina.modelo@example.com" },
  { nombre: "Mateo", apellido: "Simulado", email: "mateo.simulado@example.com" },
  { nombre: "Julieta", apellido: "Ensayo", email: "julieta.ensayo@example.com" },
  { nombre: "Sofía", apellido: "Borrador", email: "sofia.borrador@example.com" },
];

export interface TurnoDeLaDemo {
  /** 0 = lunes de la semana de los turnos. */
  dia: number;
  hora: number;
  minutos?: number;
  paciente: number;
  prestacion: ClaveDePrestacion;
  profesional: ClaveDeProfesional;
  /** Con patientConfirmedAt (el paciente ya confirmó). */
  confirmado?: true;
  /** Sobreturno: va DESPUÉS del turno que llena ese horario. */
  sobreturno?: true;
}

/** Quince turnos en la semana siguiente (lunes a sábado), en la grilla de cada
 *  prestación y dentro del horario de cada profesional. Ninguno de la Dra. el
 *  viernes a la tarde (el bloqueo). */
export const TURNOS_PROXIMOS: TurnoDeLaDemo[] = [
  { dia: 0, hora: 9, paciente: 0, prestacion: "consulta", profesional: "dra", confirmado: true },
  { dia: 0, hora: 10, paciente: 1, prestacion: "limpieza", profesional: "martina" },
  { dia: 0, hora: 13, paciente: 2, prestacion: "depilacion", profesional: "sofia" },
  {
    dia: 1,
    hora: 10,
    minutos: 30,
    paciente: 3,
    prestacion: "consulta",
    profesional: "dra",
    confirmado: true,
  },
  { dia: 1, hora: 15, paciente: 4, prestacion: "peeling", profesional: "dra" },
  { dia: 1, hora: 14, paciente: 5, prestacion: "limpieza", profesional: "sofia" },
  { dia: 2, hora: 9, minutos: 30, paciente: 7, prestacion: "consulta", profesional: "dra" },
  { dia: 2, hora: 15, minutos: 15, paciente: 6, prestacion: "depilacion", profesional: "sofia" },
  {
    dia: 3,
    hora: 11,
    paciente: 1,
    prestacion: "consulta",
    profesional: "dra",
    confirmado: true,
  },
  { dia: 3, hora: 13, minutos: 30, paciente: 2, prestacion: "peeling", profesional: "dra" },
  { dia: 3, hora: 16, paciente: 3, prestacion: "limpieza", profesional: "martina" },
  { dia: 4, hora: 9, paciente: 4, prestacion: "consulta", profesional: "dra" },
  { dia: 4, hora: 9, paciente: 5, prestacion: "consulta", profesional: "dra", sobreturno: true },
  { dia: 4, hora: 10, paciente: 6, prestacion: "limpieza", profesional: "martina" },
  { dia: 5, hora: 10, paciente: 7, prestacion: "limpieza", profesional: "martina" },
];

/** Tres turnos atendidos la semana anterior (0 = lunes de esa semana). Se
 *  escriben con Prisma directo: los services rechazan un turno pasado. */
export const TURNOS_ATENDIDOS: TurnoDeLaDemo[] = [
  { dia: 0, hora: 10, paciente: 0, prestacion: "consulta", profesional: "dra" },
  { dia: 1, hora: 11, paciente: 1, prestacion: "limpieza", profesional: "martina" },
  { dia: 3, hora: 14, minutos: 30, paciente: 5, prestacion: "depilacion", profesional: "sofia" },
];

export const AVISO_DE_PRIVACIDAD = {
  privacyNoticeText:
    "Texto de ejemplo: guardamos tus datos de contacto y tus turnos solo para atenderte. " +
    "Podés pedir verlos, corregirlos o borrarlos cuando quieras.",
  privacyPolicyUrl: "https://example.com/privacidad",
};

export const AGENTE = {
  name: "Recepción virtual",
  goal: "Responder consultas y agendar turnos de la Clínica Demo.",
  instructions:
    "Instrucciones de ejemplo. Sos la recepción virtual de la clínica. Respondé con la base de " +
    "conocimiento (horarios, precios, medios de pago, cómo llegar) y ofrecé turnos de las prestaciones. " +
    "No des indicaciones médicas: ante cualquier consulta de salud, derivá a una persona del equipo.",
  tone: "Cordial y breve",
  enabledTools: [
    "get_service_types",
    "get_availability",
    "create_booking",
    "get_contact_bookings",
    "reschedule_booking",
    "cancel_booking",
  ],
};

export const QR_DE_RESENA = {
  name: "Reseñas (ejemplo)",
  destinationUrl: "https://example.com/resenas",
};

export const NOMBRE_DE_LAS_REGLAS = {
  recordatorio: "Recordatorio antes del turno",
  qr: "QR de reseña al atender",
  control: "Recordatorio de control",
};

/** La demora del QR: el mínimo de una clínica (§7.1, 3 h). */
export const DEMORA_DEL_QR_MIN = 180;
