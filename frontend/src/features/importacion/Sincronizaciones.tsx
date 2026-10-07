import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { useConfirm } from "../../design-system/useConfirm";
import { cambiarSincronizacion } from "./api";
import { importacionKeys, useSincronizaciones } from "./queries";
import type { Sincronizacion } from "./types";

// ---------------------------------------------------------------------------
// Plataforma → Importar datos → Sincronizaciones (docs/importacion-de-datos.md
// §7): el stock que se mantiene al día desde una planilla de Google Sheets.
// Cada una con su última corrida, el resultado y el error; se pausa, se
// reanuda y se borra. La pausada sola por fallas queda resaltada.
// ---------------------------------------------------------------------------

// "hace 14 h": que un atraso se vea (Render dormido, §7).
export function haceCuanto(iso: string, ahora = Date.now()): string {
  const minutos = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 60_000));
  if (minutos < 1) return "recién";
  if (minutos < 60) return `hace ${String(minutos)} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 48) return `hace ${String(horas)} h`;
  return `hace ${String(Math.round(horas / 24))} días`;
}

function estadoDe(s: Sincronizacion): {
  texto: string;
  variant?: "danger" | "success" | "neutral";
} {
  if (s.pausedReason === "AUTO_FAILURES") {
    return { texto: "Pausada: falló 3 veces seguidas", variant: "danger" };
  }
  if (s.pausedAt) return { texto: "Pausada" };
  if (s.lastStatus === "FAILED") return { texto: "La última falló", variant: "danger" };
  return { texto: "Activa", variant: "success" };
}

export function Sincronizaciones({
  organizationId,
  onAbrirCorrida,
}: {
  organizationId: string;
  onAbrirCorrida: (batchId: string) => void;
}) {
  const syncs = useSincronizaciones(organizationId);
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const accion = useMutation({
    mutationFn: ({ id, que }: { id: string; que: "pause" | "resume" | "delete" }) =>
      cambiarSincronizacion(organizationId, id, que),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: importacionKeys.all }),
  });

  if (!syncs.data || syncs.data.length === 0) return null;

  async function borrar(id: string) {
    if (
      await confirm("La planilla deja de sincronizarse. Lo que ya se importó queda como está.", {
        confirmLabel: "Borrar",
        danger: true,
      })
    ) {
      accion.mutate({ id, que: "delete" });
    }
  }

  return (
    <Card heading="Sincronizaciones">
      <p className="ds-hint">
        Los campos mapeados se actualizan desde la planilla en cada sincronización. El estado que
        maneja el CRM (reservada, vendida, con una oportunidad) no se pisa, y nada se borra.
      </p>
      <ul className="ds-stack">
        {syncs.data.map((s) => {
          const estado = estadoDe(s);
          return (
            <li key={s.id} className="ds-list-card">
              <div className="ds-stack">
                <div className="ds-card-actions">
                  <Badge variant={estado.variant}>{estado.texto}</Badge>
                  <span>
                    {s.source.name} · cada {s.intervalHours} h ·{" "}
                    {s.lastRunAt
                      ? `última sincronización ${haceCuanto(s.lastRunAt)}`
                      : "todavía no corrió"}
                  </span>
                </div>
                {s.lastStatus === "FAILED" && s.lastError ? (
                  <p className="ds-hint">Error: {s.lastError}</p>
                ) : null}
                <div className="ds-card-actions">
                  {s.ultimaCorrida ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => onAbrirCorrida(s.ultimaCorrida?.id ?? "")}
                    >
                      Ver la última corrida
                    </Button>
                  ) : null}
                  {s.pausedAt ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => accion.mutate({ id: s.id, que: "resume" })}
                    >
                      Reanudar
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => accion.mutate({ id: s.id, que: "pause" })}
                    >
                      Pausar
                    </Button>
                  )}
                  <Button type="button" variant="danger" onClick={() => void borrar(s.id)}>
                    Borrar
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {accion.isError ? (
        <ErrorState>
          {accion.error instanceof Error ? accion.error.message : "No pudimos hacerlo."}
        </ErrorState>
      ) : null}
    </Card>
  );
}
