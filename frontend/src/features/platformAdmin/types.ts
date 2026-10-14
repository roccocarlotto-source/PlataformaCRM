// Contrato de POST /api/admin/organizations
// (src/controllers/organizationAdmin.controller.ts) — Fase 4a del módulo
// SaaS. Herramienta del platform admin, no un signup público.

// docs/ediciones.md §1.1. La lista de las que se pueden elegir hoy la da el
// backend (GET /api/admin/organizations/editions): acá no hay una constante.
export type OrganizationEdition = "COMPLETA" | "ESENCIAL";

// docs/rubros.md §1.1. Mismo criterio: la lista de los que se pueden elegir
// hoy la da el backend (GET /api/admin/organizations/industries).
export type OrganizationIndustry = "AUTOMOTORA" | "CLINICA";

export interface CreateOrganizationInput {
  organizationName: string;
  adminFullName: string;
  adminEmail: string;
  // Solo se manda si se pudo elegir (más de una edición disponible).
  edition?: OrganizationEdition;
  // Ídem, con los rubros.
  industry?: OrganizationIndustry;
  // País (código, sin "+"), moneda y zona. Sin ellos el backend usa Uruguay,
  // USD y America/Montevideo; el formulario los manda siempre.
  defaultPhoneCountryCode?: string;
  preferredCurrency?: string;
  timezone?: string;
}

export interface CreateOrganizationResponse {
  organization: {
    id: string;
    name: string;
    slug: string;
    edition: OrganizationEdition;
    industry: OrganizationIndustry;
  };
  admin: { id: string; email: string; fullName: string; role: "ADMIN" };
}

// Contrato de POST /api/admin/organizations/clinica-demo
// (src/clinicas/demo/clinicaDemo.controller.ts) — docs/rubros.md §12.1, R19.
// La organización es siempre "Clínica Demo" (con un sufijo opcional), CLINICA
// y ESENCIAL: el body no elige ni rubro ni edición.
export interface CreateClinicaDemoInput {
  adminFullName: string;
  adminEmail: string;
  sufijo?: string;
}

// La respuesta del alta más lo que se cargó; la pantalla muestra lo mismo que
// en el alta común.
export interface CreateClinicaDemoResponse extends CreateOrganizationResponse {
  datosDeEjemplo: Record<string, number>;
}

// Contrato de POST /api/admin/organizations/:organizationId/demo/reiniciar
// (src/clinicas/demo/reinicioDeLaDemo.service.ts) — docs/rubros.md §12.3. Las
// filas borradas por tabla y lo que se volvió a cargar.
export interface ReinicioDeLaDemo {
  organizationId: string;
  borrados: Record<string, number>;
  cargados: {
    bloqueos: number;
    pacientes: number;
    turnosProximos: number;
    sobreturnos: number;
    turnosConfirmados: number;
    turnosAtendidos: number;
    turnosOmitidos: number;
  };
}

// Contrato de PUT /api/admin/agents/:agentId/whatsapp-phone-number
// (src/controllers/agentAdmin.controller.ts) — ítem 127. null libera el número.
export interface AssignWhatsappNumberInput {
  agentId: string;
  whatsappPhoneNumberId: string | null;
}

// Contrato de PUT /api/admin/agents/:agentId/facebook-page
// (src/controllers/agentAdmin.controller.ts) — backend del ítem 169, pantalla
// del ítem 173. null libera la página.
export interface AssignFacebookPageInput {
  agentId: string;
  facebookPageId: string | null;
}

// Contratos de PUT /api/admin/agents/:agentId/model y
// PUT /api/admin/organizations/:organizationId/internal-agent/model
// (src/controllers/agentAdmin.controller.ts) — B-05: el modelo de IA lo elige
// solo la plataforma. modelProvider es opcional (el backend usa OpenRouter).
export interface AssignAgentModelInput {
  agentId: string;
  modelProvider?: string;
  modelName: string;
}

export interface AssignInternalAgentModelInput {
  organizationId: string;
  modelProvider?: string;
  modelName: string;
}

// Contrato de GET /api/admin/organizations/:organizationId/agents
// (src/controllers/agentAdmin.controller.ts): los agentes vigentes de una
// organización, ordenados por nombre, para el selector de "Modelo de IA".
export interface PlatformAgentDeOrganizacion {
  id: string;
  name: string;
  branchName: string;
  modelProvider: string;
  modelName: string;
  isActive: boolean;
}

// Contrato de GET /api/admin/organizations
// (src/controllers/organizationAdmin.controller.ts): las organizaciones
// vigentes, para el selector de las pantallas de plataforma.
export interface PlatformOrganization {
  id: string;
  name: string;
  slug: string;
  edition: OrganizationEdition;
  industry: OrganizationIndustry;
  // Los módulos activables vigentes (docs/servicios.md §1.5), en orden.
  modulosActivados: string[];
}

// Contrato de GET /api/admin/organizations/editions.
export interface EdicionesDisponibles {
  editions: OrganizationEdition[];
}

// Contrato de GET /api/admin/organizations/industries.
export interface RubrosDisponibles {
  industries: OrganizationIndustry[];
}

// Contrato de GET /api/admin/llm-usage (B4): el gasto en el modelo por
// organización de los últimos `dias` días. costUsd es null si ningún turno
// de la ventana trajo costo (el proveedor no lo informó).
export interface LlmUsageDeOrganizacion {
  organizationId: string;
  organizationName: string;
  turnos: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number | null;
}

export interface LlmUsageSummary {
  dias: number;
  organizaciones: LlmUsageDeOrganizacion[];
}

// La conexión con Facebook de una organización elegida (02/10/2026: la hace
// el platform admin, no el ADMIN del negocio). La respuesta de
// POST /api/admin/organizations/:id/integrations/meta/connect: la URL de
// autorización de Meta en el cuerpo, no un 302 (un redirect no lleva el
// header Authorization).
export interface MetaAuthorization {
  authorizationUrl: string;
}

// Lo que el callback de Meta le rebota al CRM en el fragmento de la URL
// (#metaCode=…&metaState=…) para que lo complete la sesión de quien empezó.
export interface MetaConnectionPendiente {
  code: string;
  state: string;
}

// El WABA propio de una clínica (docs/whatsapp-alta-clinica.md). null = la
// organización usa el WABA de la plataforma.
export interface ConexionDeWhatsappDeLaClinica {
  wabaId: string;
  status: "ACTIVE" | "REVOKED" | "ERROR";
  createdAt: string;
  updatedAt: string;
}

export interface AltaDeWabaDeLaClinica {
  conexion: ConexionDeWhatsappDeLaClinica;
  reglasSincronizadas: number;
  erroresDeSincronizacion: { automationId: string; error: string }[];
}
