import type { ConnectionStatus, Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// MetaPageConnection — acceso a datos (ítem 169). Mismo esqueleto que
// googleCalendarConnection.repository.ts, con UNA diferencia: la conexión es
// por ORGANIZACIÓN, no por sucursal, así que todo se busca por organizationId.
// Nada llama todavía a estas funciones: las usa el OAuth del ítem 170.
//
// SIN deletedAt en ningún WHERE: la tabla no tiene soft delete. Su ciclo de
// vida completo lo describe `status`, igual que la conexión de Google.
//
// ESTE REPOSITORIO NO CIFRA NI DESCIFRA: recibe y devuelve el token tal cual
// está en la columna, o sea CIFRADO. Cifrar con getCifrador() antes de
// escribir y descifrar después de leer es trabajo del service, igual que en
// googleCalendarConnection.service.ts.
// ---------------------------------------------------------------------------

// Los campos que SÍ pueden salir por la API. pageAccessToken NO está acá, y
// esa ausencia es la defensa: cualquier lectura que use este `select` es
// incapaz de filtrar el token, aunque quien la escriba se olvide de pensarlo.
// Mismo criterio que CAMPOS_PUBLICOS de la conexión de Google.
export const CAMPOS_PUBLICOS = {
  id: true,
  organizationId: true,
  pageId: true,
  instagramBusinessAccountId: true,
  status: true,
  lastErrorAt: true,
  lastErrorMessage: true,
  connectedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.MetaPageConnectionSelect;

export type ConexionMetaPublica = Prisma.MetaPageConnectionGetPayload<{
  select: typeof CAMPOS_PUBLICOS;
}>;

// Lectura para exponer: nunca trae el token.
export function findMetaConnectionByOrganization(
  organizationId: string,
  db: Db = prisma,
): Promise<ConexionMetaPublica | null> {
  return db.metaPageConnection.findUnique({
    where: { organizationId },
    select: CAMPOS_PUBLICOS,
  });
}

// Lectura para USAR el token. Función aparte y con nombre explícito, mismo
// motivo que findConnectionWithSecretByBranch: que traer el secreto exija
// llamar a algo que dice "WithSecret" es lo que lo hace visible en un grep y
// en una revisión.
export function findMetaConnectionWithSecretByOrganization(
  organizationId: string,
  db: Db = prisma,
) {
  return db.metaPageConnection.findUnique({ where: { organizationId } });
}

export interface DatosDeConexionMeta {
  organizationId: string;
  pageId: string;
  // YA CIFRADO con getCifrador().encrypt — ver el encabezado.
  pageAccessToken: string;
  instagramBusinessAccountId: string | null;
}

// "Reconectar actualiza, no duplica", con el mismo upsert que la conexión de
// Google y por el mismo motivo: dos callbacks concurrentes de la misma
// organización caerían los dos en "no existe" con un find + if, y el segundo
// moriría contra el UNIQUE de organization_id. El upsert lo resuelve en una
// sentencia.
//
// El update LIMPIA lastErrorAt/lastErrorMessage (reconectar es el acto que
// resuelve el ERROR) y pisa connectedAt; createdAt no se toca.
//
// Reconectar puede CAMBIAR de página (el negocio eligió otra): por eso pageId
// e instagramBusinessAccountId van en el update. Si la página nueva ya la
// tiene OTRA organización, es P2002 sobre page_id — lo traduce el service del
// ítem 170, que es quien sabe qué decirle al usuario.
export function upsertMetaConnection(datos: DatosDeConexionMeta, db: Db = prisma) {
  const comun = {
    pageId: datos.pageId,
    pageAccessToken: datos.pageAccessToken,
    instagramBusinessAccountId: datos.instagramBusinessAccountId,
    status: "ACTIVE" as ConnectionStatus,
    lastErrorAt: null,
    lastErrorMessage: null,
    connectedAt: new Date(),
  };

  return db.metaPageConnection.upsert({
    where: { organizationId: datos.organizationId },
    create: { organizationId: datos.organizationId, ...comun },
    update: comun,
    select: CAMPOS_PUBLICOS,
  });
}

// Desconexión deliberada. EL TOKEN SE PONE EN NULL, no se deja donde estaba:
// una conexión revocada no tiene credencial, y dejarla guardada significaría
// que un volcado de la base arrastra secretos de organizaciones que ya se
// desconectaron. El CHECK de la migración permite el NULL justamente en los
// estados que no son ACTIVE.
export function markMetaConnectionRevoked(organizationId: string, db: Db = prisma) {
  return db.metaPageConnection.updateMany({
    where: { organizationId },
    data: {
      status: "REVOKED",
      pageAccessToken: null,
      lastErrorAt: null,
      lastErrorMessage: null,
    },
  });
}

// Meta rechazó el token. EL TOKEN SE CONSERVA, a diferencia de la revocación:
// puede ser algo que se resuelva del lado de Meta, y tirarlo obligaría a
// reautorizar por un problema que quizás no era permanente.
//
// El motivo se trunca a 500 para entrar en la columna: truncar acá es la
// diferencia entre registrar el error y que la escritura del error falle por
// su propio largo.
export function markMetaConnectionError(organizationId: string, motivo: string, db: Db = prisma) {
  return db.metaPageConnection.updateMany({
    where: { organizationId },
    data: {
      status: "ERROR",
      lastErrorAt: new Date(),
      lastErrorMessage: motivo.slice(0, 500),
    },
  });
}
