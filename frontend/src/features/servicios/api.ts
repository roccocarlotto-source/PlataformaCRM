import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type { Booking } from "../booking/types";
import type {
  ResumenDelTaller,
  TurnoVinculable,
  ActualizarOrdenInput,
  AprobacionInput,
  CambiarEstadoInput,
  ConfiguracionDelTaller,
  CrearOrdenInput,
  FichaDeOrden,
  OrdenesQuery,
  OrdenesResponse,
  TipoDeService,
  UsuarioResumido,
  CambiarDuenoInput,
  CamposDelVehiculoInput,
  CrearVehiculoInput,
  FichaDeVehiculo,
  OrdenDelVehiculo,
  VehiculoDeCliente,
  VehiculosQuery,
  VehiculosResponse,
} from "./types";

// Las rutas del taller (docs/servicios.md §1.6). Sin el módulo dan 403: las
// pantallas que las llaman solo se montan con el módulo (ModuloRoute,
// useModulo).
const BASE = "/servicios/vehiculos";

function queryString(query: VehiculosQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.q) params.set("q", query.q);
  if (query.contactId) params.set("contactId", query.contactId);
  if (query.branchId) params.set("branchId", query.branchId);
  if (query.incluirNoVigentes) params.set("incluirNoVigentes", "true");
  const texto = params.toString();
  return texto ? `?${texto}` : "";
}

export function listarVehiculos(
  query: VehiculosQuery,
  signal?: AbortSignal,
): Promise<VehiculosResponse> {
  return request<VehiculosResponse>(`${BASE}${queryString(query)}`, { getAccessToken, signal });
}

export function obtenerVehiculo(id: string, signal?: AbortSignal): Promise<FichaDeVehiculo> {
  return request<FichaDeVehiculo>(`${BASE}/${id}`, { getAccessToken, signal });
}

export function ordenesDelVehiculo(id: string, signal?: AbortSignal): Promise<OrdenDelVehiculo[]> {
  return request<OrdenDelVehiculo[]>(`${BASE}/${id}/ordenes`, { getAccessToken, signal });
}

export function crearVehiculo(input: CrearVehiculoInput): Promise<VehiculoDeCliente> {
  return request<VehiculoDeCliente>(BASE, { method: "POST", body: input, getAccessToken });
}

export function actualizarVehiculo(
  id: string,
  input: CamposDelVehiculoInput,
): Promise<VehiculoDeCliente> {
  return request<VehiculoDeCliente>(`${BASE}/${id}`, {
    method: "PATCH",
    body: input,
    getAccessToken,
  });
}

export function borrarVehiculo(id: string): Promise<void> {
  return request<void>(`${BASE}/${id}`, { method: "DELETE", getAccessToken });
}

export function cambiarDueno(id: string, input: CambiarDuenoInput): Promise<FichaDeVehiculo> {
  return request<FichaDeVehiculo>(`${BASE}/${id}/dueno`, {
    method: "POST",
    body: input,
    getAccessToken,
  });
}

// --- Órdenes (S4a) ----------------------------------------------------------

const ORDENES = "/servicios/ordenes";

function queryDeOrdenes(query: OrdenesQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.estados && query.estados.length > 0) params.set("estados", query.estados.join(","));
  if (query.branchId) params.set("branchId", query.branchId);
  if (query.assigneeId) params.set("assigneeId", query.assigneeId);
  if (query.bookingId) params.set("bookingId", query.bookingId);
  if (query.q) params.set("q", query.q);
  const texto = params.toString();
  return texto ? `?${texto}` : "";
}

export function listarOrdenes(query: OrdenesQuery, signal?: AbortSignal): Promise<OrdenesResponse> {
  return request<OrdenesResponse>(`${ORDENES}${queryDeOrdenes(query)}`, { getAccessToken, signal });
}

export function obtenerOrden(id: string, signal?: AbortSignal): Promise<FichaDeOrden> {
  return request<FichaDeOrden>(`${ORDENES}/${id}`, { getAccessToken, signal });
}

export function crearOrden(input: CrearOrdenInput): Promise<FichaDeOrden> {
  return request<FichaDeOrden>(ORDENES, { method: "POST", body: input, getAccessToken });
}

export function actualizarOrden(id: string, input: ActualizarOrdenInput): Promise<FichaDeOrden> {
  return request<FichaDeOrden>(`${ORDENES}/${id}`, {
    method: "PATCH",
    body: input,
    getAccessToken,
  });
}

export function cambiarEstado(id: string, input: CambiarEstadoInput): Promise<FichaDeOrden> {
  return request<FichaDeOrden>(`${ORDENES}/${id}/estado`, {
    method: "POST",
    body: input,
    getAccessToken,
  });
}

export function registrarAprobacion(id: string, input: AprobacionInput): Promise<FichaDeOrden> {
  return request<FichaDeOrden>(`${ORDENES}/${id}/aprobaciones`, {
    method: "POST",
    body: input,
    getAccessToken,
  });
}

/** El turno desde el que se crea una orden (Nueva orden con ?turnoId=). Es la
 *  ruta de siempre de la agenda: S4b no le cambia nada. */
export function obtenerTurno(id: string, signal?: AbortSignal): Promise<Booking> {
  return request<Booking>(`/bookings/${id}`, { getAccessToken, signal });
}

export function listarTurnosVinculables(
  contactId: string,
  signal?: AbortSignal,
): Promise<TurnoVinculable[]> {
  return request<TurnoVinculable[]>(`/servicios/turnos?contactId=${contactId}`, {
    getAccessToken,
    signal,
  });
}

export function listarUsuarios(signal?: AbortSignal): Promise<UsuarioResumido[]> {
  return request<UsuarioResumido[]>("/servicios/usuarios", { getAccessToken, signal });
}

// --- Configuración y tipos (S4a) -------------------------------------------

export function leerConfiguracion(signal?: AbortSignal): Promise<ConfiguracionDelTaller> {
  return request<ConfiguracionDelTaller>("/servicios/configuracion", { getAccessToken, signal });
}

export function guardarConfiguracion(
  input: Partial<ConfiguracionDelTaller>,
): Promise<ConfiguracionDelTaller> {
  return request<ConfiguracionDelTaller>("/servicios/configuracion", {
    method: "PUT",
    body: input,
    getAccessToken,
  });
}

export function listarTipos(soloActivos: boolean, signal?: AbortSignal): Promise<TipoDeService[]> {
  return request<TipoDeService[]>(`/servicios/tipos${soloActivos ? "?soloActivos=true" : ""}`, {
    getAccessToken,
    signal,
  });
}

export function crearTipo(input: {
  name: string;
  nextServiceAfterMonths: number | null;
}): Promise<TipoDeService> {
  return request<TipoDeService>("/servicios/tipos", {
    method: "POST",
    body: input,
    getAccessToken,
  });
}

export function actualizarTipo(
  id: string,
  input: Partial<Pick<TipoDeService, "name" | "nextServiceAfterMonths" | "isActive">>,
): Promise<TipoDeService> {
  return request<TipoDeService>(`/servicios/tipos/${id}`, {
    method: "PATCH",
    body: input,
    getAccessToken,
  });
}

export function borrarTipo(id: string): Promise<void> {
  return request<void>(`/servicios/tipos/${id}`, { method: "DELETE", getAccessToken });
}

// S11: el resumen del taller (§4.7). Sin sucursal, todas las del usuario.
export function obtenerResumenDelTaller(
  branchId: string | undefined,
  signal?: AbortSignal,
): Promise<ResumenDelTaller> {
  const query = branchId ? `?branchId=${encodeURIComponent(branchId)}` : "";
  return request<ResumenDelTaller>(`/servicios/dashboard${query}`, { getAccessToken, signal });
}
