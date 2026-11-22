import type { ContactTerm, HealthProfile, LateBookingReminder, Prisma } from "@prisma/client";
import { prisma, type Db } from "../../lib/prisma";

// ---------------------------------------------------------------------------
// La configuración de una clínica y de sus sedes (docs/rubros.md §1.3,
// migración 20261101120000). Las filas no son obligatorias: si faltan, las
// lecturas devuelven los defaults, que son los mismos que los de las columnas.
// Así nada depende de que la fila exista (una sucursal creada antes de pasar
// a CLINICA no tiene la suya).
//
// organizationId en cada WHERE, como en el resto de los repositorios: la
// configuración de una organización nunca se lee ni se escribe con la de otra.
// ---------------------------------------------------------------------------

export interface ConfiguracionDeClinica {
  contactTerm: ContactTerm;
  healthProfile: HealthProfile;
  privacyNoticeText: string | null;
  privacyPolicyUrl: string | null;
}

export const CONFIGURACION_DE_CLINICA_POR_DEFECTO: ConfiguracionDeClinica = {
  contactTerm: "PACIENTE",
  healthProfile: "MEDICO",
  privacyNoticeText: null,
  privacyPolicyUrl: null,
};

export interface ConfiguracionDeSede {
  reminderHoursBefore: number;
  lateBookingReminder: LateBookingReminder;
  lateBookingHoursBefore: number;
  noResponseTaskHours: number;
  minHoursToChangeBooking: number | null;
}

export const CONFIGURACION_DE_SEDE_POR_DEFECTO: ConfiguracionDeSede = {
  reminderHoursBefore: 24,
  lateBookingReminder: "NO_ENVIAR",
  lateBookingHoursBefore: 2,
  noResponseTaskHours: 4,
  minHoursToChangeBooking: null,
};

/** Crea la fila de la clínica con los defaults, si no la tiene. Idempotente:
 *  el cambio de rubro puede ir y volver, y la fila vieja se conserva. El
 *  perfil de salud solo se fija al crearla (el alta lo elige; sin él, MEDICO,
 *  el default de la columna). El término del contacto, igual: el alta lo
 *  pide (ISSUE-024); sin él, PACIENTE. */
export function crearConfiguracionDeClinica(
  organizationId: string,
  db: Db,
  healthProfile?: HealthProfile,
  contactTerm?: ContactTerm,
) {
  return db.clinicSettings.upsert({
    where: { organizationId },
    create: {
      organizationId,
      ...(healthProfile ? { healthProfile } : {}),
      ...(contactTerm ? { contactTerm } : {}),
    },
    update: {},
  });
}

export async function leerConfiguracionDeClinica(
  organizationId: string,
  db: Db = prisma,
): Promise<ConfiguracionDeClinica> {
  const fila = await db.clinicSettings.findUnique({
    where: { organizationId },
    select: {
      contactTerm: true,
      healthProfile: true,
      privacyNoticeText: true,
      privacyPolicyUrl: true,
    },
  });
  return fila ?? CONFIGURACION_DE_CLINICA_POR_DEFECTO;
}

/** El término del contacto. Crea la fila si faltaba (con los demás campos en
 *  su default). */
export function guardarTerminoDelContacto(
  organizationId: string,
  contactTerm: ContactTerm,
  db: Db = prisma,
) {
  return db.clinicSettings.upsert({
    where: { organizationId },
    create: { organizationId, contactTerm },
    update: { contactTerm },
  });
}

/** R16 (docs/rubros.md §8.1): el aviso de privacidad (texto y link). null =
 *  borrarlo. Crea la fila si faltaba. */
export function guardarAvisoDePrivacidad(
  organizationId: string,
  datos: { privacyNoticeText?: string | null; privacyPolicyUrl?: string | null },
  db: Db = prisma,
) {
  return db.clinicSettings.upsert({
    where: { organizationId },
    create: { organizationId, ...datos },
    update: datos,
  });
}

// ---------------------------------------------------------------------------
// Mensajes de salud editados por el ADMIN (docs/rubros.md §5.3, D11 revisada;
// migración 20261114120000). null en un texto = el del código; las listas son
// SOLO lo que la clínica agregó (los términos del código no se guardan).
// ---------------------------------------------------------------------------

export interface SaludDeLaClinica {
  urgencyMessageText: string | null;
  clinicalMessageText: string | null;
  extraUrgencyTerms: string[];
  extraClinicalTerms: string[];
}

export const SALUD_DE_LA_CLINICA_POR_DEFECTO: SaludDeLaClinica = {
  urgencyMessageText: null,
  clinicalMessageText: null,
  extraUrgencyTerms: [],
  extraClinicalTerms: [],
};

const COLUMNAS_DE_SALUD = {
  urgencyMessageText: true,
  clinicalMessageText: true,
  extraUrgencyTerms: true,
  extraClinicalTerms: true,
} as const;

export async function leerSaludDeLaClinica(
  organizationId: string,
  db: Db = prisma,
): Promise<SaludDeLaClinica> {
  const fila = await db.clinicSettings.findUnique({
    where: { organizationId },
    select: COLUMNAS_DE_SALUD,
  });
  return fila ?? SALUD_DE_LA_CLINICA_POR_DEFECTO;
}

/** Lo que el loop del agente necesita de la salud de una clínica en cada
 *  turno: lo que editó el ADMIN y el perfil de salud (docs/primera-clinica.md
 *  §4), en UNA consulta. El perfil va aparte de SaludDeLaClinica porque esa es
 *  la forma que guarda el ADMIN, y el perfil no lo cambia la clínica. Sin
 *  fila, los defaults: MEDICO, el de siempre. */
export async function leerSaludYPerfilDeLaClinica(
  organizationId: string,
  db: Db = prisma,
): Promise<{ salud: SaludDeLaClinica; perfil: HealthProfile }> {
  const fila = await db.clinicSettings.findUnique({
    where: { organizationId },
    select: { ...COLUMNAS_DE_SALUD, healthProfile: true },
  });
  if (!fila) return { salud: SALUD_DE_LA_CLINICA_POR_DEFECTO, perfil: "MEDICO" };
  const { healthProfile, ...salud } = fila;
  return { salud, perfil: healthProfile };
}

/** Guarda lo nuevo y deja la fila del historial, en la misma transacción
 *  (la recibe en `db`). Crea la fila de la clínica si faltaba. */
export async function guardarSaludDeLaClinica(
  organizationId: string,
  datos: SaludDeLaClinica,
  cambio: { changedById: string; changes: Prisma.InputJsonObject },
  db: Db,
): Promise<void> {
  await db.clinicSettings.upsert({
    where: { organizationId },
    create: { organizationId, ...datos },
    update: datos,
  });
  await db.clinicHealthSettingsChange.create({
    data: { organizationId, changedById: cambio.changedById, changes: cambio.changes },
  });
}

/** Los cambios de la clínica, el más reciente primero, con el nombre de quien
 *  los hizo. */
export function listarCambiosDeSalud(
  organizationId: string,
  paginacion: { skip: number; take: number },
  db: Db = prisma,
) {
  return db.clinicHealthSettingsChange.findMany({
    where: { organizationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: paginacion.skip,
    take: paginacion.take,
    select: {
      id: true,
      changes: true,
      createdAt: true,
      changedBy: { select: { id: true, fullName: true } },
    },
  });
}

export function contarCambiosDeSalud(organizationId: string, db: Db = prisma) {
  return db.clinicHealthSettingsChange.count({ where: { organizationId } });
}

/** Crea la fila de una sede con los defaults. La FK compuesta exige que la
 *  sucursal sea de esta organización. */
export function crearConfiguracionDeSede(organizationId: string, branchId: string, db: Db) {
  return db.clinicBranchSettings.create({ data: { organizationId, branchId } });
}

export async function leerConfiguracionDeSede(
  organizationId: string,
  branchId: string,
  db: Db = prisma,
): Promise<ConfiguracionDeSede> {
  const fila = await db.clinicBranchSettings.findFirst({
    where: { organizationId, branchId },
    select: {
      reminderHoursBefore: true,
      lateBookingReminder: true,
      lateBookingHoursBefore: true,
      noResponseTaskHours: true,
      minHoursToChangeBooking: true,
    },
  });
  return fila ?? CONFIGURACION_DE_SEDE_POR_DEFECTO;
}
