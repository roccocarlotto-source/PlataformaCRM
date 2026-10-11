import { logger } from "../../lib/logger";
import {
  createOrganizationWithFoundingAdmin,
  defaultOrganizationAdminDeps,
  type CreateOrganizationWithFoundingAdminResult,
  type OrganizationAdminDeps,
} from "../../services/organizationAdmin.service";
import { AppError } from "../../utils/AppError";
import { nombreDeLaDemo } from "./config";
import {
  cargarDatosDeEjemplo,
  type OpcionesDeLaDemo,
  type ResumenDeDatosDeEjemplo,
} from "./datosDeEjemplo";

// ---------------------------------------------------------------------------
// Alta de la Clínica Demo (docs/rubros.md §12.1, D14, R19), por un platform
// admin: POST /api/admin/organizations/clinica-demo.
//
// OPCIÓN B ACOTADA (decisión de Rocco): crea la organización CLINICA aunque
// CLINICA_HABILITADA esté en false. Es el único camino que lo hace: el alta
// común (POST /api/admin/organizations y la pantalla Nueva organización)
// sigue dando 400 a CLINICA con la llave apagada. El alta es la de siempre
// (createOrganizationWithFoundingAdmin, con la invitación real al email del
// admin), con la opción clinicaDemo, que solo admite una clínica ESENCIAL con
// el slug de la demo. Después, los datos de ejemplo (datosDeEjemplo.ts).
// ---------------------------------------------------------------------------

export interface CrearClinicaDemoInput {
  adminFullName: string;
  adminEmail: string;
  /** "Norte" → "Clínica Demo Norte" (slug clinica-demo-norte). */
  sufijo?: string;
}

export interface ClinicaDemoCreada extends CreateOrganizationWithFoundingAdminResult {
  datosDeEjemplo: ResumenDeDatosDeEjemplo;
}

export const DATOS_DE_EJEMPLO_FALLIDOS =
  "La Clínica Demo se creó, pero no se pudieron cargar los datos de ejemplo. Borrala a mano antes de volver a intentar.";

export async function crearClinicaDemo(
  input: CrearClinicaDemoInput,
  deps: OrganizationAdminDeps = defaultOrganizationAdminDeps,
  opciones: OpcionesDeLaDemo = {},
): Promise<ClinicaDemoCreada> {
  const creada = await createOrganizationWithFoundingAdmin(
    {
      organizationName: nombreDeLaDemo(input.sufijo),
      adminFullName: input.adminFullName,
      adminEmail: input.adminEmail,
      edition: "ESENCIAL",
      industry: "CLINICA",
    },
    deps,
    { clinicaDemo: true },
  );

  try {
    const datosDeEjemplo = await cargarDatosDeEjemplo(
      creada.organization.id,
      creada.admin.id,
      opciones,
    );
    return { ...creada, datosDeEjemplo };
  } catch (err) {
    // La organización y la invitación ya existen: no se compensan (el admin
    // ya recibió el mail). Se informa para que Rocco la borre a mano.
    logger.error(
      { err, organizationId: creada.organization.id },
      "No se pudieron cargar los datos de ejemplo de la Clínica Demo",
    );
    throw new AppError(DATOS_DE_EJEMPLO_FALLIDOS, 500);
  }
}
