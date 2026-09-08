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
