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
