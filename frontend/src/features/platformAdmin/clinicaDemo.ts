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

/** Qué filas muestran "Reiniciar datos de demo": las organizaciones en modo
 *  demo (isDemo, docs/taller-demo.md). Una Clínica Demo por su slug también,
 *  para un backend anterior que todavía no manda isDemo. El backend decide:
 *  si no es una demo, 400. */
export function esDemo(org: Pick<PlatformOrganization, "slug" | "industry" | "isDemo">): boolean {
  return org.isDemo === true || esClinicaDemo(org);
}

/** Qué borra y qué deja el reinicio del Taller Demo: el texto de la
 *  confirmación. */
export const CONFIRMACION_DEL_REINICIO_DEL_TALLER =
  "Se borran para siempre los contactos, las conversaciones con sus mensajes, las oportunidades, el stock con sus fotos, los vehículos de clientes, las órdenes de taller, las tareas y los turnos. " +
  "Queda la configuración: sucursales y horarios, proceso de venta, tipos de service, campos personalizados, base de conocimiento, agentes, automatizaciones, QR, usuarios e invitaciones. " +
  "Después se vuelven a cargar los datos de ejemplo con fechas de hoy. Tarda unos tres minutos.";

/** Qué borra y qué deja el reinicio de la Clínica Demo: el texto de la
 *  confirmación. */
export const CONFIRMACION_DEL_REINICIO =
  "Se borran para siempre los pacientes, los turnos, las conversaciones con sus mensajes, las tareas, los recordatorios y mensajes programados de los turnos y los bloqueos de los profesionales. " +
  "Queda la configuración: sedes y horarios, profesionales, prestaciones, base de conocimiento, agentes, automatizaciones, QR, usuarios e invitaciones. " +
  "Después se vuelven a cargar los pacientes y los turnos de ejemplo, desde mañana.";
