import type { ConnectionStatus, Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// GoogleCalendarConnection — acceso a datos (P2.1, paso 2).
//
// SIN deletedAt en ningún WHERE, a diferencia del resto de los repositorios de
// este módulo: esta tabla no tiene soft delete. Su ciclo de vida completo lo
// describe `status`, y una conexión "borrada" no significa nada distinto de una
// REVOKED — ver el comentario de la migración.
// ---------------------------------------------------------------------------

// Los campos que SÍ pueden salir por la API. refreshToken NO está acá, y esa
// ausencia es la defensa: cualquier lectura que use este `select` es incapaz de
// filtrar el token, aunque quien la escriba se olvide de pensarlo.
//
// Es el mismo criterio con el que apiKey nunca devuelve keyHash, y se aplica
// acá con un `select` explícito en vez de con un `delete` sobre el objeto: un
// borrado posterior depende de que alguien se acuerde de hacerlo en cada camino
// nuevo; un select no.
export const CAMPOS_PUBLICOS = {
  id: true,
  organizationId: true,
  branchId: true,
  calendarId: true,
  status: true,
  lastErrorAt: true,
  lastErrorMessage: true,
  connectedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.GoogleCalendarConnectionSelect;

export type ConexionPublica = Prisma.GoogleCalendarConnectionGetPayload<{
  select: typeof CAMPOS_PUBLICOS;
}>;

// Lectura para exponer: nunca trae el token.
export function findConnectionByBranch(
  branchId: string,
  organizationId: string,
  db: Db = prisma,
): Promise<ConexionPublica | null> {
  return db.googleCalendarConnection.findFirst({
    where: { branchId, organizationId },
    select: CAMPOS_PUBLICOS,
  });
}

// Lectura para USAR el token. Función aparte y con nombre explícito: que traer
// el secreto exija llamar a algo que se llama "conSecreto" es lo que hace que
// aparezca en un grep y en una revisión. Si fuera un parámetro booleano de la
// función de arriba, el punto donde el token empieza a viajar sería invisible.
export function findConnectionWithSecretByBranch(
  branchId: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.googleCalendarConnection.findFirst({ where: { branchId, organizationId } });
}

// Conexiones ACTIVE de una sucursal — el conteo sobre el que decide el RESTRICT
// de deleteBranch. Exige organizationId además de branchId, mismo criterio que
// countActiveResourcesByBranch: esto decide si una escritura procede, así que el
// aislamiento va en su propio WHERE y no en el del caller.
//
// Solo ACTIVE: una conexión REVOKED o ERROR no bloquea el borrado de la
// sucursal. Ya no hay nada conectado que se pueda perder.
export function countActiveConnectionsByBranch(
  branchId: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.googleCalendarConnection.count({
    where: { branchId, organizationId, status: "ACTIVE" },
  });
}

export interface DatosDeConexion {
  organizationId: string;
  branchId: string;
  refreshToken: string;
  calendarId: string;
}

// ---------------------------------------------------------------------------
// El upsert que implementa "reconectar actualiza, no duplica".
//
// POR QUÉ UN upsert Y NO UN find + if: entre leer y escribir hay una ventana, y
// dos callbacks concurrentes de la misma sucursal caerían los dos en la rama
// "no existe" y el segundo INSERT moriría contra el UNIQUE con un error crudo de
// Prisma. El upsert resuelve la carrera en una sola sentencia, apoyado en el
// mismo índice único.
//
// EL update LIMPIA lastErrorAt/lastErrorMessage a propósito: reconectar es
// exactamente el acto que resuelve el ERROR, y dejar el motivo viejo colgando
// haría que una conexión sana se leyera como una rota. connectedAt se pisa con
// la fecha de ESTA autorización; createdAt no se toca, así que sigue diciendo
// cuándo esta sucursal conectó Google por primera vez.
// ---------------------------------------------------------------------------
export function upsertConnection(datos: DatosDeConexion, db: Db = prisma) {
  const comun = {
    refreshToken: datos.refreshToken,
    calendarId: datos.calendarId,
    status: "ACTIVE" as ConnectionStatus,
    lastErrorAt: null,
    lastErrorMessage: null,
    connectedAt: new Date(),
  };

  return db.googleCalendarConnection.upsert({
    where: {
      organizationId_branchId: { organizationId: datos.organizationId, branchId: datos.branchId },
    },
    create: { organizationId: datos.organizationId, branchId: datos.branchId, ...comun },
    update: comun,
    select: CAMPOS_PUBLICOS,
  });
}

// Desconexión deliberada. EL TOKEN SE PONE EN NULL, no se deja donde estaba: una
// conexión revocada no tiene credencial, y dejarla guardada significaría que un
// volcado de la base arrastra secretos de sucursales que ya se desconectaron. El
// CHECK de la migración permite el NULL justamente en los estados que no son
// ACTIVE.
export function markConnectionRevoked(branchId: string, organizationId: string, db: Db = prisma) {
  return db.googleCalendarConnection.updateMany({
    where: { branchId, organizationId },
    data: {
      status: "REVOKED",
      refreshToken: null,
      lastErrorAt: null,
      lastErrorMessage: null,
    },
  });
}

// Google rechazó el grant. EL TOKEN SE CONSERVA, a diferencia de la revocación:
// puede tratarse de algo que se resuelva del lado de Google, y tirarlo obligaría
// a reautorizar por un problema que quizás no era permanente.
//
// El motivo se trunca a 500 para entrar en la columna. Truncar acá y no confiar
// en que el texto sea corto es la diferencia entre registrar el error y que la
// escritura del error falle por su propio largo — que dejaría la conexión sin
// marcar y sin ninguna pista de por qué.
export function markConnectionError(
  branchId: string,
  organizationId: string,
  motivo: string,
  db: Db = prisma,
) {
  return db.googleCalendarConnection.updateMany({
    where: { branchId, organizationId },
    data: {
      status: "ERROR",
      lastErrorAt: new Date(),
      lastErrorMessage: motivo.slice(0, 500),
    },
  });
}
