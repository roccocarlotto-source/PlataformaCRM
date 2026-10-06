import type { ContactCustomFieldDefinition } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  applyCustomFieldOptionMapping,
  convertCustomFieldValuesToArray,
  convertCustomFieldValuesToScalar,
  countContactsByCustomFieldValue,
  countContactsWithSeveralOptions,
} from "../repositories/contact.repository";
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
  keyDesdeEtiqueta,
  limpiarOpcionesDeLista,
  mapeoDeCambiosDeOpciones,
  tieneOpciones,
  type DefinicionDeCampo,
  type MapeoDeOpciones,
  type OpcionEliminada,
  type RenombreDeOpcion,
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
//     ese tipo. Se borra y se crea otro. ÚNICA EXCEPCIÓN, SELECT ↔
//     MULTI_SELECT: de lista a selección múltiple siempre (cada valor pasa a
//     un arreglo de uno); de múltiple a lista solo si ningún contacto vigente
//     tiene más de una opción elegida (409 que dice cuántos la tienen);
//   - SELECT y MULTI_SELECT exigen entre 1 y MAX_OPCIONES opciones distintas
//     (sin distinguir mayúsculas ni acentos); los otros tipos no llevan;
//   - al cambiar las opciones de una lista que ya usan contactos, en la misma
//     transacción y solo en esta organización (ver mapeoDeCambiosDeOpciones):
//       · RENOMBRAR una opción (renamedOptions) mueve el valor de los
//         contactos que la tenían;
//       · ELIMINAR una opción (removedOptions) lo decide el ADMIN por opción:
//         "clear" la saca del contacto, "move" la pasa a otra(s) opción(es)
//         nuevas, "keep" la deja como está (el texto viejo, que la ficha
//         muestra como "opción eliminada" y no traba el guardado, ver
//         soloLosQueCambian). Una eliminada que no viene en removedOptions se
//         conserva: por defecto no se borra nada.
//     usoDeOpciones le dice a la pantalla cuántos contactos toca cada caso.
// ---------------------------------------------------------------------------

export const MENSAJE_TOPE_DE_CAMPOS = `Esta organización ya tiene ${String(MAX_CAMPOS_POR_ORGANIZACION)} campos personalizados, que es el máximo`;
export const MENSAJE_CAMPO_DUPLICADO = "Ya existe un campo personalizado con ese nombre";
export const MENSAJE_CAMPO_NO_ENCONTRADO = "Campo personalizado no encontrado";
export const MENSAJE_TIPO_INMUTABLE =
  "El tipo de un campo no se puede cambiar (salvo entre lista y selección múltiple): borralo y creá otro";
export const MENSAJE_RENOMBRES_SIN_OPCIONES =
  "renamedOptions y removedOptions solo se pueden mandar junto con options, en un campo de lista";

export function mensajeDeVariasOpciones(label: string, contactos: number): string {
  return contactos === 1
    ? `No se puede pasar «${label}» a lista de una sola opción: un contacto tiene más de una opción elegida. Dejale una sola o conservá la selección múltiple.`
    : `No se puede pasar «${label}» a lista de una sola opción: ${String(contactos)} contactos tienen más de una opción elegida. Dejales una sola o conservá la selección múltiple.`;
}

export interface CrearDefinicionInput {
  label: string;
  type: TipoDeCampo;
  options?: string[];
  agentEditable?: boolean;
}

export interface ActualizarDefinicionInput {
  label?: string;
  // Solo SELECT ↔ MULTI_SELECT; cualquier otro cambio es 400.
  type?: TipoDeCampo;
  options?: string[];
  // Solo junto con `options`: las opciones que cambiaron de texto, y qué
  // hacer con los contactos que tenían una opción que ya no está.
  renamedOptions?: RenombreDeOpcion[];
  removedOptions?: OpcionEliminada[];
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

// Las opciones de un SELECT o MULTI_SELECT (ver limpiarOpcionesDeLista).
// Para los otros tipos, siempre [].
function limpiarOpciones(type: TipoDeCampo, options: string[] | undefined): string[] {
  if (!tieneOpciones(type)) {
    return [];
  }
  const resultado = limpiarOpcionesDeLista(options ?? []);
  if (!resultado.ok) {
    throw new AppError(resultado.error, 400);
  }
  return resultado.opciones;
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
  input: ActualizarDefinicionInput,
): Promise<ContactCustomFieldDefinition> {
  const vigente = await obtenerDefinicion(organizationId, id);
  const type = input.type ?? vigente.type;
  const cambiaDeTipo = type !== vigente.type;
  if (cambiaDeTipo && !(tieneOpciones(type) && tieneOpciones(vigente.type))) {
    throw new AppError(MENSAJE_TIPO_INMUTABLE, 400);
  }
  const options = input.options !== undefined ? limpiarOpciones(type, input.options) : undefined;
  const mapeo = mapeoPedido(type, vigente, options, input.renamedOptions, input.removedOptions);
  const cambios = {
    ...(input.label !== undefined ? { label: limpiarEtiqueta(input.label) } : {}),
    ...(cambiaDeTipo ? { type } : {}),
    ...(options !== undefined ? { options } : {}),
    ...(input.agentEditable !== undefined ? { agentEditable: input.agentEditable } : {}),
  };
  // En una transacción: la definición y los valores de sus contactos (el
  // cambio de tipo, los renombres, las eliminadas) cambian juntos, o nada.
  await prisma.$transaction(async (tx) => {
    if (cambiaDeTipo && type === "SELECT") {
      const varios = await countContactsWithSeveralOptions(organizationId, vigente.key, tx);
      if (varios > 0) {
        throw new AppError(mensajeDeVariasOpciones(vigente.label, varios), 409);
      }
    }
    const { count } = await updateContactCustomFieldDefinition(id, organizationId, cambios, tx);
    if (count === 0) {
      throw new AppError(MENSAJE_CAMPO_NO_ENCONTRADO, 404);
    }
    if (cambiaDeTipo) {
      await (type === "MULTI_SELECT"
        ? convertCustomFieldValuesToArray(organizationId, vigente.key, tx)
        : convertCustomFieldValuesToScalar(organizationId, vigente.key, tx));
    }
    await applyCustomFieldOptionMapping(organizationId, vigente.key, mapeo, tx);
  });
  return obtenerDefinicion(organizationId, id);
}

// El mapeo de valores que piden los renombres y las decisiones sobre las
// opciones eliminadas (ver mapeoDeCambiosDeOpciones), validado. Vacío si no
// se pidió nada.
function mapeoPedido(
  type: TipoDeCampo,
  vigente: ContactCustomFieldDefinition,
  opcionesNuevas: string[] | undefined,
  renombres: RenombreDeOpcion[] | undefined,
  eliminadas: OpcionEliminada[] | undefined,
): MapeoDeOpciones {
  if ((renombres === undefined || renombres.length === 0) && (eliminadas ?? []).length === 0) {
    return {};
  }
  if (!tieneOpciones(type) || opcionesNuevas === undefined) {
    throw new AppError(MENSAJE_RENOMBRES_SIN_OPCIONES, 400);
  }
  const resultado = mapeoDeCambiosDeOpciones(
    type,
    opcionesDe(vigente),
    opcionesNuevas,
    renombres ?? [],
    eliminadas ?? [],
  );
  if (!resultado.ok) {
    throw new AppError(resultado.error, 400);
  }
  return resultado.mapeo;
}

// Cuántos contactos vigentes tienen elegida cada opción de un campo de lista:
// { opción: cantidad }, solo las que usa al menos uno. Para los otros tipos,
// {} (no hay opciones que borrar ni renombrar).
export async function usoDeOpciones(
  organizationId: string,
  id: string,
): Promise<Record<string, number>> {
  const definicion = await obtenerDefinicion(organizationId, id);
  if (!tieneOpciones(definicion.type)) {
    return {};
  }
  return countContactsByCustomFieldValue(organizationId, definicion.key);
}

export async function borrarDefinicion(organizationId: string, id: string): Promise<void> {
  const { count } = await softDeleteContactCustomFieldDefinition(id, organizationId);
  if (count === 0) {
    throw new AppError(MENSAJE_CAMPO_NO_ENCONTRADO, 404);
  }
}
