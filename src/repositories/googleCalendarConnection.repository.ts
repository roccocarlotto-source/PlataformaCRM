import type { ConnectionStatus, Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// R7 (docs/rubros.md §4.6, D18): EL CANAL Y EL syncToken VIVEN EN
// google_calendar_channels. Las funciones de este archivo conservan su firma
// y su comportamiento, y por adentro:
//
//   - LEEN la tabla nueva (la fila del calendario de la conexión);
//   - ESCRIBEN la tabla nueva y, EN ESPEJO y en la misma transacción, las
//     cuatro columnas viejas de google_calendar_connections.
//
// El espejo es lo que hace reversible a R7: el código de antes lee las
// columnas viejas, y como están al día, volver a él no pierde ningún canal
// renovado ni ningún syncToken. Se va con R21, junto con las columnas.
// ---------------------------------------------------------------------------

// Corre `fn` en una transacción. Si quien llama ya pasó una (upsertConnection
// la recibe del callback de OAuth), usa esa: Prisma no anida transacciones.
function enTransaccion<T>(db: Db, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return "$transaction" in db ? db.$transaction(fn) : fn(db);
}

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
// POR refreshToken Y NO POR status — B-9 de docs-privados/auditoria-2026-08-29.md (local, no está en GitHub). Lo
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
    where: { branchId, organizationId, refreshToken: { not: null } },
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
// Y TAMBIÉN LIMPIA syncToken Y EL CANAL — B-3 de docs-privados/auditoria-2026-08-29.md (local, no está en GitHub).
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
//
// R7: las filas de canal de la sucursal (tabla nueva) se BORRAN en la misma
// transacción, por el mismo motivo; las columnas viejas se limpian como
// siempre, que es su espejo.
// ---------------------------------------------------------------------------
export function upsertConnection(datos: DatosDeConexion, db: Db = prisma) {
  return enTransaccion(db, async (tx) => {
    await tx.googleCalendarChannel.deleteMany({
      where: { organizationId: datos.organizationId, branchId: datos.branchId },
    });
    return upsertConnectionRow(datos, tx);
  });
}

function upsertConnectionRow(datos: DatosDeConexion, db: Db) {
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
// El canal se limpia ACÁ, en la misma escritura, por el mismo criterio de todo
// este ciclo de auditoría: la escritura misma es la garantía. "REVOKED" queda
// definido por esta única función como "sin credencial y sin ningún estado de
// la cuenta" sin depender de que el caller se acuerde de llamar también a
// clearConnectionChannel — cuando se escribió esto, desconectar() la llamaba
// justo después y la redundancia era deliberada; esa segunda llamada (las "dos
// escrituras sin transacción" de B-8) se sacó después porque ya no cambiaba
// nada. Los tres campos del canal juntos, por el CHECK
// channel_all_or_none_check.
//
// R7: las filas de canal de la sucursal se borran en la misma transacción.
export function markConnectionRevoked(branchId: string, organizationId: string, db: Db = prisma) {
  return enTransaccion(db, async (tx) => {
    const resultado = await tx.googleCalendarConnection.updateMany({
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
    await tx.googleCalendarChannel.deleteMany({ where: { branchId, organizationId } });
    return resultado;
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
//
// DESDE R7 sobre google_calendar_channels (ver el encabezado del archivo): se
// lee la tabla nueva y se escribe la nueva más el espejo de las columnas
// viejas. La fila es la del calendario de la conexión de la sucursal; en R7 no
// hay otras.
// ---------------------------------------------------------------------------

const SELECT_DEL_WEBHOOK = {
  organizationId: true,
  branchId: true,
  syncToken: true,
  // La zona de la sucursal viaja con la conexión —B-6— para que la
  // sincronización lea los eventos de día completo como medianoche de esa
  // zona. Por la relación, en la misma consulta: sin un getBranchById aparte.
  branch: { select: { timezone: true } },
} as const;

// La búsqueda del webhook: llega X-Goog-Channel-ID y hay que encontrar la
// sucursal. SIN el secreto — B-16 de docs-privados/auditoria-2026-08-29.md
// (local, no está en GitHub): el flujo del webhook (googleCalendarSync.service.ts)
// usa organizationId, branchId y syncToken, y el access token lo consigue
// obtenerAccessToken con su PROPIA lectura vía findConnectionWithSecretByBranch.
//
// SIN organizationId en el WHERE, a diferencia de todo el resto de este archivo,
// y es deliberado: el webhook no tiene organización todavía —no hay JWT, Google
// no lo reenvía— así que el channelId ES la clave de entrada. Lo que sostiene el
// aislamiento es el UNIQUE de la columna (una fila o ninguna) más la
// verificación del token firmado, que ocurre ANTES de llegar acá y que afirma a
// qué organización pertenece ese canal. El caller compara las dos cosas.
//
// R7: primero la tabla nueva. Si no está ahí, las columnas viejas: es el canal
// que abrió el código de antes entre que se aplicó la migración y se desplegó
// R7, y que todavía no reconcilió el worker. Mismo UNIQUE, mismo criterio.
export async function findConnectionByChannelId(channelId: string, db: Db = prisma) {
  const canal = await db.googleCalendarChannel.findUnique({
    where: { channelId },
    select: SELECT_DEL_WEBHOOK,
  });
  if (canal) {
    return canal;
  }
  return db.googleCalendarConnection.findUnique({
    where: { channelId },
    select: SELECT_DEL_WEBHOOK,
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
// docs-privados/auditoria-2026-08-29.md (local, no está en GitHub)): el worker
// de producción barre TODAS las organizaciones, que es su trabajo; un test que
// ejercita el barrido tiene que poder acotarlo a la organización que él mismo
// montó, porque la suite corre contra una base compartida.
//
// El select es exactamente lo que renovarCanal pide en su parámetro y lo que el
// worker loguea — B-16: el refresh token no viaja por acá.
//
// R7: el canal sale de google_calendar_channels. Dos lecturas (las conexiones
// ACTIVE y sus canales) y el cruce en memoria: es una fila por sucursal, y
// "sin fila de canal" es lo mismo que "sin canal".
export async function findConnectionsNeedingChannel(
  limiteDeVencimiento: Date,
  alcance: { organizationId?: string } = {},
  db: Db = prisma,
) {
  const conexiones = await db.googleCalendarConnection.findMany({
    where: {
      status: "ACTIVE",
      ...(alcance.organizationId ? { organizationId: alcance.organizationId } : {}),
    },
    select: { organizationId: true, branchId: true, calendarId: true },
  });
  if (conexiones.length === 0) {
    return [];
  }

  const canales = await db.googleCalendarChannel.findMany({
    where: {
      OR: conexiones.map((c) => ({
        organizationId: c.organizationId,
        branchId: c.branchId,
        calendarId: c.calendarId,
      })),
    },
    select: {
      organizationId: true,
      branchId: true,
      channelId: true,
      channelResourceId: true,
      channelExpiration: true,
    },
  });
  const canalDe = new Map(canales.map((c) => [`${c.organizationId}:${c.branchId}`, c]));

  return conexiones
    .map((conexion) => ({
      conexion,
      canal: canalDe.get(`${conexion.organizationId}:${conexion.branchId}`),
    }))
    .filter(
      ({ canal }) =>
        !canal ||
        canal.channelId === null ||
        canal.channelExpiration === null ||
        canal.channelExpiration < limiteDeVencimiento,
    )
    .map(({ conexion, canal }) => ({
      organizationId: conexion.organizationId,
      branchId: conexion.branchId,
      channelId: canal?.channelId ?? null,
      channelResourceId: canal?.channelResourceId ?? null,
    }));
}

// El canal vigente del calendario de la conexión de una sucursal, para
// cerrarlo al desconectar. Sin el secreto.
export async function findCanalDeLaSucursal(
  branchId: string,
  organizationId: string,
  db: Db = prisma,
): Promise<{ channelId: string | null; channelResourceId: string | null } | null> {
  const conexion = await db.googleCalendarConnection.findFirst({
    where: { branchId, organizationId },
    select: { calendarId: true },
  });
  if (!conexion) {
    return null;
  }
  return db.googleCalendarChannel.findUnique({
    where: {
      organizationId_branchId_calendarId: {
        organizationId,
        branchId,
        calendarId: conexion.calendarId,
      },
    },
    select: { channelId: true, channelResourceId: true },
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
// SOLO SOBRE UNA CONEXIÓN ACTIVE — B-7 de docs-privados/auditoria-2026-08-29.md
// (local, no está en GitHub). Entre que renovarCanal leyó la conexión y que
// llega acá hay una llamada a Google en el medio; si desconectar() corrió en
// esa ventana, la fila ya es REVOKED y escribirle el canal la dejaría con uno
// que nadie renueva ni cierra hasta vencer. La escritura misma es la garantía,
// no la lectura de arriba. Devuelve `count`: 0 significa que la conexión dejó
// de estar activa y el caller tiene que reaccionar.
//
// R7: el espejo en la conexión va PRIMERO y es el que decide (su WHERE con
// status ACTIVE es el de B-7, y deja la fila bloqueada hasta el final de la
// transacción); recién con count 1 se escribe la fila del canal.
export function setConnectionChannel(
  branchId: string,
  organizationId: string,
  datos: DatosDeCanal,
  db: Db = prisma,
) {
  return enTransaccion(db, async (tx) => {
    const espejo = await tx.googleCalendarConnection.updateMany({
      where: { branchId, organizationId, status: "ACTIVE" },
      data: {
        channelId: datos.channelId,
        channelResourceId: datos.channelResourceId,
        channelExpiration: datos.channelExpiration,
      },
    });
    if (espejo.count !== 1) {
      return espejo;
    }
    await escribirCanal(branchId, organizationId, tx, {
      channelId: datos.channelId,
      channelResourceId: datos.channelResourceId,
      channelExpiration: datos.channelExpiration,
    });
    return espejo;
  });
}

// Limpia el canal (los tres campos a la vez, por el CHECK). NO toca syncToken:
// el token de sincronización sobrevive al canal y sigue siendo válido — perderlo
// forzaría una resincronización completa sin ninguna necesidad.
export function clearConnectionChannel(branchId: string, organizationId: string, db: Db = prisma) {
  return enTransaccion(db, async (tx) => {
    const espejo = await tx.googleCalendarConnection.updateMany({
      where: { branchId, organizationId },
      data: { channelId: null, channelResourceId: null, channelExpiration: null },
    });
    await tx.googleCalendarChannel.updateMany({
      where: { branchId, organizationId },
      data: { channelId: null, channelResourceId: null, channelExpiration: null },
    });
    return espejo;
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
  return enTransaccion(db, async (tx) => {
    const espejo = await tx.googleCalendarConnection.updateMany({
      where: { branchId, organizationId },
      data: { syncToken },
    });
    if (espejo.count !== 1) {
      return espejo;
    }
    await escribirCanal(branchId, organizationId, tx, { syncToken });
    return espejo;
  });
}

interface CamposDelCanal {
  channelId?: string | null;
  channelResourceId?: string | null;
  channelExpiration?: Date | null;
  syncToken?: string | null;
}

// La escritura de la fila del canal del calendario de la conexión: la crea si
// no existe (una conexión sin canal ni syncToken no tiene fila) y si existe
// actualiza solo los campos dados. Siempre dentro de la transacción del
// espejo, después de él: la fila de la conexión ya está bloqueada.
async function escribirCanal(
  branchId: string,
  organizationId: string,
  tx: Prisma.TransactionClient,
  datos: CamposDelCanal,
) {
  const conexion = await tx.googleCalendarConnection.findFirstOrThrow({
    where: { branchId, organizationId },
    select: { calendarId: true },
  });
  await tx.googleCalendarChannel.upsert({
    where: {
      organizationId_branchId_calendarId: {
        organizationId,
        branchId,
        calendarId: conexion.calendarId,
      },
    },
    create: {
      organizationId,
      branchId,
      calendarId: conexion.calendarId,
      channelId: datos.channelId ?? null,
      channelResourceId: datos.channelResourceId ?? null,
      channelExpiration: datos.channelExpiration ?? null,
      syncToken: datos.syncToken ?? null,
    },
    update: datos,
  });
}

// ---------------------------------------------------------------------------
// La reconciliación de la transición (R7). Copia a google_calendar_channels lo
// que el código de ANTES de R7 haya escrito en las columnas viejas y la tabla
// nueva todavía no tenga: un canal renovado o un syncToken avanzado entre que
// se aplicó la migración y se desplegó R7 (o durante un rollback del código).
//
// Con el código de R7 las dos están siempre iguales —el espejo va en la misma
// transacción—, así que en régimen esto no cambia ninguna fila. Corre al
// empezar cada pasada del worker de renovación; es idempotente y barata (una
// fila por sucursal). Se va con R21.
//
// LAS COLUMNAS VIEJAS GANAN cuando difieren, y es correcto: la única forma de
// que difieran es que las haya escrito el código viejo, después.
//
// FOR UPDATE sobre las conexiones: toma los locks en el mismo orden que las
// escrituras de arriba (primero la conexión, después el canal), así que no
// puede pisar con un valor viejo una escritura en curso ni hacer deadlock con
// ella. `organizationId` acota la pasada, solo para tests (como
// findConnectionsNeedingChannel).
// ---------------------------------------------------------------------------
export async function reconciliarCanalesConLasColumnasViejas(
  alcance: { organizationId?: string } = {},
  db: Db = prisma,
): Promise<{ creados: number; actualizados: number }> {
  const organizacion = alcance.organizationId ?? null;
  return enTransaccion(db, async (tx) => {
    const actualizados = await tx.$executeRaw`
      WITH conexiones AS (
        SELECT organization_id, branch_id, calendar_id,
               channel_id, channel_resource_id, channel_expiration, sync_token
        FROM google_calendar_connections
        WHERE ${organizacion}::uuid IS NULL OR organization_id = ${organizacion}::uuid
        FOR UPDATE
      )
      UPDATE google_calendar_channels g
      SET channel_id = c.channel_id,
          channel_resource_id = c.channel_resource_id,
          channel_expiration = c.channel_expiration,
          sync_token = c.sync_token,
          updated_at = CURRENT_TIMESTAMP
      FROM conexiones c
      WHERE g.organization_id = c.organization_id
        AND g.branch_id = c.branch_id
        AND g.calendar_id = c.calendar_id
        AND (g.channel_id, g.channel_resource_id, g.channel_expiration, g.sync_token)
            IS DISTINCT FROM
            (c.channel_id, c.channel_resource_id, c.channel_expiration, c.sync_token)`;
    const creados = await tx.$executeRaw`
      INSERT INTO google_calendar_channels (
        organization_id, branch_id, calendar_id,
        channel_id, channel_resource_id, channel_expiration, sync_token,
        created_at, updated_at
      )
      SELECT c.organization_id, c.branch_id, c.calendar_id,
             c.channel_id, c.channel_resource_id, c.channel_expiration, c.sync_token,
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM google_calendar_connections c
      WHERE (c.channel_id IS NOT NULL OR c.sync_token IS NOT NULL)
        AND (${organizacion}::uuid IS NULL OR c.organization_id = ${organizacion}::uuid)
      ON CONFLICT (organization_id, branch_id, calendar_id) DO NOTHING`;
    return { creados, actualizados };
  });
}
