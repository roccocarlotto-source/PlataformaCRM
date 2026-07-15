import { useQuery } from "@tanstack/react-query";
import { listInvitations } from "./api";
import type { InvitationListQuery } from "./types";

// Plana, no jerárquica: GET /api/invitations no tiene un padre obligatorio
// en la URL (a diferencia de Stage bajo Pipeline) — mismo criterio que
// companyKeys/opportunityKeys/activityKeys. Sin detail(): no existe
// GET /api/invitations/:id.
export const invitationKeys = {
  all: ["invitations"] as const,
  lists: () => [...invitationKeys.all, "list"] as const,
  list: (query: InvitationListQuery) => [...invitationKeys.lists(), query] as const,
};

export function useInvitations(query: InvitationListQuery) {
  return useQuery({
    queryKey: invitationKeys.list(query),
    queryFn: ({ signal }) => listInvitations(query, signal),
  });
}
