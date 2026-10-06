// Campos personalizados de contactos, v1 (B6). Contrato de
// /api/contact-custom-fields (src/controllers/contactCustomFieldDefinition.controller.ts).
// Las definiciones las crea un ADMIN; los valores van en Contact.customFields
// como { [key]: valor } y los valida el backend contra estas definiciones.

export type ContactCustomFieldType = "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT";

export interface ContactCustomFieldDefinition {
  id: string;
  organizationId: string;
  // Estable: sale de la etiqueta al crear y no cambia aunque se renombre.
  key: string;
  label: string;
  type: ContactCustomFieldType;
  // Solo para SELECT; [] en los demás.
  options: string[];
  agentEditable: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateContactCustomFieldInput {
  label: string;
  type: ContactCustomFieldType;
  options?: string[];
  agentEditable?: boolean;
}

// El tipo no se cambia después de crear (el backend lo rechaza).
export interface UpdateContactCustomFieldInput {
  label?: string;
  options?: string[];
  // Solo junto con `options`: las opciones que cambiaron de texto. Los
  // contactos que las tenían elegidas pasan al texto nuevo.
  renamedOptions?: { from: string; to: string }[];
  agentEditable?: boolean;
}

// GET /contact-custom-fields/:id/option-usage — { opción: contactos que la
// tienen elegida }, solo las que usa al menos uno.
export interface ContactCustomFieldOptionUsage {
  contactsByOption: Record<string, number>;
}

// Un valor guardado en Contact.customFields. null borra.
export type ContactCustomFieldValue = string | number | boolean | null;
