import { Prisma } from "@prisma/client";
import { logger } from "../lib/logger";
import { findOrganizationById } from "../repositories/organization.repository";
import {
  findMetaConnectionByOrganization,
  findMetaConnectionWithSecretByOrganization,
  markMetaConnectionError,
  markMetaConnectionRevoked,
  upsertMetaConnection,
  type ConexionMetaPublica,
} from "../repositories/metaPageConnection.repository";
import { AppError } from "../utils/AppError";
import { getCifrador } from "../utils/encryption";
import { consumirMetaState, firmarMetaState, verificarMetaState } from "../utils/metaOauthState";
import { getClienteMetaOAuth, MetaAuthError, type ClienteMetaOAuth } from "./metaOAuth.service";

// ---------------------------------------------------------------------------
// Conexión de una ORGANIZACIÓN con su página de Facebook (ítem 170; paso 2 de 5
// de los canales Instagram + Messenger).
//
// Calco de googleCalendarConnection.service.ts y con el mismo rol: es el
// archivo que CRUZA LOS DOS MUNDOS — habla con metaOAuth.service.ts (que no
// sabe nada de Postgres), cifra el Page access token y lo guarda con
// metaPageConnection.repository.ts (que no cifra nada).
//
// LA DIFERENCIA ESTRUCTURAL CON GOOGLE: la conexión es POR ORGANIZACIÓN, no por
// sucursal (meta_page_connections.organization_id es UNIQUE desde el ítem 169).
// Por eso no hay branchId en ninguna firma, ni en el state, ni lock de
// sucursal: el UNIQUE y el upsert del repositorio alcanzan.
//
// Desde el ítem 171 completarConexion además suscribe la página al webhook de
// la app (POST /{page-id}/subscribed_apps); recibir los mensajes es
// metaWebhook.service.ts.
//
// Desde el ítem 172, obtenerTokenParaEnviar le da al worker el Page token en
// claro para mandar la respuesta, y marcarTokenRechazado lleva la conexión a
// ERROR cuando Meta lo rechaza.
//
// QUÉ NO ESTÁ ACÁ, y no es un olvido: la pantalla del CRM — ítem 173.
// ---------------------------------------------------------------------------

// La inyección existe para los tests: producción no pasa nada y usa el cliente
// real. Mismo criterio que ClienteInyectado en el service de Google.
type ClienteInyectado = ClienteMetaOAuth | undefined;

function resolverCliente(cliente: ClienteInyectado): ClienteMetaOAuth {
  return cliente ?? getClienteMetaOAuth();
}

// 404 si la organización no existe o está dada de baja. Es el equivalente de
// getBranchById en el flujo de Google: ata el flujo a una organización real.
async function asegurarOrganizacion(organizationId: string): Promise<void> {
  const organizacion = await findOrganizationById(organizationId);

  if (!organizacion || organizacion.deletedAt) {
    throw new AppError("Organización no encontrada", 404);
  }
}

// ---------------------------------------------------------------------------
// 1. Iniciar la conexión
// ---------------------------------------------------------------------------

export interface InicioDeConexionMeta {
  authorizationUrl: string;
}

// DEVUELVE LA URL, NO UN 302, por el mismo motivo mecánico que
// iniciarConexion() de Google: el endpoint corre detrás de `authenticate`, y un
// navegador siguiendo una redirección no reenvía el header Authorization. El
// frontend hace `window.location.href = authorizationUrl`.
export async function iniciarConexion(
  auth: { organizationId: string; userId: string },
  cliente?: ClienteInyectado,
): Promise<InicioDeConexionMeta> {
  await asegurarOrganizacion(auth.organizationId);

  const state = await firmarMetaState({ organizationId: auth.organizationId, userId: auth.userId });

  return { authorizationUrl: resolverCliente(cliente).construirUrlDeAutorizacion(state) };
}

// ---------------------------------------------------------------------------
// 2. Completar la conexión
//
// DESDE A-07 (docs-privados/auditoria-2026-09-30-corta.md, local) ESTO YA NO
// LO LLAMA EL CALLBACK. El callback de Meta corre sin JWT, así que cualquiera
// que tuviera una URL de autorización ajena (el ADMIN de B se la manda al dueño
// de la página de A) podía terminar el flujo en el navegador de otro. Ahora el
// callback solo rebota el code y el state al CRM (en el fragmento de la URL), y
// el CRM, con la sesión de quien esté logueado, llama a
// POST /api/integrations/meta/complete. Acá se exige que ese usuario sea el
// mismo que firmó el state.
//
// Meta manda error=access_denied cuando la persona cancela; eso lo resuelve el
// callback antes de rebotar y nunca llega acá.
// ---------------------------------------------------------------------------

export interface EntradaDeCompletarMeta {
  state: string;
  code: string;
}

// Los tres casos en que la persona tiene que volver a tocar "Conectar": el
// mensaje lo muestra el CRM tal cual, así que dice qué hacer.
export const MENSAJE_OTRA_SESION =
  "Esta conexión con Facebook la empezó otro usuario o se abrió en otra sesión. Volvé a tocar «Conectar con Facebook» desde tu cuenta.";

export const MENSAJE_STATE_YA_USADO =
  "Este intento de conexión con Facebook ya se usó. Volvé a tocar «Conectar con Facebook».";

export const MENSAJE_CODE_VENCIDO =
  "Facebook no aceptó la autorización porque venció o ya se había usado. Volvé a tocar «Conectar con Facebook».";

export const MENSAJE_SIN_PAGINAS =
  "No autorizaste ninguna página de Facebook. Volvé a intentarlo y elegí al menos una.";

export const MENSAJE_VARIAS_PAGINAS =
  "Autorizaste más de una página. Este negocio conecta una sola página de Facebook: volvé a intentarlo y elegí solo una en la pantalla de Meta.";

export const MENSAJE_PAGINA_DE_OTRA_CUENTA =
  "Esa página de Facebook ya está conectada a otra cuenta.";

// meta_page_connections.page_id es UNIQUE entre las conexiones no REVOKED
// (ítem 169; parcial desde D-10, migración 20261012120000): una página no
// puede estar conectada a dos organizaciones, porque el webhook trae el page id
// y ninguna otra pista de a quién pertenece el mensaje; la que otra
// organización desconectó ya no ocupa el lugar. Mismo criterio que
// traducirPaginaDeFacebookDuplicada de agent.service.ts: se traduce SOLO el
// P2002 sobre page_id; cualquier otro error se relanza tal cual.
function traducirPaginaYaConectada(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = Array.isArray(err.meta?.target)
      ? err.meta.target.join(",")
      : String(err.meta?.target ?? "");
    if (target.includes("page_id")) {
      throw new AppError(MENSAJE_PAGINA_DE_OTRA_CUENTA, 409);
    }
  }
  throw err;
}

export async function completarConexion(
  entrada: EntradaDeCompletarMeta,
  auth: { organizationId: string; userId: string },
  cliente?: ClienteInyectado,
): Promise<ConexionMetaPublica> {
  // -------------------------------------------------------------------------
  // EL ORDEN ES LA SEGURIDAD DE ESTE ENDPOINT: el state se verifica ANTES DE
  // TOCAR NADA, tiene que ser del mismo usuario y de la misma organización que
  // la sesión, y se consume antes de hablar con Meta.
  // -------------------------------------------------------------------------
  const state = await verificarMetaState(entrada.state);

  // 403 y el mismo mensaje para "otra organización" y "otro usuario": en los
  // dos casos lo que corresponde es volver a empezar desde la cuenta propia.
  // No se consume el state: quien lo empezó todavía puede terminarlo.
  if (state.organizationId !== auth.organizationId || state.userId !== auth.userId) {
    throw new AppError(MENSAJE_OTRA_SESION, 403);
  }

  if (!consumirMetaState(state)) {
    throw new AppError(MENSAJE_STATE_YA_USADO, 400);
  }

  const { organizationId } = state;

  // La organización puede haberse dado de baja entre que se inició el flujo y
  // que volvió el callback: el state vale diez minutos. Va antes de hablar con
  // Meta para no canjear un código que no se va a poder guardar.
  await asegurarOrganizacion(organizationId);

  const meta = resolverCliente(cliente);

  // code → user token corto → user token LARGO → páginas. El paso del medio no
  // es opcional: el Page token que devuelve /me/accounts hereda la vida del user
  // token con el que se pide, y solo con el largo sale uno que no vence (ver el
  // encabezado de metaOAuth.service.ts).
  // Un code vencido o ya canjeado es un OAuthException de Meta (tokenInvalido):
  // se traduce a un 400 que le dice a la persona qué hacer, en vez del 502
  // genérico. Una falla de red sigue siendo 502.
  const corto = await meta.intercambiarCodigo(entrada.code).catch((err: unknown) => {
    if (err instanceof MetaAuthError && err.tokenInvalido) {
      throw new AppError(MENSAJE_CODE_VENCIDO, 400);
    }
    throw err;
  });
  const largo = await meta.obtenerTokenDeLargaDuracion(corto.accessToken);
  const paginas = await meta.listarPaginasAutorizadas(largo.accessToken);

  if (paginas.length === 0) {
    throw new AppError(MENSAJE_SIN_PAGINAS, 400);
  }

  // -------------------------------------------------------------------------
  // MÁS DE UNA PÁGINA ES UN ERROR EXPLÍCITO, NO UN SELECTOR — simplificación
  // deliberada del alcance del ítem 170, no un bug.
  //
  // MetaPageConnection es UNA fila por organización, y el ítem no incluye una
  // pantalla para elegir entre varias. Quedarse con "la primera" sería elegir
  // por la persona sin que se entere (el orden de /me/accounts no es una
  // decisión suya), y guardar la equivocada haría que el agente conteste por
  // una página que el negocio no quería conectar. Si hace falta un selector,
  // es una vuelta posterior: guardar las candidatas y dejar elegir.
  // -------------------------------------------------------------------------
  if (paginas.length > 1) {
    throw new AppError(MENSAJE_VARIAS_PAGINAS, 400);
  }

  const [pagina] = paginas;

  // Ítem 171: sin esta suscripción la página no le manda ningún mensaje al
  // webhook, aunque el panel de la app esté configurado. Va ANTES de guardar:
  // si Meta la rechaza, el callback falla y no queda una conexión ACTIVE que
  // en silencio nunca recibe nada. Reconectar la repite, y es idempotente del
  // lado de Meta. Si después el upsert choca con la página de otra
  // organización (409), la suscripción no cambió nada: esa página ya estaba
  // suscripta a esta misma app por la otra conexión.
  await meta.suscribirPaginaALaApp(pagina.id, pagina.accessToken);

  return upsertMetaConnection({
    organizationId,
    pageId: pagina.id,
    pageAccessToken: getCifrador().encrypt(pagina.accessToken),
    instagramBusinessAccountId: pagina.instagramBusinessAccountId,
  }).catch(traducirPaginaYaConectada);
}

// ---------------------------------------------------------------------------
// 3. Desconectar
//
// DESDE D-11 (docs-privados/auditoria-2026-09-30-corta.md, local) SE DA DE BAJA
// LA SUSCRIPCIÓN DE LA PÁGINA (DELETE /{page-id}/subscribed_apps) antes de
// borrar el token: sin eso, la página seguía mandándole mensajes al webhook. Es
// la inversa exacta de lo que hace completarConexion al conectar.
//
// LA BAJA ES "MEJOR ESFUERZO": si Meta la rechaza (token ya inválido: la
// conexión estaba en ERROR, o la persona quitó la app desde Facebook) o no
// responde, se loguea y se desconecta igual. Que Meta esté caído no puede
// impedirle a un negocio desconectarse, y lo que llegue después al webhook se
// ignora igual: metaWebhook.service.ts exige una conexión no REVOKED de la
// misma organización que el agente.
//
// FUERA DE ESO, SIN REVOCAR NADA DEL LADO DE META, a diferencia de Google. Lo que Meta ofrece
// es DELETE /{user-id}/permissions, que se autentica con un USER token — y este
// sistema no guarda ninguno: el user token largo se usa una sola vez en el
// callback para pedir las páginas y se descarta; lo único persistido es el
// Page token. Guardar el user token solo para poder revocar sería conservar
// una credencial más amplia (todas las páginas y permisos de esa persona) que
// la que el producto usa. Borrar el Page token de la fila deja a este sistema
// sin forma de usarlo; quitar la app del lado de Facebook lo hace la persona
// desde la configuración de su cuenta.
// ---------------------------------------------------------------------------
export async function desconectar(
  organizationId: string,
  cliente?: ClienteInyectado,
): Promise<void> {
  const conexion = await findMetaConnectionWithSecretByOrganization(organizationId);

  if (!conexion) {
    throw new AppError("Esta organización no tiene una página de Facebook conectada", 404);
  }

  if (conexion.status === "REVOKED") {
    // 409 y no un no-op silencioso, mismo criterio que desconectar() de Google.
    throw new AppError("Esta conexión ya estaba desconectada", 409);
  }

  if (conexion.pageAccessToken) {
    try {
      await resolverCliente(cliente).desuscribirPaginaDeLaApp(
        conexion.pageId,
        getCifrador().decrypt(conexion.pageAccessToken),
      );
    } catch (err) {
      logger.warn(
        { err, organizationId, pageId: conexion.pageId },
        "No se pudo dar de baja la suscripción de la página en Meta; se desconecta igual",
      );
    }
  }

  // Una sola escritura: status REVOKED y el token en NULL en la misma sentencia.
  await markMetaConnectionRevoked(organizationId);
}

// ---------------------------------------------------------------------------
// 4. Consultar el estado. Nunca devuelve el token: el repositorio usa un
// `select` que no lo incluye.
// ---------------------------------------------------------------------------
export async function obtenerConexion(organizationId: string): Promise<ConexionMetaPublica> {
  const conexion = await findMetaConnectionByOrganization(organizationId);

  if (!conexion) {
    throw new AppError("Esta organización no tiene una página de Facebook conectada", 404);
  }

  return conexion;
}

// ---------------------------------------------------------------------------
// 5. El token para ENVIAR (ítem 172)
//
// Lo llama el worker de la cola ANTES de correr el turno de un job de
// Messenger o Instagram: si no se va a poder mandar, no se gasta un turno del
// LLM ni se escribe una respuesta que nadie va a recibir. Todos los rechazos
// son AppError de 4xx, que el worker clasifica como PERMANENTES: ninguno se
// arregla solo en 15 segundos, hace falta que una persona reconecte.
// ---------------------------------------------------------------------------

export const MENSAJE_SIN_CONEXION_PARA_ENVIAR =
  "La organización no tiene una página de Facebook conectada: no se puede mandar la respuesta. Hay que conectarla desde el CRM.";

export const MENSAJE_PAGINA_RECONECTADA =
  "La organización reconectó OTRA página de Facebook después de que llegó este mensaje: el cliente escribió a la página anterior y no se le puede responder desde la nueva.";

export const MENSAJE_CONEXION_INACTIVA =
  "La conexión con Facebook está desconectada o con error: no se puede mandar la respuesta. Hay que reconectarla desde el CRM.";

export async function obtenerTokenParaEnviar(
  organizationId: string,
  pageIdEsperado: string,
): Promise<string> {
  const conexion = await findMetaConnectionWithSecretByOrganization(organizationId);

  if (!conexion) {
    throw new AppError(MENSAJE_SIN_CONEXION_PARA_ENVIAR, 404);
  }

  // El PSID/IGSID que trajo el webhook es un id POR PÁGINA: el mismo cliente
  // tiene otro id en otra página. Mandar con el token de la página nueva a un
  // id de la anterior falla en el mejor caso, y en el peor le llega a otra
  // persona. No se reintenta: la página vieja ya no tiene token acá.
  if (conexion.pageId !== pageIdEsperado) {
    throw new AppError(MENSAJE_PAGINA_RECONECTADA, 409);
  }

  // El CHECK de la base garantiza que ACTIVE tiene token; la segunda
  // condición es para el tipo y para no confiar solo en eso.
  if (conexion.status !== "ACTIVE" || !conexion.pageAccessToken) {
    throw new AppError(MENSAJE_CONEXION_INACTIVA, 409);
  }

  return getCifrador().decrypt(conexion.pageAccessToken);
}

// Meta rechazó el Page token al mandar (código 190): la conexión pasa a ERROR
// con el motivo, para que la pantalla del CRM (ítem 173) pida reconectar y los
// próximos mensajes fallen en obtenerTokenParaEnviar sin llamar a Meta. Solo si
// la conexión sigue siendo la de esa página y no está REVOKED (ver el
// repositorio): entre la lectura del token y el rechazo pudo haber cambiado.
export async function marcarTokenRechazado(
  organizationId: string,
  pageId: string,
  motivo: string,
): Promise<void> {
  await markMetaConnectionError(organizationId, motivo, undefined, { pageId });
}
