// La lista "Envíos que no salieron" (GET /api/envios-que-no-salieron).
export type TipoDeEnvio =
  | "SEGUIMIENTO_DE_CONSULTA"
  | "QR"
  | "CUPON"
  | "RECORDATORIO_DE_TURNO"
  | "MENSAJE_DEL_TALLER"
  | "AUTOMATIZACION";

export const ETIQUETA_DEL_TIPO: Record<TipoDeEnvio, string> = {
  SEGUIMIENTO_DE_CONSULTA: "Seguimiento de consulta",
  QR: "WhatsApp con QR",
  CUPON: "Cupón de descuento",
  RECORDATORIO_DE_TURNO: "Recordatorio de turno",
  MENSAJE_DEL_TALLER: "Mensaje del taller",
  AUTOMATIZACION: "Automatización",
};

export interface EnvioQueNoSalio {
  id: string;
  tipo: TipoDeEnvio;
  fecha: string;
  contacto: { id: string; nombre: string } | null;
  sede: { id: string; nombre: string } | null;
  motivo: string;
}

export interface EnviosQueNoSalieronQuery {
  page?: number;
  pageSize?: number;
  branchId?: string;
}

export interface EnviosQueNoSalieronResponse {
  data: EnvioQueNoSalio[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}
