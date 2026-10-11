import type { ContactTerm, LateBookingReminder } from "@prisma/client";
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
  privacyNoticeText: string | null;
  privacyPolicyUrl: string | null;
}

export const CONFIGURACION_DE_CLINICA_POR_DEFECTO: ConfiguracionDeClinica = {
  contactTerm: "PACIENTE",
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
 *  el cambio de rubro puede ir y volver, y la fila vieja se conserva. */
export function crearConfiguracionDeClinica(organizationId: string, db: Db) {
  return db.clinicSettings.upsert({
    where: { organizationId },
    create: { organizationId },
    update: {},
  });
}

export async function leerConfiguracionDeClinica(
  organizationId: string,
  db: Db = prisma,
): Promise<ConfiguracionDeClinica> {
  const fila = await db.clinicSettings.findUnique({
    where: { organizationId },
    select: { contactTerm: true, privacyNoticeText: true, privacyPolicyUrl: true },
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
