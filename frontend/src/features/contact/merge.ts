import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAccessToken } from "../../auth/getAccessToken";
import { request } from "../../lib/api";
import { conversationKeys } from "../conversation/queries";
import { LIFECYCLE_STAGE_LABELS } from "./labels";
import { contactKeys } from "./queries";
import type { Contact } from "./types";

// ---------------------------------------------------------------------------
// Unir contactos duplicados (contactMerge.service.ts del backend). Solo ADMIN.
//   GET  /api/contacts/:id/merge-preview?with=<otro>
//   POST /api/contacts/:id/merge  { absorbedId, fields }
// :id es el contacto que QUEDA.
// ---------------------------------------------------------------------------

export const CAMPOS_DE_LA_UNION = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "jobTitle",
  "companyId",
  "ownerId",
  "lifecycleStage",
  "source",
  "leadScore",
  "leadIntent",
  "leadServiceOfInterest",
  "leadUrgency",
  "leadBudget",
  "leadLocation",
] as const;

export type CampoDeLaUnion = (typeof CAMPOS_DE_LA_UNION)[number];
export type Lado = "kept" | "absorbed";
export type Elecciones = Record<CampoDeLaUnion, Lado>;

export const ETIQUETA_DEL_CAMPO: Record<CampoDeLaUnion, string> = {
  firstName: "Nombre",
  lastName: "Apellido",
  email: "Email",
  phone: "Teléfono",
  jobTitle: "Puesto",
  companyId: "Empresa",
  ownerId: "Asignado",
  lifecycleStage: "Etapa",
  source: "Fuente",
  leadScore: "Puntaje",
  leadIntent: "Intención",
  leadServiceOfInterest: "Servicio de interés",
  leadUrgency: "Urgencia",
  leadBudget: "Presupuesto",
  leadLocation: "Zona",
};

export interface ContactoDeLaUnion extends Contact {
  company: { name: string } | null;
  owner: { fullName: string } | null;
  leadScore: number | null;
  leadIntent: string | null;
  leadServiceOfInterest: string | null;
  leadUrgency: string | null;
  leadBudgetAmount: string | number | null;
  leadBudgetCurrency: string | null;
  leadLocation: string | null;
}

export interface VistaPreviaDeLaUnion {
  kept: ContactoDeLaUnion;
  absorbed: ContactoDeLaUnion;
  defaults: Elecciones;
  aMover: Record<string, number>;
}

export interface ResultadoDeLaUnion {
  contactId: string;
  absorbedId: string;
  movidos: Record<string, number>;
  conversacionesCerradas: number;
}

export const ETIQUETA_DE_LO_QUE_SE_MUEVE: Record<string, string> = {
  conversaciones: "conversaciones (con sus mensajes)",
  oportunidades: "oportunidades (con cotizaciones, pagos y entregas)",
  actividades: "actividades y tareas",
  reservas: "reservas",
  cupones: "cupones",
  cuponesAgendados: "cupones agendados",
  seguimientosQr: "seguimientos con QR",
  eventos: "eventos de ingesta",
  identidades: "identidades de Messenger e Instagram",
  unidos: "contactos unidos antes",
};

const URGENCIA: Record<string, string> = { LOW: "Baja", MEDIUM: "Media", HIGH: "Alta" };

// Pura: el valor de un campo para mostrar en la comparación.
export function valorParaMostrar(c: ContactoDeLaUnion, campo: CampoDeLaUnion): string {
  switch (campo) {
    case "companyId":
      return c.company?.name ?? "";
    case "ownerId":
      return c.owner?.fullName ?? "";
    case "lifecycleStage":
      return LIFECYCLE_STAGE_LABELS[c.lifecycleStage] ?? c.lifecycleStage;
    case "leadUrgency":
      return c.leadUrgency ? (URGENCIA[c.leadUrgency] ?? c.leadUrgency) : "";
    case "leadBudget":
      return c.leadBudgetAmount === null
        ? ""
        : `${c.leadBudgetAmount} ${c.leadBudgetCurrency ?? ""}`.trim();
    default: {
      const valor = c[campo];
      return valor === null || valor === undefined ? "" : String(valor);
    }
  }
}

export function useMergePreview(keptId: string, absorbedId: string | undefined) {
  return useQuery({
    queryKey: [...contactKeys.detail(keptId), "merge-preview", absorbedId] as const,
    queryFn: ({ signal }) =>
      request<VistaPreviaDeLaUnion>(
        `/contacts/${encodeURIComponent(keptId)}/merge-preview?with=${encodeURIComponent(absorbedId ?? "")}`,
        { getAccessToken, signal },
      ),
    enabled: absorbedId !== undefined && absorbedId !== keptId,
    // Lo que se va a mover cambia: siempre fresco.
    staleTime: 0,
  });
}

export function useMergeContacts(keptId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { absorbedId: string; fields: Elecciones }) =>
      request<ResultadoDeLaUnion>(`/contacts/${encodeURIComponent(keptId)}/merge`, {
        method: "POST",
        body: input,
        getAccessToken,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contactKeys.all });
      void queryClient.invalidateQueries({ queryKey: conversationKeys.all });
    },
  });
}
