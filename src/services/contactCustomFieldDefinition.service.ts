import type { ContactCustomFieldDefinition } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  countActiveContactCustomFieldDefinitions,
  createContactCustomFieldDefinition,
  findActiveContactCustomFieldDefinitions,
  findContactCustomFieldDefinitionById,
  findContactCustomFieldDefinitionByKey,
  restoreContactCustomFieldDefinition,
  softDeleteContactCustomFieldDefinition,
  updateContactCustomFieldDefinition,
} from "../repositories/contactCustomFieldDefinition.repository";
import { AppError } from "../utils/AppError";
import {
  MAX_CAMPOS_POR_ORGANIZACION,
  MAX_LARGO_DE_ETIQUETA,
  MAX_LARGO_DE_OPCION,
  MAX_OPCIONES,
  keyDesdeEtiqueta,
  type DefinicionDeCampo,
  type TipoDeCampo,
} from "../utils/camposPersonalizados";

// ---------------------------------------------------------------------------
// Campos personalizados de contactos, v1 (B6, 06/10/2026): las DEFINICIONES.
// Las crea, edita y borra un ADMIN (routes); las lee cualquiera de la
// organización (la ficha del contacto y el agente). Los VALORES se validan
// contra ellas en contact.service.ts (una persona) y en la tool
// update_contact_custom_fields (el agente). Ver utils/camposPersonalizados.ts.
//
// Reglas:
//   - hasta MAX_CAMPOS_POR_ORGANIZACION (30) vigentes por organización;
//   - la key sale de la etiqueta al crear y no cambia (es lo que indexa el
//     JSON de cada contacto); dos campos vigentes no pueden tener la misma;
//   - crear con la key de un campo borrado lo RESTAURA con los datos nuevos:
//     los contactos que conservaban ese valor lo vuelven a mostrar;
//   - el tipo no se cambia después de crear: los valores guardados ya tienen
//     ese tipo. Se borra y se crea otro;
//   - SELECT exige entre 1 y MAX_OPCIONES opciones distintas; los otros
//     tipos no llevan.
// ---------------------------------------------------------------------------

export const MENSAJE_TOPE_DE_CAMPOS = `Esta organización ya tiene ${String(MAX_CAMPOS_POR_ORGANIZACION)} campos personalizados, que es el máximo`;
export const MENSAJE_CAMPO_DUPLICADO = "Ya existe un campo personalizado con ese nombre";
export const MENSAJE_CAMPO_NO_ENCONTRADO = "Campo personalizado no encontrado";
export const MENSAJE_TIPO_INMUTABLE =
  "El tipo de un campo no se puede cambiar: borralo y creá otro";

export interface CrearDefinicionInput {
  label: string;
  type: TipoDeCampo;
  options?: string[];
  agentEditable?: boolean;
}

export interface ActualizarDefinicionInput {
  label?: string;
  options?: string[];
  agentEditable?: boolean;
}

function limpiarEtiqueta(label: string): string {
  const texto = label.trim().replace(/\s+/g, " ");
  if (texto.length === 0) {
    throw new AppError("La etiqueta del campo es obligatoria", 400);
  }
  if (texto.length > MAX_LARGO_DE_ETIQUETA) {
    throw new AppError(
      `La etiqueta no puede superar los ${String(MAX_LARGO_DE_ETIQUETA)} caracteres`,
      400,
    );
  }
  return texto;
}

// Las opciones de un SELECT: recortadas, sin vacías ni repetidas, entre 1 y
// MAX_OPCIONES. Para los otros tipos, siempre [].
function limpiarOpciones(type: TipoDeCampo, options: string[] | undefined): string[] {
  if (type !== "SELECT") {
    return [];
  }
  const vistas = new Set<string>();
  const limpias: string[] = [];
  for (const opcion of options ?? []) {
    const texto = opcion.trim();
    if (texto.length === 0 || vistas.has(texto)) continue;
    if (texto.length > MAX_LARGO_DE_OPCION) {
      throw new AppError(
        `Una opción no puede superar los ${String(MAX_LARGO_DE_OPCION)} caracteres`,
        400,
      );
    }
    vistas.add(texto);
    limpias.push(texto);
  }
  if (limpias.length === 0) {
    throw new AppError("Un campo de lista necesita al menos una opción", 400);
  }
  if (limpias.length > MAX_OPCIONES) {
    throw new AppError(`Una lista no puede tener más de ${String(MAX_OPCIONES)} opciones`, 400);
  }
  return limpias;
}

// Las opciones tal como están guardadas (jsonb): siempre un string[].
export function opcionesDe(definicion: Pick<ContactCustomFieldDefinition, "options">): string[] {
  return Array.isArray(definicion.options)
    ? definicion.options.filter((o): o is string => typeof o === "string")
    : [];
}

// La forma que entiende el validador de valores.
export function aDefinicionDeCampo(definicion: ContactCustomFieldDefinition): DefinicionDeCampo {
  return {
    key: definicion.key,
    label: definicion.label,
    type: definicion.type,
    options: opcionesDe(definicion),
    agentEditable: definicion.agentEditable,
  };
}

export function listarDefiniciones(organizationId: string) {
  return findActiveContactCustomFieldDefinitions(organizationId);
}

// Las vigentes, listas para validar valores (contact.service y el agente).
export async function definicionesParaValidar(
  organizationId: string,
): Promise<DefinicionDeCampo[]> {
  return (await findActiveContactCustomFieldDefinitions(organizationId)).map(aDefinicionDeCampo);
}

export async function obtenerDefinicion(organizationId: string, id: string) {
  const definicion = await findContactCustomFieldDefinitionById(id, organizationId);
  if (!definicion) {
    throw new AppError(MENSAJE_CAMPO_NO_ENCONTRADO, 404);
  }
  return definicion;
}

export async function crearDefinicion(
  organizationId: string,
  input: CrearDefinicionInput,
): Promise<ContactCustomFieldDefinition> {
  const label = limpiarEtiqueta(input.label);
  const key = keyDesdeEtiqueta(label);
  if (key.length === 0) {
    throw new AppError("La etiqueta tiene que tener al menos una letra o un número", 400);
  }
  const options = limpiarOpciones(input.type, input.options);
  const agentEditable = input.agentEditable ?? false;

  // En una transacción: el tope y la key se deciden sobre lo que hay AHORA.
  // Dos creaciones a la vez de la misma key las separa el UNIQUE (P2002 →
  // 409 por el errorHandler); el tope es de "a lo sumo 30", no un invariante
  // que valga la pena serializar.
  return prisma.$transaction(async (tx) => {
    const existente = await findContactCustomFieldDefinitionByKey(organizationId, key, tx);
    if (existente && existente.deletedAt === null) {
      throw new AppError(MENSAJE_CAMPO_DUPLICADO, 409);
    }
    const vigentes = await countActiveContactCustomFieldDefinitions(organizationId, tx);
    if (vigentes >= MAX_CAMPOS_POR_ORGANIZACION) {
      throw new AppError(MENSAJE_TOPE_DE_CAMPOS, 409);
    }
    if (existente) {
      // Borrado antes: vuelve, con el tipo y las opciones nuevas. Si el tipo
      // cambió, los valores viejos que no coincidan simplemente no validan
      // al editarlos; mostrar se muestran igual.
      await restoreContactCustomFieldDefinition(
        existente.id,
        organizationId,
        { label, type: input.type, options, agentEditable, position: vigentes },
        tx,
      );
      return tx.contactCustomFieldDefinition.findUniqueOrThrow({ where: { id: existente.id } });
    }
    return createContactCustomFieldDefinition(
      { organizationId, key, label, type: input.type, options, agentEditable, position: vigentes },
      tx,
    );
  });
}

export async function actualizarDefinicion(
  organizationId: string,
  id: string,
  input: ActualizarDefinicionInput & { type?: TipoDeCampo },
): Promise<ContactCustomFieldDefinition> {
  const vigente = await obtenerDefinicion(organizationId, id);
  if (input.type !== undefined && input.type !== vigente.type) {
    throw new AppError(MENSAJE_TIPO_INMUTABLE, 400);
  }
  const cambios = {
    ...(input.label !== undefined ? { label: limpiarEtiqueta(input.label) } : {}),
    ...(input.options !== undefined
      ? { options: limpiarOpciones(vigente.type, input.options) }
      : {}),
    ...(input.agentEditable !== undefined ? { agentEditable: input.agentEditable } : {}),
  };
  const { count } = await updateContactCustomFieldDefinition(id, organizationId, cambios);
  if (count === 0) {
    throw new AppError(MENSAJE_CAMPO_NO_ENCONTRADO, 404);
  }
  return obtenerDefinicion(organizationId, id);
}

export async function borrarDefinicion(organizationId: string, id: string): Promise<void> {
  const { count } = await softDeleteContactCustomFieldDefinition(id, organizationId);
  if (count === 0) {
    throw new AppError(MENSAJE_CAMPO_NO_ENCONTRADO, 404);
  }
}
