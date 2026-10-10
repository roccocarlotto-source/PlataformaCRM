import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAccessToken } from "../../auth/getAccessToken";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { InlineLoading } from "../../design-system/LoadingState";
import { Modal } from "../../design-system/Modal";
import { Notice } from "../../design-system/Notice";
import { Select } from "../../design-system/Select";
import { ApiError, request } from "../../lib/api";
import { resourceKeys } from "../resource/queries";
import type { Resource } from "../resource/types";

// ---------------------------------------------------------------------------
// El calendario de Google de un profesional (docs/rubros.md §4.6, R8). Solo
// ADMIN (Profesionales está dentro de AdminRoute). Se elige de la lista de la
// cuenta conectada a la sede; si la conexión no tiene el permiso de la lista
// (se conectó antes), se puede reconectar o pegar el ID del calendario. Sin
// calendario, el profesional funciona solo con la agenda de la plataforma.
// ---------------------------------------------------------------------------

interface Calendario {
  id: string;
  summary: string;
  accessRole: string;
}

export function CalendarioDelProfesionalDialog({
  profesional,
  onClose,
}: {
  profesional: Resource;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const listaQuery = useQuery({
    queryKey: ["clinica", "calendarios", profesional.branchId],
    queryFn: ({ signal }) =>
      request<{ calendarios: Calendario[] }>(
        `/branches/${profesional.branchId}/google-calendar/calendars`,
        { getAccessToken, signal },
      ),
    retry: false,
  });
  const sinLista = listaQuery.error instanceof ApiError && listaQuery.error.status === 409;
  const [calendarId, setCalendarId] = useState(profesional.googleCalendarId ?? "");

  const guardar = useMutation({
    mutationFn: (valor: string | null) =>
      request(`/clinica/profesionales/${profesional.id}/google-calendar`, {
        method: "PUT",
        body: { calendarId: valor },
        getAccessToken,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: resourceKeys.lists() });
      onClose();
    },
  });

  return (
    <Modal
      variant="dialog"
      title={`Calendario de Google de ${profesional.name}`}
      onClose={onClose}
      closeLabel="Cancelar"
      primaryAction={{
        label: "Guardar",
        loading: guardar.isPending,
        onClick: () => guardar.mutate(calendarId.trim() ? calendarId.trim() : null),
      }}
    >
      <p className="ds-hint">
        Los turnos de {profesional.name} se crean en este calendario, y lo que tenga ocupado ahí no
        se ofrece. Tiene que ser de la cuenta de Google conectada a la sede, o estar compartido con
        ella con permiso para editar. Sin calendario, el profesional funciona solo con la agenda de
        la plataforma.
      </p>
      {listaQuery.isLoading ? <InlineLoading /> : null}
      {listaQuery.isSuccess ? (
        <Select
          label="Calendario"
          value={calendarId || undefined}
          options={listaQuery.data.calendarios.map((c) => ({ value: c.id, label: c.summary }))}
          emptyOption={{ label: "Sin calendario propio" }}
          onChange={(valor) => setCalendarId(valor)}
        />
      ) : null}
      {sinLista || (listaQuery.isError && !sinLista) ? (
        <>
          {sinLista ? (
            <Notice tone="info" alert={false}>
              Para ver la lista de calendarios, reconectá Google en la sede. También podés pegar el
              ID del calendario (en Google Calendar: Configuración del calendario → Integrar el
              calendario).
            </Notice>
          ) : (
            <ErrorState>
              {listaQuery.error instanceof Error
                ? listaQuery.error.message
                : "No pudimos cargar los calendarios."}
            </ErrorState>
          )}
          <FormField label="ID del calendario">
            <input
              type="text"
              maxLength={255}
              value={calendarId}
              onChange={(e) => setCalendarId(e.target.value)}
            />
          </FormField>
        </>
      ) : null}
      {guardar.isError ? (
        <ErrorState>
          {guardar.error instanceof Error ? guardar.error.message : "No pudimos guardar."}
        </ErrorState>
      ) : null}
    </Modal>
  );
}
