import type { PlatformOrganization } from "./types";

// ---------------------------------------------------------------------------
// Qué organización es una Clínica Demo (docs/rubros.md §12): rubro clínica y
// slug `clinica-demo` o `clinica-demo-<sufijo>`. Es la misma regla que
// esSlugDeClinicaDemo del backend (src/clinicas/demo/config.ts), que es quien
// decide: acá solo sirve para mostrar "Reiniciar datos de demo" en las filas
// que corresponde. Si las dos no coincidieran, el backend responde 400.
// ---------------------------------------------------------------------------

export const SLUG_DE_LA_DEMO = "clinica-demo";

export function esClinicaDemo(org: Pick<PlatformOrganization, "slug" | "industry">): boolean {
  return (
    org.industry === "CLINICA" &&
    (org.slug === SLUG_DE_LA_DEMO || org.slug.startsWith(`${SLUG_DE_LA_DEMO}-`))
  );
}

/** Qué borra y qué deja el reinicio: el texto de la confirmación. */
export const CONFIRMACION_DEL_REINICIO =
  "Se borran para siempre los pacientes, los turnos, las conversaciones con sus mensajes, las tareas, los recordatorios y mensajes programados de los turnos y los bloqueos de los profesionales. " +
  "Queda la configuración: sedes y horarios, profesionales, prestaciones, base de conocimiento, agentes, automatizaciones, QR, usuarios e invitaciones. " +
  "Después se vuelven a cargar los pacientes y los turnos de ejemplo, desde mañana.";
