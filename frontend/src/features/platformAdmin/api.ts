import { ApiError, request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type { Agent } from "../agent/types";
import type { InternalAgent } from "../internalAgent/types";
import type { MetaPageConnection } from "../organization/types";
import type {
  AltaDeWabaDeLaClinica,
  ConexionDeWhatsappDeLaClinica,
  AssignAgentModelInput,
  AssignFacebookPageInput,
  AssignInternalAgentModelInput,
  AssignWhatsappNumberInput,
  CreateClinicaDemoInput,
  CreateClinicaDemoResponse,
  CreateTallerDemoInput,
  CreateTallerDemoResponse,
  CreateOrganizationInput,
  CreateOrganizationResponse,
  EdicionesDisponibles,
  FiltrosDelInforme,
  InformeDePreguntas,
  RubrosDisponibles,
  LlmUsageSummary,
  MetaAuthorization,
  MetaConnectionPendiente,
  OrganizationEdition,
  ReenvioDeInvitacion,
  EstadoDelReinicioDeLaDemo,
  PlatformAgentDeOrganizacion,
  PlatformOrganization,
} from "./types";

// Reutiliza request()/getAccessToken tal cual, como el resto de los módulos.
// La gate (platform admin) la decide el backend por el JWT; acá no viaja
// ningún dato de identidad.
export function createOrganization(
  input: CreateOrganizationInput,
): Promise<CreateOrganizationResponse> {
  return request<CreateOrganizationResponse>("/admin/organizations", {
    method: "POST",
    body: input,
    getAccessToken,
  });
}

// R19 (docs/rubros.md §12.1): la Clínica Demo con datos de ejemplo. Funciona
// aunque el backend no ofrezca el rubro clínica en el alta común.
export function createClinicaDemo(
  input: CreateClinicaDemoInput,
): Promise<CreateClinicaDemoResponse> {
  return request<CreateClinicaDemoResponse>("/admin/organizations/clinica-demo", {
    method: "POST",
    body: input,
    getAccessToken,
  });
}

// El Taller Demo con datos de ejemplo (docs/taller-demo.md): una automotora
// en modo demo con el módulo Servicios y tres usuarios.
export function createTallerDemo(input: CreateTallerDemoInput): Promise<CreateTallerDemoResponse> {
  return request<CreateTallerDemoResponse>("/admin/organizations/taller-demo", {
    method: "POST",
    body: input,
    getAccessToken,
  });
}

// Subir una organización de edición (docs/ediciones.md §1.1): solo de
// ESENCIAL a COMPLETA; bajar es un 409 del backend.
export function changeOrganizationEdition(
  organizationId: string,
  edition: OrganizationEdition,
): Promise<{ id: string; edition: OrganizationEdition }> {
  return request<{ id: string; edition: OrganizationEdition }>(
    `/admin/organizations/${encodeURIComponent(organizationId)}/edition`,
    { method: "PATCH", body: { edition }, getAccessToken },
  );
}

// Lo que va a pasar al activar un módulo, para la confirmación. Servicios
// (docs/servicios.md §5, S10): cuántas ventas ganadas se convierten en
// vehículos de clientes.
export function previaDeActivacion(
  organizationId: string,
  modulo: string,
): Promise<{ organizationId: string; modulo: string; ventasAConvertir: number }> {
  return request(
    `/admin/organizations/${encodeURIComponent(organizationId)}/modulos/${encodeURIComponent(modulo)}/previa`,
    { getAccessToken },
  );
}

// El asistente "¿Cómo se hace?": prenderlo o apagarlo en una organización.
// Idempotente del lado del backend.
export function cambiarAsistenteDeAyuda(
  organizationId: string,
  enabled: boolean,
): Promise<{ id: string; helpAssistantEnabled: boolean }> {
  return request(`/admin/organizations/${encodeURIComponent(organizationId)}/help-assistant`, {
    method: "PATCH",
    body: { enabled },
    getAccessToken,
  });
}

// Módulos activables (docs/servicios.md §1.5): activar y desactivar uno en
// una organización. Idempotentes del lado del backend.
export function activarModulo(
  organizationId: string,
  modulo: string,
): Promise<{ organizationId: string; modulo: string; activo: boolean }> {
  return request(
    `/admin/organizations/${encodeURIComponent(organizationId)}/modulos/${encodeURIComponent(modulo)}`,
    { method: "PUT", getAccessToken },
  );
}

export function desactivarModulo(
  organizationId: string,
  modulo: string,
): Promise<{ organizationId: string; modulo: string; activo: boolean }> {
  return request(
    `/admin/organizations/${encodeURIComponent(organizationId)}/modulos/${encodeURIComponent(modulo)}`,
    { method: "DELETE", getAccessToken },
  );
}

// Reenviar el mail de invitación al administrador de una organización que
// todavía no la aceptó. Responde a qué email salió; 409 si ya la aceptó. En
// una demo cubre a todos sus usuarios (ver ReenvioDeInvitacion).
export function reenviarInvitacionDelAdministrador(
  organizationId: string,
): Promise<ReenvioDeInvitacion> {
  return request<ReenvioDeInvitacion>(
    `/admin/organizations/${encodeURIComponent(organizationId)}/admin-invitation/resend`,
    { method: "POST", getAccessToken },
  );
}

// Reiniciar los datos de una demo (docs/rubros.md §12.3, docs/taller-demo.md §4): borra los
// datos de uso y vuelve a cargar los de ejemplo, en segundo plano. Responde enseguida con
// REINICIANDO; 400 si no es una demo, 409 si ya se está reiniciando o algo lo impide.
export function reiniciarDatosDeLaDemo(organizationId: string): Promise<EstadoDelReinicioDeLaDemo> {
  return request<EstadoDelReinicioDeLaDemo>(
    `/admin/organizations/${encodeURIComponent(organizationId)}/demo/reiniciar`,
    { method: "POST", getAccessToken },
  );
}

// En qué quedó el último reinicio de esa demo.
export function getEstadoDelReinicioDeLaDemo(
  organizationId: string,
  signal?: AbortSignal,
): Promise<EstadoDelReinicioDeLaDemo> {
  return request<EstadoDelReinicioDeLaDemo>(
    `/admin/organizations/${encodeURIComponent(organizationId)}/demo/reinicio`,
    { getAccessToken, signal },
  );
}

// Las ediciones que se pueden elegir hoy en el alta (docs/ediciones.md §10,
// PR 4). Con una sola, la pantalla no muestra el selector.
export function listEditions(signal?: AbortSignal): Promise<EdicionesDisponibles> {
  return request<EdicionesDisponibles>("/admin/organizations/editions", { getAccessToken, signal });
}

// Los rubros que se pueden elegir hoy en el alta (docs/rubros.md §15, R3).
// Con uno solo, la pantalla no muestra el selector.
export function listIndustries(signal?: AbortSignal): Promise<RubrosDisponibles> {
  return request<RubrosDisponibles>("/admin/organizations/industries", { getAccessToken, signal });
}

// Devuelve el agente actualizado, con la misma forma que GET /api/agents/:id.
export function assignWhatsappNumber({
  agentId,
  whatsappPhoneNumberId,
}: AssignWhatsappNumberInput): Promise<Agent> {
  return request<Agent>(`/admin/agents/${encodeURIComponent(agentId)}/whatsapp-phone-number`, {
    method: "PUT",
    body: { whatsappPhoneNumberId },
    getAccessToken,
  });
}

// Mismo contrato que el número de WhatsApp: devuelve el agente actualizado.
export function assignFacebookPage({
  agentId,
  facebookPageId,
}: AssignFacebookPageInput): Promise<Agent> {
  return request<Agent>(`/admin/agents/${encodeURIComponent(agentId)}/facebook-page`, {
    method: "PUT",
    body: { facebookPageId },
    getAccessToken,
  });
}

// B-05: el modelo de un agente y el del agente interno de una organización.
// Devuelven el agente actualizado, igual que los de arriba.
export function assignAgentModel({ agentId, ...body }: AssignAgentModelInput): Promise<Agent> {
  return request<Agent>(`/admin/agents/${encodeURIComponent(agentId)}/model`, {
    method: "PUT",
    body,
    getAccessToken,
  });
}

export function assignInternalAgentModel({
  organizationId,
  ...body
}: AssignInternalAgentModelInput): Promise<InternalAgent> {
  return request<InternalAgent>(
    `/admin/organizations/${encodeURIComponent(organizationId)}/internal-agent/model`,
    { method: "PUT", body, getAccessToken },
  );
}

// Las organizaciones vigentes, para el selector de las pantallas de plataforma.
export function listOrganizations(signal?: AbortSignal): Promise<PlatformOrganization[]> {
  return request<PlatformOrganization[]>("/admin/organizations", { getAccessToken, signal });
}

// Los agentes de una organización elegida, para el selector de "Modelo de IA".
// 404 si la organización no existe o está borrada.
export function listAgentesDeOrganizacion(
  organizationId: string,
  signal?: AbortSignal,
): Promise<PlatformAgentDeOrganizacion[]> {
  return request<PlatformAgentDeOrganizacion[]>(
    `/admin/organizations/${encodeURIComponent(organizationId)}/agents`,
    { getAccessToken, signal },
  );
}

// B4: el gasto en el modelo por organización de los últimos 30 días.
// OPS-03: si Meta rechaza el token global de WhatsApp, desde cuándo.
export function getEstadoDelTokenDeWhatsapp(
  signal?: AbortSignal,
): Promise<{ invalidoDesde: string | null }> {
  return request<{ invalidoDesde: string | null }>("/admin/whatsapp-token", {
    getAccessToken,
    signal,
  });
}

export function getLlmUsage(signal?: AbortSignal): Promise<LlmUsageSummary> {
  return request<LlmUsageSummary>("/admin/llm-usage", { getAccessToken, signal });
}

// ---------------------------------------------------------------------------
// La página de Facebook de una organización elegida (02/10/2026: la conecta y
// la desconecta el platform admin, no el ADMIN del negocio). Mismo contrato
// que tenía organization/api.ts, con la organización en el path.
// ---------------------------------------------------------------------------
function rutaMeta(organizationId: string): string {
  return `/admin/organizations/${encodeURIComponent(organizationId)}/integrations/meta`;
}

// null = la organización nunca se conectó (el backend responde 404).
export async function getOrganizationMetaConnection(
  organizationId: string,
  signal?: AbortSignal,
): Promise<MetaPageConnection | null> {
  try {
    return await request<MetaPageConnection>(rutaMeta(organizationId), { getAccessToken, signal });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

// Firma el state (para esta organización y este usuario) y devuelve la URL de
// autorización de Meta. POST: el state firmado habilita a escribir.
export function startOrganizationMetaConnection(
  organizationId: string,
): Promise<MetaAuthorization> {
  return request<MetaAuthorization>(`${rutaMeta(organizationId)}/connect`, {
    method: "POST",
    getAccessToken,
  });
}

// El segundo tramo: manda el code y el state que el callback le rebotó a la
// pantalla. El backend exige el mismo usuario y la misma organización que
// firmó el state; si no, o si el code venció, responde el mensaje a mostrar.
export function completeOrganizationMetaConnection(
  organizationId: string,
  pendiente: MetaConnectionPendiente,
): Promise<MetaPageConnection> {
  return request<MetaPageConnection>(`${rutaMeta(organizationId)}/complete`, {
    method: "POST",
    body: pendiente,
    getAccessToken,
  });
}

// 204 sin body. Deja la fila en REVOKED, sin token.
export function disconnectOrganizationMetaConnection(organizationId: string): Promise<void> {
  return request<void>(rutaMeta(organizationId), { method: "DELETE", getAccessToken });
}

// ---------------------------------------------------------------------------
// El WABA propio de una clínica (docs/whatsapp-alta-clinica.md). Alta manual
// del platform admin, después de que la clínica nos agregó como socio.
// ---------------------------------------------------------------------------

function rutaDelWaba(organizationId: string) {
  return `/admin/organizations/${encodeURIComponent(organizationId)}/whatsapp-business`;
}

export async function getWabaDeLaClinica(
  organizationId: string,
  signal?: AbortSignal,
): Promise<ConexionDeWhatsappDeLaClinica | null> {
  const { conexion } = await request<{ conexion: ConexionDeWhatsappDeLaClinica | null }>(
    rutaDelWaba(organizationId),
    { getAccessToken, signal },
  );
  return conexion;
}

export function conectarWabaDeLaClinica(input: {
  organizationId: string;
  wabaId: string;
}): Promise<AltaDeWabaDeLaClinica> {
  return request<AltaDeWabaDeLaClinica>(rutaDelWaba(input.organizationId), {
    method: "PUT",
    body: { wabaId: input.wabaId },
    getAccessToken,
  });
}

export async function desconectarWabaDeLaClinica(
  organizationId: string,
): Promise<ConexionDeWhatsappDeLaClinica | null> {
  const { conexion } = await request<{ conexion: ConexionDeWhatsappDeLaClinica | null }>(
    rutaDelWaba(organizationId),
    { method: "DELETE", getAccessToken },
  );
  return conexion;
}

// "Preguntas a la ayuda": los filtros vacíos no viajan (son "todos").
export function getInformeDePreguntas(
  filtros: FiltrosDelInforme,
  signal?: AbortSignal,
): Promise<InformeDePreguntas> {
  const query = new URLSearchParams();
  for (const [clave, valor] of Object.entries(filtros)) {
    if (valor !== undefined && valor !== "") query.set(clave, String(valor));
  }
  return request<InformeDePreguntas>(`/admin/help-assistant/questions?${query.toString()}`, {
    getAccessToken,
    signal,
  });
}
