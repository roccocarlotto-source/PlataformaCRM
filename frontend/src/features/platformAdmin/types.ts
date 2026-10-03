// Contrato de POST /api/admin/organizations
// (src/controllers/organizationAdmin.controller.ts) — Fase 4a del módulo
// SaaS. Herramienta del platform admin, no un signup público.

export interface CreateOrganizationInput {
  organizationName: string;
  adminFullName: string;
  adminEmail: string;
}

export interface CreateOrganizationResponse {
  organization: { id: string; name: string; slug: string };
  admin: { id: string; email: string; fullName: string; role: "ADMIN" };
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

// Contrato de GET /api/admin/organizations
// (src/controllers/organizationAdmin.controller.ts): las organizaciones
// vigentes, para el selector de las pantallas de plataforma.
export interface PlatformOrganization {
  id: string;
  name: string;
  slug: string;
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
