import { useState } from "react";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { Modal } from "../../design-system/Modal";
import type { Resource } from "../resource/types";
import { useConfigurarSobreturnos } from "./agendaQueries";

// El permiso de sobreturnos de un profesional y su tope diario (docs/rubros.md
// §4.4, R6). Configuración: solo ADMIN (la pantalla de Profesionales ya está
// dentro de AdminRoute). Bajar el tope no toca los sobreturnos ya cargados.
export function SobreturnosDelProfesionalDialog({
  profesional,
  onClose,
}: {
  profesional: Resource;
  onClose: () => void;
}) {
  const [permite, setPermite] = useState(profesional.allowsOverbooking === true);
  const [tope, setTope] = useState(String(profesional.maxOverbookingsPerDay ?? 1));
  const guardar = useConfigurarSobreturnos(profesional.id);
  const topeValido = Number.isInteger(Number(tope)) && Number(tope) >= 1 && Number(tope) <= 50;

  return (
    <Modal
      variant="dialog"
      title={`Sobreturnos de ${profesional.name}`}
      onClose={onClose}
      closeLabel="Cancelar"
      primaryAction={{
        label: "Guardar",
        disabled: !topeValido,
        loading: guardar.isPending,
        onClick: () =>
          guardar.mutate(
            { allowsOverbooking: permite, maxOverbookingsPerDay: Number(tope) },
            { onSuccess: onClose },
          ),
      }}
    >
      <FormField label="Permite sobreturnos">
        <input type="checkbox" checked={permite} onChange={(e) => setPermite(e.target.checked)} />
      </FormField>
      <FormField label="Tope de sobreturnos por día">
        <input
          type="number"
          min={1}
          max={50}
          value={tope}
          onChange={(e) => setTope(e.target.value)}
          disabled={!permite}
        />
      </FormField>
      <p className="ds-hint">
        Un sobreturno es un turno de más encima de un horario completo. Lo cargan las personas del
        equipo; el asistente nunca lo ofrece.
      </p>
      {guardar.isError ? (
        <ErrorState>
          {guardar.error instanceof Error ? guardar.error.message : "No pudimos guardar."}
        </ErrorState>
      ) : null}
    </Modal>
  );
}
