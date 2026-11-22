import type { Db } from "../lib/prisma";
import type { Termino } from "../config/terminos";
import { TERMINO_DEL_CONTACTO } from "./config/rubro";
import { leerConfiguracionDeClinica } from "./repositories/clinicSettings.repository";

// ---------------------------------------------------------------------------
// Las notas y tareas de clínica con el término de contacto de la organización
// (QA de la primera clínica, 2026-11-21, ISSUE-014: un centro de belleza con
// el término "cliente" veía "Turno confirmado por el paciente"). Una clínica
// con "paciente" lee exactamente lo de antes.
//
// Ninguno de estos textos se busca por prefijo en la base: los que sí
// (PREFIJO_TAREA_SIN_RESPUESTA, la tarea agrupada de envíos fallidos, las de
// derivación) no nombran al contacto.
// ---------------------------------------------------------------------------

export const TERMINO_POR_DEFECTO: Termino = TERMINO_DEL_CONTACTO.PACIENTE;

/** El término de la organización (sin configuración, "paciente"). */
export async function terminoDeLaClinica(organizationId: string, db?: Db): Promise<Termino> {
  const { contactTerm } = await leerConfiguracionDeClinica(organizationId, db);
  return TERMINO_DEL_CONTACTO[contactTerm];
}

/** "el paciente", "el cliente": para un contacto sin nombre. */
export function elContacto(termino: Termino): string {
  return `${termino.genero === "femenino" ? "la" : "el"} ${termino.singular}`;
}

/** "El paciente", "El cliente": al empezar una oración. */
export function elContactoAlEmpezar(termino: Termino): string {
  const texto = elContacto(termino);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** "al paciente", "al cliente". */
export function alContacto(termino: Termino): string {
  return termino.genero === "femenino" ? `a la ${termino.singular}` : `al ${termino.singular}`;
}

/** El nombre completo, o "el paciente" si no tiene. */
export function nombreOElContacto(
  contacto: { firstName: string; lastName: string } | null | undefined,
  termino: Termino,
): string {
  const nombre = contacto ? `${contacto.firstName} ${contacto.lastName}`.trim() : "";
  return nombre || elContacto(termino);
}

/** El nombre completo; sin nombre (o sin contacto), "el paciente" con el
 *  término de la organización, que se lee SOLO en ese caso (el caso común no
 *  suma consultas). */
export async function nombreDelContactoEnLaClinica(
  contacto: { firstName: string; lastName: string } | null | undefined,
  organizationId: string,
  db?: Db,
): Promise<string> {
  const nombre = contacto ? `${contacto.firstName} ${contacto.lastName}`.trim() : "";
  return nombre || elContacto(await terminoDeLaClinica(organizationId, db));
}

/** Asunto de la nota cuando confirma por el botón del recordatorio. */
export function prefijoNotaConfirmado(termino: Termino): string {
  return `Turno confirmado por ${elContacto(termino)}: `;
}

/** Asunto de la tarea cuando cancela por el botón del recordatorio. */
export function prefijoTareaCanceloPorRecordatorio(termino: Termino): string {
  return `Turno cancelado por ${elContacto(termino)}: `;
}
