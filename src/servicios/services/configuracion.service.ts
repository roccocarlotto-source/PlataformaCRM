import { AppError } from "../../utils/AppError";
import {
  createJobType,
  findJobTypeById,
  findJobTypes,
  updateJobType,
} from "../repositories/serviceJobType.repository";
import {
  actualizarConfiguracionDelTaller,
  type ConfiguracionDelTaller,
} from "../repositories/workshopSettings.repository";

// ---------------------------------------------------------------------------
// Configuración del taller (docs/servicios.md §4.8, ADMIN): los intervalos por
// defecto y el catálogo de tipos de service. Leer los tipos lo hace cualquiera
// (se eligen al crear una orden); escribir, solo ADMIN (lo exige la ruta).
// ---------------------------------------------------------------------------

const TIPO_NO_ENCONTRADO = "Tipo de service no encontrado";

export async function guardarConfiguracion(
  organizationId: string,
  input: Partial<ConfiguracionDelTaller>,
) {
  return actualizarConfiguracionDelTaller(organizationId, input);
}

export async function listarTipos(organizationId: string, soloActivos: boolean) {
  return findJobTypes(organizationId, soloActivos);
}

export async function crearTipo(
  organizationId: string,
  input: { name: string; nextServiceAfterMonths?: number | null; isActive?: boolean },
) {
  return createJobType(organizationId, {
    name: input.name,
    nextServiceAfterMonths: input.nextServiceAfterMonths ?? null,
    isActive: input.isActive ?? true,
  });
}

export async function actualizarTipo(
  organizationId: string,
  id: string,
  input: { name?: string; nextServiceAfterMonths?: number | null; isActive?: boolean },
) {
  if ((await updateJobType(organizationId, id, input)) === 0) {
    throw new AppError(TIPO_NO_ENCONTRADO, 404);
  }
  const tipo = await findJobTypeById(organizationId, id);
  if (!tipo) throw new AppError(TIPO_NO_ENCONTRADO, 404);
  return tipo;
}

/** Soft delete: las órdenes que lo tuvieron lo siguen mostrando. */
export async function borrarTipo(organizationId: string, id: string): Promise<void> {
  if ((await updateJobType(organizationId, id, { deletedAt: new Date() })) === 0) {
    throw new AppError(TIPO_NO_ENCONTRADO, 404);
  }
}
