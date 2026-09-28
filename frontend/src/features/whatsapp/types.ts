// Reconstruido desde el contrato real del backend
// (src/controllers/whatsappTemplate.controller.ts,
// src/repositories/whatsappTemplate.repository.ts — seleccionPublica). No se
// agrega ningún campo que el backend no devuelva o no acepte.
//
// NO es una lista: cada REGLA de automatización tiene a lo sumo UNA plantilla
// activa (ítem 181; en el 160 era una por organización), así que el GET, que
// pide el automationId, devuelve esa o null.

// El estado de la revisión de Meta, ya traducido por el backend a tres.
export type WhatsappTemplateStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface WhatsappTemplate {
  id: string;
  // La regla de automatización que manda con esta plantilla (ítem 181).
  automationId: string;
  // Minúsculas, números y guion bajo: el nombre con que se registró en Meta.
  name: string;
  // Código de idioma de Meta (es_AR, es, en_US...).
  language: string;
  // El texto tal cual lo escribió el negocio, con {nombre} y {link}.
  bodyText: string;
  status: WhatsappTemplateStatus;
  // Motivo del rechazo (o del estado en que Meta la dejó). Null si no aplica.
  rejectedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWhatsappTemplateInput {
  automationId: string;
  name: string;
  language: string;
  bodyText: string;
}
