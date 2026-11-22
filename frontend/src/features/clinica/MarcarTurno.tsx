import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getAccessToken } from "../../auth/getAccessToken";
import { Button } from "../../design-system/Button";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { useConfirm } from "../../design-system/useConfirm";
import { useToast } from "../../design-system/useToast";
import { request } from "../../lib/api";
import { bookingKeys } from "../booking/queries";
import type { Booking } from "../booking/types";
import { ROTULO_DE_ESTADO } from "./estadosDeTurno";

// ---------------------------------------------------------------------------
// Atendido / No vino de un turno de clínica (docs/rubros.md §4.8, R10), en el
// detalle del turno. Lo usan ADMIN y Recepción, sobre un turno que ya empezó.
// Se puede corregir (atendido ↔ no vino). La nota es opcional y corta, y NO es
// para datos de salud: el aviso lo dice.
// ---------------------------------------------------------------------------

const LARGO_MAXIMO = 200;

export function MarcarTurno({ booking, onDone }: { booking: Booking; onDone: () => void }) {
  const [nota, setNota] = useState("");
  const queryClient = useQueryClient();
  // QA de la primera clínica (ISSUE-026): "No vino" pide confirmación (no
  // se le pide la reseña ni el control) y las dos acciones avisan que
  // quedaron hechas.
  const confirm = useConfirm();
  const toast = useToast();
  const marcar = useMutation({
    mutationFn: (que: "attended" | "no-show") =>
      request(`/bookings/${booking.id}/${que}`, {
        method: "PATCH",
        body: nota.trim() ? { nota: nota.trim() } : {},
        getAccessToken,
      }),
    onSuccess: (_data, que) => {
      queryClient.invalidateQueries({ queryKey: bookingKeys.lists() });
      toast.show(que === "attended" ? "Marcado como Atendido" : "Marcado como No vino");
      onDone();
    },
  });

  const esCorreccion = booking.status === "COMPLETED" || booking.status === "NO_SHOW";
  return (
    <div className="ds-stack">
      {esCorreccion ? (
        <p className="ds-hint">Marcado como {ROTULO_DE_ESTADO[booking.status]}.</p>
      ) : null}
      <FormField label="Nota (opcional)">
        <input
          type="text"
          maxLength={LARGO_MAXIMO}
          value={nota}
          onChange={(e) => setNota(e.target.value)}
        />
      </FormField>
      <p className="ds-hint">No cargues datos de salud ni el motivo de la consulta.</p>
      {booking.status !== "COMPLETED" ? (
        <Button
          variant="primary"
          disabled={marcar.isPending}
          onClick={() => marcar.mutate("attended")}
        >
          {esCorreccion ? "Corregir a Atendido" : "Atendido"}
        </Button>
      ) : null}
      {booking.status !== "NO_SHOW" ? (
        <Button
          variant="secondary"
          disabled={marcar.isPending}
          onClick={async () => {
            if (
              await confirm(
                "¿Marcar que no vino? No se le va a pedir la reseña ni recordar el control.",
                { confirmLabel: "No vino", cancelLabel: "Volver" },
              )
            ) {
              marcar.mutate("no-show");
            }
          }}
        >
          {esCorreccion ? "Corregir a No vino" : "No vino"}
        </Button>
      ) : null}
      {marcar.isError ? (
        <ErrorState>
          {marcar.error instanceof Error ? marcar.error.message : "No pudimos marcar el turno."}
        </ErrorState>
      ) : null}
    </div>
  );
}
