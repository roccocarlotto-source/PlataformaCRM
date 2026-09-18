import type { MultiSelectOption } from "../../design-system/MultiSelect";
import type { SelectOption } from "../../design-system/Select";
import type { ConversationChannel } from "./types";

// Rótulos y catálogos chicos del módulo de agentes, fuera de los componentes
// —mismo criterio que opportunity/labels.ts y contact/labels.ts— para que el
// listado y el formulario nombren cada valor igual sin importarse entre sí.

// Canales del enum ConversationChannel. Son dos y están fijos en el schema de
// Prisma: acá no hay riesgo de desincronización como en tools.ts, un canal
// nuevo es una migración.
export const CHANNEL_OPTIONS: MultiSelectOption<ConversationChannel>[] = [
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "WEB", label: "Web" },
];

// Derivado de la lista de arriba, no escrito de nuevo: un rótulo que cambie se
// cambia en un solo lugar.
export const CHANNEL_LABEL = Object.fromEntries(
  CHANNEL_OPTIONS.map((option) => [option.value, option.label]),
) as Record<ConversationChannel, string>;

// ---------------------------------------------------------------------------
// Proveedores de LLM: espejo chico de LLM_PROVIDER_NAMES
// (src/services/llmProvider.service.ts), donde HOY el único valor válido es
// "openrouter". Es una lista y no un input libre a propósito: el backend
// rechaza con 400 cualquier otro valor, así que ofrecer texto libre sería
// invitar a un error que nadie puede resolver desde la pantalla.
//
// Con un solo proveedor el <select> tiene una sola opción y viene
// preseleccionado. Se deja como select igual —y no como un texto fijo— porque
// el día que exista un segundo adaptador la pantalla no cambia: se agrega una
// entrada acá.
// ---------------------------------------------------------------------------
export const DEFAULT_MODEL_PROVIDER = "openrouter";

export const MODEL_PROVIDER_OPTIONS: SelectOption<string>[] = [
  { value: DEFAULT_MODEL_PROVIDER, label: "OpenRouter" },
];

// El rótulo del proveedor de una fila del listado. Un valor fuera de la lista
// (un adaptador nuevo del backend que acá todavía no está) se muestra crudo en
// vez de como "—": el dato real informa más que su ausencia, mismo criterio
// que la zona horaria IANA en BranchListPage.
export function modelProviderLabel(value: string): string {
  return MODEL_PROVIDER_OPTIONS.find((option) => option.value === value)?.label ?? value;
}
