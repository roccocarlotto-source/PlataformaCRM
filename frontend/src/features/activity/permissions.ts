import type { Activity } from "./types";

// B-18 — espejo visual de canUserPatchActivity (activity.service.ts del
// backend, la autoridad real): un USER edita una actividad (más allá de
// tildarla) solo si la creó él, la tiene asignada y todavía no está
// completada. Las que le asignó un ADMIN solo las completa desde "Mis
// tareas"; una ya tildada queda congelada hasta que un ADMIN la revise (§29).
// Solo decide qué se muestra: si el backend dice otra cosa, gana el 403.
export function canUserEditActivity(
  activity: Pick<Activity, "authorId" | "assigneeId" | "completedAt">,
  meId: string | undefined,
): boolean {
  return (
    meId !== undefined &&
    activity.authorId === meId &&
    activity.assigneeId === meId &&
    activity.completedAt === null
  );
}
