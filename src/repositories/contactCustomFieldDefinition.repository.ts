import type { ContactCustomFieldType, Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Las definiciones de los campos personalizados de contactos (B6, migración
// 20261024120000). Ver el modelo ContactCustomFieldDefinition en schema.prisma
// y contactCustomFieldDefinition.service.ts. Las escrituras son updateMany con
// id + organizationId (M4): el id de otra organización no toca nada.
// ---------------------------------------------------------------------------

export interface CreateContactCustomFieldDefinitionData {
  organizationId: string;
  key: string;
  label: string;
  type: ContactCustomFieldType;
  options: string[];
  agentEditable: boolean;
  position: number;
}

export interface UpdateContactCustomFieldDefinitionData {
  label?: string;
  options?: string[];
  agentEditable?: boolean;
  position?: number;
}

// Las vigentes de la organización, en el orden de la ficha.
export function findActiveContactCustomFieldDefinitions(organizationId: string, db: Db = prisma) {
  return db.contactCustomFieldDefinition.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

export function countActiveContactCustomFieldDefinitions(organizationId: string, db: Db = prisma) {
  return db.contactCustomFieldDefinition.count({ where: { organizationId, deletedAt: null } });
}

export function findContactCustomFieldDefinitionById(
  id: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.contactCustomFieldDefinition.findFirst({
    where: { id, organizationId, deletedAt: null },
  });
}

// Por key, INCLUIDAS las borradas: crear un campo con la key de uno borrado
// lo restaura (ver el service).
export function findContactCustomFieldDefinitionByKey(
  organizationId: string,
  key: string,
  db: Db = prisma,
) {
  return db.contactCustomFieldDefinition.findUnique({
    where: { organizationId_key: { organizationId, key } },
  });
}

export function createContactCustomFieldDefinition(
  data: CreateContactCustomFieldDefinitionData,
  db: Db = prisma,
) {
  return db.contactCustomFieldDefinition.create({
    data: { ...data, options: data.options as Prisma.InputJsonValue },
  });
}

export function updateContactCustomFieldDefinition(
  id: string,
  organizationId: string,
  data: UpdateContactCustomFieldDefinitionData,
  db: Db = prisma,
) {
  const { options, ...resto } = data;
  return db.contactCustomFieldDefinition.updateMany({
    where: { id, organizationId, deletedAt: null },
    data: {
      ...resto,
      ...(options === undefined ? {} : { options: options as Prisma.InputJsonValue }),
    },
  });
}

// Restaura una borrada con los datos nuevos (misma key, mismo id).
export function restoreContactCustomFieldDefinition(
  id: string,
  organizationId: string,
  data: Omit<CreateContactCustomFieldDefinitionData, "organizationId" | "key">,
  db: Db = prisma,
) {
  return db.contactCustomFieldDefinition.updateMany({
    where: { id, organizationId },
    data: { ...data, options: data.options as Prisma.InputJsonValue, deletedAt: null },
  });
}

export function softDeleteContactCustomFieldDefinition(
  id: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.contactCustomFieldDefinition.updateMany({
    where: { id, organizationId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}
