import { logger } from "../lib/logger";
import { findBranchById } from "../repositories/branch.repository";
import { updateContact } from "../repositories/contact.repository";
import { findUserByIdInOrganization } from "../repositories/user.repository";
import { AppError } from "../utils/AppError";

// Compartido entre cualquier entidad con ownerId (Company, Contact, y las
// que sigan). Si no se especifica, el registro queda asignado a quien lo
// crea. Si se especifica, tiene que existir, ser de la misma organización y
// estar activo — nunca se confía en un ownerId del cliente sin validarlo.
export async function resolveOwnerId(
  organizationId: string,
  actorUserId: string,
  requestedOwnerId: string | undefined,
): Promise<string> {
  if (!requestedOwnerId) {
    return actorUserId;
  }

  return validarUsuarioAsignable(organizationId, requestedOwnerId, "ownerId");
}

// La mitad de resolveOwnerId que es SOLO validación, extraída para que la
// puedan usar los campos donde "no vino nada" NO significa "asignale al actor"
// — hoy Branch.defaultOwnerId (ítem 69), donde no hay ningún actor al que caer
// y no configurar nada es un estado válido. El mensaje se parametriza con el
// nombre del campo para que diga cuál falló; con `campo = "ownerId"` es
// palabra por palabra el que devolvía resolveOwnerId antes de esta extracción.
export async function validarUsuarioAsignable(
  organizationId: string,
  userId: string,
  campo: string,
): Promise<string> {
  const usuario = await findUserByIdInOrganization(userId, organizationId);

  if (!usuario) {
    throw new AppError(
      `El usuario indicado en ${campo} no existe, no pertenece a tu organización, o está desactivado`,
      400,
    );
  }

  return usuario.id;
}

// ---------------------------------------------------------------------------
// El ownerId EFECTIVO de un contacto, para el agente de IA (ítem 69 de
// docs/frontend-cambios-pendientes.md).
//
// Devuelve el ownerId que el contacto ya tenía; y si no tenía ninguno, el
// vendedor por defecto de la sucursal de la conversación, cuando esa sucursal
// tiene uno configurado y sigue siendo un usuario activo de la organización.
// Si lo tuvo que tomar de la sucursal, lo PERSISTE en el Contact: no es un
// dueño provisorio para esta acción, es la asignación real del lead. A partir
// de ahí el contacto aparece asignado en Contactos como cualquier otro, el
// vendedor lo puede reasignar con un click, y la próxima acción del agente
// sobre el mismo contacto ya no vuelve a chocar con esto.
//
// UNA SOLA VEZ, COMPARTIDA por los dos únicos puntos donde el hueco existe:
// create_opportunity (agentTools.service.ts) y ejecutarHandoff
// (agentOrchestration.service.ts). La regla tiene que ser la misma en los dos,
// y duplicarla era garantizar que en algún momento dejaran de coincidir.
//
// VIVE ACÁ, junto a resolveOwnerId, y no en branch.service.ts: es una regla de
// asignación de dueño, no una operación sobre sucursales, y tenerla al lado de
// resolveOwnerId es lo que deja a la vista por qué NO se reutiliza aquella
// (resolveOwnerId significa "si no viene nada, asignale al actor", y en un
// turno del agente de IA no hay ningún actor humano al que caer).
//
// ESCRIBE CON updateContact DEL REPOSITORY, no con el del service: el del
// service exige un actorUserId humano que en este contexto no existe. Es el
// mismo criterio por el que qualifyLead tiene su propio camino de escritura
// separado del PATCH humano de Contactos (ver el comentario de esa sección en
// contact.repository.ts).
//
// TOLERANTE DE PUNTA A PUNTA, mismo criterio que las lecturas de guardrails y
// de la base de conocimiento de este módulo: un defaultOwnerId que apunta a un
// usuario ya desactivado o removido se trata como "no hay vendedor por defecto
// configurado", y cualquier otro error inesperado se loguea y devuelve el
// ownerId que el contacto ya tenía. Nunca tumba el turno del agente — el
// llamador siempre puede seguir con el camino que ya tenía para "sin vendedor".
// ---------------------------------------------------------------------------
export async function resolverOwnerDelContacto(
  organizationId: string,
  branchId: string,
  contact: { id: string; ownerId: string | null },
): Promise<string | null> {
  if (contact.ownerId) {
    return contact.ownerId;
  }

  try {
    const branch = await findBranchById(branchId, organizationId);
    if (!branch?.defaultOwnerId) {
      return null;
    }

    // El vendedor por defecto pudo haberse desactivado o haber salido de la
    // organización después de configurarse: la columna sigue apuntando a él
    // (la FK es NO ACTION y users usa soft delete). Un vendedor así no puede
    // ser dueño de nada — es lo mismo que rechaza findUserByIdInOrganization
    // en cualquier otro camino de asignación.
    const vendedor = await findUserByIdInOrganization(branch.defaultOwnerId, organizationId);
    if (!vendedor) {
      logger.warn(
        { organizationId, branchId, contactId: contact.id, defaultOwnerId: branch.defaultOwnerId },
        "La sucursal tiene un vendedor por defecto que ya no es un usuario activo de la organización: se trata como si no tuviera ninguno",
      );
      return null;
    }

    // updateMany con organizationId + id (M4): el WHERE de la escritura es la
    // garantía de aislamiento. count === 0 solo puede pasar si el contacto se
    // borró entre la lectura y esto; en ese caso no hay a quién asignarle nada.
    const resultado = await updateContact(contact.id, organizationId, { ownerId: vendedor.id });
    if (resultado.count === 0) {
      return null;
    }

    return vendedor.id;
  } catch (err) {
    logger.warn(
      { err, organizationId, branchId, contactId: contact.id },
      "No se pudo resolver el vendedor por defecto de la sucursal: el contacto sigue como estaba",
    );
    return null;
  }
}
