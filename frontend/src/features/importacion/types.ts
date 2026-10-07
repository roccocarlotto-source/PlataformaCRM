// ---------------------------------------------------------------------------
// El contrato del asistente de importación de Plataforma
// (src/controllers/importacionAdmin.controller.ts y
// src/services/importacion.service.ts del backend;
// docs/importacion-de-datos.md §8). Nada que el backend no devuelva.
// ---------------------------------------------------------------------------

export type TipoImportable = "CONTACT" | "COMPANY" | "ACTIVITY" | "VEHICLE";
export type TipoDeHistorial = "NOTE" | "CALL" | "TASK";

export type EstadoDelLote =
  "STAGED" | "ANALYZING" | "READY" | "RUNNING" | "DONE" | "CANCELLED" | "UNDOING" | "UNDONE";

export type Politica = "FILL_EMPTY" | "OVERWRITE" | "SKIP";
export type Etapa = "LEAD" | "MQL" | "SQL" | "CUSTOMER" | "CHURNED";
export type FormatoDeFecha = "DD/MM/AAAA" | "MM/DD/AAAA" | "AAAA-MM-DD";
export type Separador = "," | ";" | "\t" | "|";
export type Codificacion = "utf-8" | "windows-1252";

export interface LecturaDelArchivo {
  separador?: Separador;
  codificacion?: Codificacion;
  hojas?: string[];
  hoja?: string;
}

export interface Ajustes {
  mapeo: Record<string, string>;
  formato: {
    fecha: FormatoDeFecha;
    separadorDecimal: "," | ".";
    si: string[];
    no: string[];
    separadorDeOpciones: ";" | ",";
  };
  etapas: Record<string, Etapa>;
  duplicados: Politica;
  crearEmpresas: boolean;
  // Solo en un lote de historial: quién figura como autor, el tipo cuando la
  // celda está vacía, y qué tipo es cada valor del origen.
  stock?: AjustesDeStock;
  historial?: {
    autorId: string;
    tipoPorDefecto?: TipoDeHistorial;
    tipos: Record<string, TipoDeHistorial>;
  };
}

// Lo propio de un lote de stock (docs/importacion-de-datos.md §5.4).
export interface AjustesDeStock {
  branchId: string;
  // Quién firma los cambios en el historial de la ficha (VehicleChangeLog).
  responsableId: string;
  condicionPorDefecto: "NEW" | "USED";
  monedaPorDefecto: "USD" | "LOCAL";
  importarVendidas: boolean;
  estados: Record<string, string>;
  condiciones: Record<string, "NEW" | "USED">;
  combustibles: Record<string, string>;
  transmisiones: Record<string, string>;
}

export interface ConfigDelLote {
  archivo: { nombre: string | null; encabezados: string[]; lectura: LecturaDelArchivo };
  ajustes: Ajustes | null;
}

export interface ResumenDeFilas {
  total: number;
  porEstado: Record<string, number>;
  porPlan: Record<string, number>;
  porResultado: Record<string, number>;
}

export interface Lote {
  id: string;
  organizationId: string;
  sourceId: string;
  entityType: TipoImportable | "ACTIVITY" | "VEHICLE";
  status: EstadoDelLote;
  fileName: string | null;
  rowCount: number;
  config: ConfigDelLote;
  counters: {
    analisis?: { empresasNuevas: number; ejemplosDeEmpresasNuevas: string[]; sinClave: number };
    final?: ResumenDeFilas;
    // Deshacer (docs/importacion-de-datos.md §8.3): cuántos se dieron de baja
    // por tipo, y lo que se omitió con su motivo (hasta 200).
    deshacer?: {
      borrados: Partial<Record<"ACTIVITY" | "CONTACT" | "COMPANY" | "VEHICLE", number>>;
      omitidos: { tipo: string; id: string; motivo: string }[];
      totalOmitidos: number;
    };
  } | null;
  errorMessage: string | null;
  createdAt: string;
  confirmedAt: string | null;
  finishedAt: string | null;
}

export type ValorDeCelda = string | number | boolean | null;

export interface SubidaDeArchivo {
  lote: Lote;
  encabezados: string[];
  lectura: LecturaDelArchivo;
  muestra: Record<string, ValorDeCelda>[];
  mapeoSugerido: Record<string, string>;
}

export interface DetalleDelLote {
  lote: Lote;
  resumen: ResumenDeFilas;
}

export type TipoDePlan = "CREATE" | "UPDATE" | "CONFLICT" | "UNCHANGED" | "SKIP" | "FAIL";
export type AccionDeCampo = "completar" | "agregar" | "difiere" | "difiere_bloqueado" | "igual";

export interface CambioPlaneado {
  campo: string;
  actual: unknown;
  entrante: unknown;
  accion: AccionDeCampo;
  motivo?: string;
}

export interface PlanDeFila {
  tipo: TipoDePlan;
  errores?: string[];
  advertencias: string[];
  existenteId?: string;
  cambios?: CambioPlaneado[];
  empresaNueva?: string;
  mismaQueFila?: number;
}

export interface FilaDelLote {
  id: string;
  rowNumber: number | null;
  rawPayload: Record<string, ValorDeCelda>;
  plan: PlanDeFila | null;
  decision: Politica | null;
  status: string;
  outcome: "CREATED" | "UPDATED" | "UNCHANGED" | "SKIPPED" | null;
  errorMessage: string | null;
}

export interface Paginado<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CampoPersonalizado {
  key: string;
  label: string;
  type: string;
  options: string[];
}

export interface OpcionesDeImportacion {
  // Ordenados por antigüedad (el más antiguo primero).
  usuarios: { id: string; email: string; fullName: string; rol: string }[];
  fuentes: { id: string; name: string; isActive: boolean }[];
  camposPersonalizados: CampoPersonalizado[];
  sucursales?: { id: string; name: string }[];
}
