import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
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
