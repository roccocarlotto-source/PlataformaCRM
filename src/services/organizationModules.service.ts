import { MODULOS_ACTIVABLES, MODULOS_POR_RUBRO, type Modulo } from "../config/ediciones";
import { prisma, type Db } from "../lib/prisma";
import {
  lockOrganizationForUpdate,
  rubroDeLaOrganizacionVigente,
} from "../repositories/organization.repository";
import {
  createOrganizationModule,
  disableOrganizationModule,
  findOrganizationModule,
  reactivateOrganizationModule,
} from "../repositories/organizationModule.repository";
import { asegurarConfiguracionDelTaller } from "../servicios/repositories/workshopSettings.repository";
import { AppError } from "../utils/AppError";
import { vaciarContextosDeAuth } from "./auth.service";

// ---------------------------------------------------------------------------
// Activar y desactivar un módulo activable en una organización
// (docs/servicios.md §1.5). Solo un platform admin (lo exige la ruta).
//
//   - Un módulo que no es activable: 400 MODULO_NO_ACTIVABLE.
//   - Una organización que no existe o está borrada: 404.
//   - Un rubro que no admite el módulo (MODULOS_POR_RUBRO, hoy: servicios
//     solo en AUTOMOTORA): 400 MODULO_NO_DISPONIBLE_EN_EL_RUBRO, sin escribir.
//   - Idempotentes: activar lo activo o desactivar lo inactivo es un 200 sin
//     cambios (un reintento o un doble click no da error).
//
// Activar por primera vez crea la fila; reactivar limpia la baja y NO toca
// enabled_at (la primera activación define qué ventas reciben el primer
// service, §6.1). Al activar servicios se asegura la configuración del
// taller (workshop_settings con sus defaults), en la misma transacción.
// Desactivar no borra nada: los datos se conservan.
//
// La fila de la organización se bloquea (FOR UPDATE), como en el cambio de
// rubro: un cambio de rubro simultáneo no puede dejar el módulo activo en un
// rubro que no lo admite. Después de un cambio real se vacía la caché de
// autenticación: los módulos activados viajan en el AuthContext, y sin esto
// se verían hasta el TTL.
// ---------------------------------------------------------------------------

export const MODULO_NO_ACTIVABLE = "MODULO_NO_ACTIVABLE";
export const MODULO_NO_DISPONIBLE_EN_EL_RUBRO = "MODULO_NO_DISPONIBLE_EN_EL_RUBRO";

export interface EstadoDelModulo {
  organizationId: string;
  modulo: Modulo;
  activo: boolean;
}

export interface ModulosActivablesDeps {
  transaction: <T>(fn: (tx: Db) => Promise<T>) => Promise<T>;
  vaciarCacheDeAuth: () => void;
}

const defaultDeps: ModulosActivablesDeps = {
  transaction: (fn) => prisma.$transaction(fn),
  vaciarCacheDeAuth: vaciarContextosDeAuth,
};

function exigirActivable(modulo: string): Modulo {
  if (!MODULOS_ACTIVABLES.has(modulo as Modulo)) {
    throw new AppError(`El módulo ${modulo} no se activa por organización.`, 400, true, {
      code: MODULO_NO_ACTIVABLE,
      modulo,
    });
  }
  return modulo as Modulo;
}

async function organizacionBloqueada(organizationId: string, tx: Db) {
  const org = await rubroDeLaOrganizacionVigente(organizationId, tx);
  if (!org) throw new AppError("Organización no encontrada", 404);
  await lockOrganizationForUpdate(organizationId, tx);
  return org;
}

export async function activarModulo(
  organizationId: string,
  moduloPedido: string,
  platformAdminUserId: string,
  deps: ModulosActivablesDeps = defaultDeps,
): Promise<EstadoDelModulo> {
  const modulo = exigirActivable(moduloPedido);
  const cambio = await deps.transaction(async (tx) => {
    const org = await organizacionBloqueada(organizationId, tx);
    if (!MODULOS_POR_RUBRO[org.industry].has(modulo)) {
      throw new AppError(
        `El módulo ${modulo} no está disponible para el rubro ${org.industry}.`,
        400,
        true,
        { code: MODULO_NO_DISPONIBLE_EN_EL_RUBRO, modulo, industry: org.industry },
      );
    }
    const fila = await findOrganizationModule(organizationId, modulo, tx);
    let cambio = false;
    if (!fila) {
      await createOrganizationModule(organizationId, modulo, platformAdminUserId, tx);
      cambio = true;
    } else if (fila.disabledAt !== null) {
      await reactivateOrganizationModule(organizationId, modulo, tx);
      cambio = true;
    }
    if (modulo === "servicios") await asegurarConfiguracionDelTaller(organizationId, tx);
    return cambio;
  });
  if (cambio) deps.vaciarCacheDeAuth();
  return { organizationId, modulo, activo: true };
}

export async function desactivarModulo(
  organizationId: string,
  moduloPedido: string,
  platformAdminUserId: string,
  deps: ModulosActivablesDeps = defaultDeps,
): Promise<EstadoDelModulo> {
  const modulo = exigirActivable(moduloPedido);
  const cambio = await deps.transaction(async (tx) => {
    await organizacionBloqueada(organizationId, tx);
    return (await disableOrganizationModule(organizationId, modulo, platformAdminUserId, tx)) > 0;
  });
  if (cambio) deps.vaciarCacheDeAuth();
  return { organizationId, modulo, activo: false };
}
