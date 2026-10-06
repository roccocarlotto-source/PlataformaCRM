// Campos personalizados de contactos, v1 (B6). Contrato de
// /api/contact-custom-fields (src/controllers/contactCustomFieldDefinition.controller.ts).
// Las definiciones las crea un ADMIN; los valores van en Contact.customFields
// como { [key]: valor } y los valida el backend contra estas definiciones.

export type ContactCustomFieldType =
  "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT" | "MULTI_SELECT";

// Los tipos que llevan opciones; entre ellos se puede cambiar el tipo de un
// campo ya creado (el backend convierte los valores guardados).
export function tieneOpciones(type: ContactCustomFieldType): boolean {
  return type === "SELECT" || type === "MULTI_SELECT";
}

export interface ContactCustomFieldDefinition {
  id: string;
  organizationId: string;
  // Estable: sale de la etiqueta al crear y no cambia aunque se renombre.
  key: string;
  label: string;
  type: ContactCustomFieldType;
  // Solo para SELECT y MULTI_SELECT; [] en los demás.
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

// Qué hacer con los contactos que tenían una opción que se eliminó de la
// lista: sacarla, pasarla a otra(s) opción(es) o dejarla como está.
export type DecisionSobreEliminada =
  { action: "clear" } | { action: "keep" } | { action: "move"; to: string[] };

// El tipo solo se cambia entre SELECT y MULTI_SELECT (el backend rechaza
// cualquier otro cambio).
export interface UpdateContactCustomFieldInput {
  label?: string;
  type?: ContactCustomFieldType;
  options?: string[];
  // Solo junto con `options`: las opciones que cambiaron de texto (los
  // contactos que las tenían pasan al texto nuevo) y qué hacer con las que
  // ya no están.
  renamedOptions?: { from: string; to: string }[];
  removedOptions?: ({ from: string } & DecisionSobreEliminada)[];
  agentEditable?: boolean;
}

// GET /contact-custom-fields/:id/option-usage — { opción: contactos que la
// tienen elegida }, solo las que usa al menos uno.
export interface ContactCustomFieldOptionUsage {
  contactsByOption: Record<string, number>;
}

// Un valor guardado en Contact.customFields. null borra. El arreglo es el
// de una selección múltiple (todas las opciones elegidas).
export type ContactCustomFieldValue = string | number | boolean | string[] | null;
