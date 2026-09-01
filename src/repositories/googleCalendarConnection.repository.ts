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

// Conexiones de una sucursal que TODAVÍA GUARDAN UN SECRETO — el conteo sobre
// el que decide el RESTRICT de deleteBranch. Exige organizationId además de
// branchId, mismo criterio que countActiveResourcesByBranch: esto decide si una
// escritura procede, así que el aislamiento va en su propio WHERE y no en el
// del caller.
//
// POR refreshToken Y NO POR status — B-9 de docs/auditoria-2026-08-29.md. Lo
// que no puede quedar huérfano al borrar la sucursal es la credencial cifrada:
// sin fila, nadie podría desconectarla ni intentar revocarla nunca más. Y el
// status no la describe: ACTIVE siempre tiene refreshToken (lo exige el CHECK),
// REVOKED nunca (NULL desde markConnectionRevoked), pero ERROR lo CONSERVA a
// propósito (ver markConnectionError). Contar por "status = ACTIVE", como se
// hacía, dejaba borrar una sucursal en ERROR con su token adentro. Filtrar por
// la presencia del secreto captura ACTIVE + ERROR y excluye REVOKED sin
// enumerar statuses, y es lo que se quiere aunque mañana aparezca uno nuevo.
// El nombre sigue la convención de findConnectionWithSecretByBranch: que el
// secreto aparezca en el grep.
export function countConnectionsWithSecretByBranch(
  branchId: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.googleCalendarConnection.count({
    where: { branchId, organizationId, status: "ACTIVE" }, // MUTACIÓN DE VERIFICACIÓN — NO MERGEAR
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
//
// Y TAMBIÉN LIMPIA syncToken Y EL CANAL — B-3 de docs/auditoria-2026-08-29.md.
// El callback de OAuth no tiene forma de saber si la cuenta que acaba de
// autorizar es la misma de la vez anterior (completarConexion usa siempre
// calendarId "primary"), así que toda reconexión se trata como un calendario
// potencialmente distinto — lo único que se puede asumir con seguridad. Antes,
// reconectar con OTRA cuenta dejaba en la fila el estado de sincronización de
// la cuenta vieja, con dos consecuencias reales: el syncToken ajeno producía un
// 410 en el primer sync (recuperable, pero un viaje de más a Google), y el
// canal viejo era peor — findConnectionsNeedingChannel veía un channelId con
// una channelExpiration lejana y NO abría canal para la cuenta nueva hasta que
// venciera el viejo: hasta 7 días sin notificaciones push tras reconectar.
// Los tres campos del canal van juntos, como exige el CHECK
// channel_all_or_none_check; en el create son un no-op (ya nacen NULL).
// ---------------------------------------------------------------------------
export function upsertConnection(datos: DatosDeConexion, db: Db = prisma) {
  const comun = {
    refreshToken: datos.refreshToken,
    calendarId: datos.calendarId,
    status: "ACTIVE" as ConnectionStatus,
    lastErrorAt: null,
    lastErrorMessage: null,
    connectedAt: new Date(),
    syncToken: null,
    channelId: null,
    channelResourceId: null,
    channelExpiration: null,
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
//
// TAMBIÉN syncToken Y EL CANAL VAN A NULL — B-3. El syncToken es lo que pide el
// hallazgo: es estado del calendario de la cuenta que se acaba de desconectar,
// y dejarlo haría que una reconexión futura arranque con un token ajeno (410).
// El canal se limpia acá ADEMÁS de en clearConnectionChannel —que desconectar()
// llama justo después, así que hoy es redundante— por el mismo criterio de todo
// este ciclo de auditoría: la escritura misma es la garantía. "REVOKED" queda
// definido por esta única función como "sin credencial y sin ningún estado de
// la cuenta" sin depender de que el próximo caller, si alguna vez hay otro, se
// acuerde de llamar también a clearConnectionChannel. Los tres campos del canal
// juntos, por el CHECK channel_all_or_none_check.
export function markConnectionRevoked(branchId: string, organizationId: string, db: Db = prisma) {
  return db.googleCalendarConnection.updateMany({
    where: { branchId, organizationId },
    data: {
      status: "REVOKED",
      refreshToken: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      syncToken: null,
      channelId: null,
      channelResourceId: null,
      channelExpiration: null,
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

// ---------------------------------------------------------------------------
// Canal de notificaciones push y sincronización incremental (paso 4)
// ---------------------------------------------------------------------------

// La búsqueda del webhook: llega X-Goog-Channel-ID y hay que encontrar la
// conexión. SIN el secreto — B-16 de docs/auditoria-2026-08-29.md. El
// comentario original decía que devolvía la fila completa "porque el camino que
// sigue necesita el refresh token para llamar a events.list", y eso era falso:
// el flujo del webhook (googleCalendarSync.service.ts) usa organizationId,
// branchId y syncToken, y el access token lo consigue obtenerAccessToken con su
// PROPIA lectura vía findConnectionWithSecretByBranch y su propio descifrado.
// El select explícito es la defensa que no depende de que alguien se acuerde
// (ver findConnectionWithSecretByBranch arriba: traer el secreto exige llamar a
// la función que lo dice en el nombre).
//
// SIN organizationId en el WHERE, a diferencia de todo el resto de este archivo,
// y es deliberado: el webhook no tiene organización todavía —no hay JWT, Google
// no lo reenvía— así que el channelId ES la clave de entrada. Lo que sostiene el
// aislamiento es el UNIQUE de la columna (una fila o ninguna) más la
// verificación del token firmado, que ocurre ANTES de llegar acá y que afirma a
// qué organización pertenece ese canal. El caller compara las dos cosas.
export function findConnectionByChannelId(channelId: string, db: Db = prisma) {
  return db.googleCalendarConnection.findUnique({
    where: { channelId },
    select: {
      organizationId: true,
      branchId: true,
      syncToken: true,
      // La zona de la sucursal viaja con la conexión —B-6— para que la
      // sincronización lea los eventos de día completo como medianoche de esa
      // zona. Por la relación, en la misma consulta: sin un getBranchById aparte.
      branch: { select: { timezone: true } },
    },
  });
}

// Las conexiones ACTIVE que necesitan un canal: o no tienen ninguno, o el que
// tienen vence dentro del margen.
//
// LOS DOS CASOS SE TRATAN IGUAL a propósito. "Sin canal" no es un estado
// excepcional que merezca su propio camino: es lo que queda después de conectar
// por OAuth (el paso 2 no crea canales), después de un 410 que obligó a limpiar,
// y después de que un canal venza sin renovarse. Una sola consulta y una sola
// rama en el worker.
//
// `alcance.organizationId` es SOLO para tests (A-8 de
// docs/auditoria-2026-08-29.md): el worker de producción barre TODAS las
// organizaciones, que es su trabajo; un test que ejercita el barrido tiene que
// poder acotarlo a la organización que él mismo montó, porque la suite corre en
// paralelo contra una base compartida y sin esto el barrido de un archivo
// toca las conexiones de los demás. Sin el parámetro, el comportamiento es el
// de siempre — es la única excepción al "organizationId en todo WHERE" de este
// archivo, y está justificada por lo mismo que findConnectionByChannelId: acá
// no hay tenant que pida, es el proceso.
//
// El select es exactamente lo que renovarCanal pide en su parámetro y lo que el
// worker loguea — B-16: el refresh token no viaja por acá; renovarCanal lo
// obtiene por su cuenta vía obtenerAccessToken.
export function findConnectionsNeedingChannel(
  limiteDeVencimiento: Date,
  alcance: { organizationId?: string } = {},
  db: Db = prisma,
) {
  return db.googleCalendarConnection.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ channelId: null }, { channelExpiration: { lt: limiteDeVencimiento } }],
      ...(alcance.organizationId ? { organizationId: alcance.organizationId } : {}),
    },
    select: {
      organizationId: true,
      branchId: true,
      channelId: true,
      channelResourceId: true,
    },
  });
}

export interface DatosDeCanal {
  channelId: string;
  channelResourceId: string;
  channelExpiration: Date;
}

// Guarda el canal recién creado. Los tres campos van JUNTOS — el CHECK de la
// migración lo exige, y el motivo es que un canal a medias es inutilizable de
// forma silenciosa (sin resourceId no se puede detener nunca).
//
// SOLO SOBRE UNA CONEXIÓN ACTIVE — B-7 de docs/auditoria-2026-08-29.md. Entre
// que renovarCanal leyó la conexión (y obtenerAccessToken validó el status) y
// que llega acá hay una llamada a Google en el medio; si desconectar() corrió
// en esa ventana, la fila ya es REVOKED y escribirle el canal la dejaría con
// uno que nadie renueva ni cierra hasta vencer (findConnectionsNeedingChannel
// solo mira ACTIVE). La escritura misma es la garantía, no la lectura de
// arriba — mismo criterio que B-12 y B-27. Devuelve `count`: 0 significa que
// la conexión dejó de estar activa y el caller tiene que reaccionar.
export function setConnectionChannel(
  branchId: string,
  organizationId: string,
  datos: DatosDeCanal,
  db: Db = prisma,
) {
  return db.googleCalendarConnection.updateMany({
    where: { branchId, organizationId, status: "ACTIVE" },
    data: {
      channelId: datos.channelId,
      channelResourceId: datos.channelResourceId,
      channelExpiration: datos.channelExpiration,
    },
  });
}

// Limpia el canal (los tres campos a la vez, por el CHECK). NO toca syncToken:
// el token de sincronización sobrevive al canal y sigue siendo válido — perderlo
// forzaría una resincronización completa sin ninguna necesidad.
export function clearConnectionChannel(branchId: string, organizationId: string, db: Db = prisma) {
  return db.googleCalendarConnection.updateMany({
    where: { branchId, organizationId },
    data: { channelId: null, channelResourceId: null, channelExpiration: null },
  });
}

// El token de la PRÓXIMA sincronización. Se guarda al final del procesamiento,
// nunca antes: si algo falla en el medio, el token viejo sigue en la fila y la
// próxima notificación reprocesa los mismos cambios. Reprocesar es inofensivo
// —cancelar un Booking ya cancelado no hace nada— y perder cambios no lo es.
export function setConnectionSyncToken(
  branchId: string,
  organizationId: string,
  syncToken: string,
  db: Db = prisma,
) {
  return db.googleCalendarConnection.updateMany({
    where: { branchId, organizationId },
    data: { syncToken },
  });
}
