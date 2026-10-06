import { ConversationChannel } from "@prisma/client";
import { MAX_LARGO_DE_NOMBRE, partirNombreDePerfil } from "../utils/nombreDePerfil";
import { PREFIJO_DEL_USUARIO_DE_INSTAGRAM } from "../utils/nombreProvisorio";
import type { CanalMeta } from "./metaContact.service";
import { META_GRAPH_API_VERSION, type FetchLike } from "./metaOAuth.service";
import { codigosDelErrorDeGraph } from "./metaSend.service";

// ---------------------------------------------------------------------------
// El nombre del perfil de quien escribe por Messenger o Instagram, pedido a la
// Graph API con el Page access token. Mismo patrón que metaSend.service.ts: un
// tipo de función inyectable, sin estado y sin Postgres. Quien llama
// (metaContact.service.ts → completarNombreDesdeElPerfil) resuelve el token y
// decide qué hacer con el resultado; un fallo acá NUNCA frena un mensaje.
//
// ---------------------------------------------------------------------------
// VERIFICADO CONTRA LA DOCUMENTACIÓN DE META (06/10/2026), NO ASUMIDO
// ---------------------------------------------------------------------------
//
// 1. MESSENGER ("User Profile API", Messenger Platform > Identity):
//    GET /{PSID}?fields=first_name,last_name con el Page access token. Por
//    defecto solo viene `id`: first_name y last_name exigen ACCESO AVANZADO a
//    la función "Business Asset User Profile Access" (App Review). Sin ella,
//    Meta solo los devuelve para personas con un rol en la app. Si la persona
//    no tiene perfil disponible (una cuenta de Messenger creada con un
//    teléfono, por ejemplo) responde el código 2018218, "No profile available
//    for this user".
//
// 2. INSTAGRAM ("User Profile API", Messenger Platform > Instagram):
//    GET /{IGSID}?fields=name,username con el Page access token. Pide los
//    permisos que la app ya usa para mensajería (instagram_basic,
//    instagram_manage_messages, pages_manage_metadata, pages_read_engagement,
//    pages_show_list). El consentimiento lo da la propia persona al
//    escribirle al negocio; si lo bloqueó, Meta no devuelve nada. `name` puede
//    venir vacío (mucha gente no lo carga): queda el usuario.
//
// 3. El token va en Authorization: Bearer y no en la URL, igual que en el
//    envío: así no queda en logs de ningún intermediario.
// ---------------------------------------------------------------------------

const URL_GRAPH = `https://graph.facebook.com/${META_GRAPH_API_VERSION}`;

// Más corto que el del envío (10 s): nadie espera este dato, y si Meta tarda
// se sigue con el nombre provisorio.
const TIMEOUT_MS = 5_000;

export const CAMPOS_DEL_PERFIL: Record<CanalMeta, string> = {
  MESSENGER: "first_name,last_name",
  INSTAGRAM: "name,username",
};

export interface ObtenerPerfilDeMetaInput {
  // YA DESCIFRADO — quien llama descifra.
  pageAccessToken: string;
  channel: CanalMeta;
  // PSID (Messenger) o IGSID (Instagram), tal cual lo mandó el webhook.
  userId: string;
}

export interface NombreDelPerfil {
  firstName: string;
  lastName: string;
}

// null = Meta respondió, pero sin ningún nombre que se pueda usar.
export type ObtenerPerfilDeMeta = (
  input: ObtenerPerfilDeMetaInput,
) => Promise<NombreDelPerfil | null>;

// La Graph API respondió, y no fue un 2xx: falta el permiso, la persona no
// tiene perfil disponible, el token ya no vale. El mensaje lleva solo el
// status y los códigos: ni el token ni datos de la persona.
export class MetaProfileError extends Error {
  readonly status: number;
  readonly codigo: number | null;
  readonly subcodigo: number | null;

  constructor(status: number, codigo: number | null, subcodigo: number | null) {
    super(
      `Meta User Profile API returned ${status}${codigo !== null ? ` (code ${codigo}${subcodigo !== null ? `/${subcodigo}` : ""})` : ""}`,
    );
    this.name = "MetaProfileError";
    this.status = status;
    this.codigo = codigo;
    this.subcodigo = subcodigo;
    Object.setPrototypeOf(this, MetaProfileError.prototype);
  }
}

export function urlDelPerfil(channel: CanalMeta, userId: string): string {
  return `${URL_GRAPH}/${encodeURIComponent(userId)}?fields=${CAMPOS_DEL_PERFIL[channel]}`;
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

// Lo que se guarda en el contacto a partir del cuerpo de la respuesta. Pura y
// exportada para fijar el criterio sin red.
export function nombreDesdeElPerfil(channel: CanalMeta, cuerpo: unknown): NombreDelPerfil | null {
  const perfil = cuerpo && typeof cuerpo === "object" ? (cuerpo as Record<string, unknown>) : {};

  if (channel === ConversationChannel.MESSENGER) {
    const firstName = texto(perfil.first_name).slice(0, MAX_LARGO_DE_NOMBRE);
    const lastName = texto(perfil.last_name).slice(0, MAX_LARGO_DE_NOMBRE);
    if (firstName.length === 0) {
      // Solo apellido: va como nombre, que es el campo que no puede faltar.
      return lastName.length > 0 ? { firstName: lastName, lastName: "" } : null;
    }
    return { firstName, lastName };
  }

  // Instagram: `name` es texto libre, se parte como el nombre de perfil de
  // WhatsApp. Sin `name`, el usuario con su arroba — reconocible en el listado
  // y provisorio para el agente (ver esNombreProvisorio), que lo puede
  // reemplazar cuando la persona diga cómo se llama.
  const nombre = partirNombreDePerfil(texto(perfil.name));
  if (nombre) {
    return nombre;
  }
  const usuario = texto(perfil.username);
  if (usuario.length === 0) {
    return null;
  }
  return {
    firstName: `${PREFIJO_DEL_USUARIO_DE_INSTAGRAM}${usuario}`.slice(0, MAX_LARGO_DE_NOMBRE),
    lastName: "",
  };
}

// FACTORY solo para que el test inyecte el fetch; producción usa
// obtenerPerfilDeMetaReal.
export function crearObtenerPerfilDeMeta(hacerFetch: FetchLike = (url, init) => fetch(url, init)) {
  const obtener: ObtenerPerfilDeMeta = async (input) => {
    const res = await hacerFetch(urlDelPerfil(input.channel, input.userId), {
      method: "GET",
      headers: { Authorization: `Bearer ${input.pageAccessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const { codigo, subcodigo } = codigosDelErrorDeGraph(await res.text().catch(() => ""));
      throw new MetaProfileError(res.status, codigo, subcodigo);
    }
    return nombreDesdeElPerfil(input.channel, await res.json().catch(() => null));
  };
  return obtener;
}

export const obtenerPerfilDeMetaReal: ObtenerPerfilDeMeta = crearObtenerPerfilDeMeta();
