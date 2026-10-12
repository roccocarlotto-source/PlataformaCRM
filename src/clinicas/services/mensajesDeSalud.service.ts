import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import {
  MENSAJE_DE_CONSULTA_CLINICA_POR_DEFECTO,
  MENSAJE_DE_URGENCIA_POR_DEFECTO,
  incluyeUnTelefono,
} from "../config/mensajesDeSalud";
import {
  TERMINOS_CLINICOS,
  TERMINOS_DE_URGENCIA,
  describirTermino,
  esTerminoDelCodigo,
  normalizarTerminoDeLaClinica,
  type Termino,
} from "../guardrailsDeSalud";
import {
  contarCambiosDeSalud,
  guardarSaludDeLaClinica,
  leerSaludDeLaClinica,
  listarCambiosDeSalud,
  type SaludDeLaClinica,
} from "../repositories/clinicSettings.repository";

// ---------------------------------------------------------------------------
// Los mensajes de salud que edita el ADMIN de una clínica (docs/rubros.md
// §5.3, D11 revisada el 2026-10-12). Las rutas son del módulo agenda_clinica:
// una automotora recibe 403 con motivo RUBRO antes de llegar acá.
//
// Reglas:
//   - el mensaje de urgencia tiene que incluir un teléfono (400 si no);
//   - los términos del código no se sacan: la clínica solo agrega;
//   - null en un texto = el texto por defecto (el valor inicial);
//   - cada guardado que cambia algo deja quién y cuándo en
//     clinic_health_settings_changes, en la misma transacción.
// ---------------------------------------------------------------------------

export const MIN_LARGO_DEL_MENSAJE = 20;
export const MAX_LARGO_DEL_MENSAJE = 500;
export const MIN_LARGO_DEL_TERMINO = 4;
export const MAX_LARGO_DEL_TERMINO = 60;
export const MAX_TERMINOS_POR_LISTA = 100;

export const URGENCIA_SIN_TELEFONO =
  "El mensaje de urgencia tiene que incluir un teléfono de emergencia (por ejemplo, 911).";

export interface CambioDeSaludVisible {
  changedBy: { id: string; fullName: string };
  createdAt: Date;
}

export interface MensajesDeSalud extends SaludDeLaClinica {
  porDefecto: {
    urgencyMessageText: string;
    clinicalMessageText: string;
    urgencyTerms: string[];
    clinicalTerms: string[];
  };
  ultimoCambio: CambioDeSaludVisible | null;
}

function descripcionesDe(lista: readonly Termino[]): string[] {
  return lista.map(describirTermino);
}

export async function obtenerMensajesDeSalud(organizationId: string): Promise<MensajesDeSalud> {
  const [salud, [ultimo]] = await Promise.all([
    leerSaludDeLaClinica(organizationId),
    listarCambiosDeSalud(organizationId, { skip: 0, take: 1 }),
  ]);
  return {
    ...salud,
    porDefecto: {
      urgencyMessageText: MENSAJE_DE_URGENCIA_POR_DEFECTO,
      clinicalMessageText: MENSAJE_DE_CONSULTA_CLINICA_POR_DEFECTO,
      urgencyTerms: descripcionesDe(TERMINOS_DE_URGENCIA),
      clinicalTerms: descripcionesDe(TERMINOS_CLINICOS),
    },
    ultimoCambio: ultimo ? { changedBy: ultimo.changedBy, createdAt: ultimo.createdAt } : null,
  };
}

/** Un texto como se guarda: recortado; vacío o igual al por defecto = null
 *  (seguir con el del código). */
function textoAGuardar(texto: string | null, porDefecto: string): string | null {
  const recortado = texto?.trim() ?? "";
  if (recortado === "" || recortado === porDefecto) return null;
  if (recortado.length < MIN_LARGO_DEL_MENSAJE || recortado.length > MAX_LARGO_DEL_MENSAJE) {
    throw new AppError(
      `Cada mensaje tiene que tener entre ${MIN_LARGO_DEL_MENSAJE} y ${MAX_LARGO_DEL_MENSAJE} caracteres.`,
      400,
    );
  }
  return recortado;
}

/** Los términos como se guardan: normalizados, sin repetidos, sin los que ya
 *  están en la lista del código. Puro. */
export function terminosAGuardar(
  terminos: readonly string[],
  delCodigo: readonly Termino[],
): string[] {
  const resultado: string[] = [];
  for (const termino of terminos) {
    const normalizado = normalizarTerminoDeLaClinica(termino);
    if (normalizado === "") continue;
    if (normalizado.length < MIN_LARGO_DEL_TERMINO || normalizado.length > MAX_LARGO_DEL_TERMINO) {
      throw new AppError(
        `Cada término tiene que tener entre ${MIN_LARGO_DEL_TERMINO} y ${MAX_LARGO_DEL_TERMINO} letras: "${termino.trim()}".`,
        400,
      );
    }
    if (esTerminoDelCodigo(normalizado, delCodigo) || resultado.includes(normalizado)) continue;
    resultado.push(normalizado);
  }
  if (resultado.length > MAX_TERMINOS_POR_LISTA) {
    throw new AppError(
      `Se pueden agregar hasta ${MAX_TERMINOS_POR_LISTA} términos por lista.`,
      400,
    );
  }
  return resultado;
}

/** Lo que valida y normaliza el PUT, sin tocar la base. Puro. */
export function normalizarMensajesDeSalud(input: SaludDeLaClinica): SaludDeLaClinica {
  const urgencyMessageText = textoAGuardar(
    input.urgencyMessageText,
    MENSAJE_DE_URGENCIA_POR_DEFECTO,
  );
  if (urgencyMessageText !== null && !incluyeUnTelefono(urgencyMessageText)) {
    throw new AppError(URGENCIA_SIN_TELEFONO, 400);
  }
  return {
    urgencyMessageText,
    clinicalMessageText: textoAGuardar(
      input.clinicalMessageText,
      MENSAJE_DE_CONSULTA_CLINICA_POR_DEFECTO,
    ),
    extraUrgencyTerms: terminosAGuardar(input.extraUrgencyTerms, TERMINOS_DE_URGENCIA),
    extraClinicalTerms: terminosAGuardar(input.extraClinicalTerms, TERMINOS_CLINICOS),
  };
}

/** { campo: { antes, despues } } con los campos que cambiaron. Puro. */
export function diferenciasDeSalud(
  antes: SaludDeLaClinica,
  despues: SaludDeLaClinica,
): Prisma.InputJsonObject {
  const cambios: Record<string, Prisma.InputJsonObject> = {};
  for (const campo of Object.keys(despues) as (keyof SaludDeLaClinica)[]) {
    if (JSON.stringify(antes[campo]) !== JSON.stringify(despues[campo])) {
      cambios[campo] = { antes: antes[campo], despues: despues[campo] };
    }
  }
  return cambios;
}

export async function guardarMensajesDeSalud(
  organizationId: string,
  changedById: string,
  input: SaludDeLaClinica,
): Promise<MensajesDeSalud> {
  const nuevo = normalizarMensajesDeSalud(input);
  await prisma.$transaction(async (tx) => {
    const actual = await leerSaludDeLaClinica(organizationId, tx);
    const changes = diferenciasDeSalud(actual, nuevo);
    // Sin cambios no hay fila de historial: guardar dos veces lo mismo no es
    // un cambio.
    if (Object.keys(changes).length === 0) return;
    await guardarSaludDeLaClinica(organizationId, nuevo, { changedById, changes }, tx);
  });
  return obtenerMensajesDeSalud(organizationId);
}

export async function historialDeMensajesDeSalud(
  organizationId: string,
  page: number,
  pageSize: number,
) {
  const [data, total] = await Promise.all([
    listarCambiosDeSalud(organizationId, { skip: (page - 1) * pageSize, take: pageSize }),
    contarCambiosDeSalud(organizationId),
  ]);
  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}
