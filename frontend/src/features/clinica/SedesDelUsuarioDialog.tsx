import { useState } from "react";
import { ErrorState } from "../../design-system/ErrorState";
import { Modal } from "../../design-system/Modal";
import { useUpdateUser } from "../user/mutations";
import { SedesSelect } from "./SedesSelect";

// Elegir las sedes de una Recepción de clínica (docs/rubros.md §11.5, R20),
// desde la lista de usuarios: para editarlas, o al pasar a alguien a Recepción
// (`pasarARecepcion`: el rol y las sedes van en el mismo PATCH, porque el
// backend no deja una Recepción sin sedes).
export function SedesDelUsuarioDialog({
  user,
  pasarARecepcion = false,
  onClose,
}: {
  user: { id: string; fullName: string; branches?: { id: string }[] };
  pasarARecepcion?: boolean;
  onClose: () => void;
}) {
  const [branchIds, setBranchIds] = useState<string[]>(() => user.branches?.map((b) => b.id) ?? []);
  const updateUser = useUpdateUser(user.id);

  function guardar() {
    updateUser.mutate(
      { branchIds, ...(pasarARecepcion ? { role: "RECEPCION" as const } : {}) },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal
      variant="dialog"
      title={`Sedes de ${user.fullName}`}
      onClose={onClose}
      closeLabel="Cancelar"
      primaryAction={{
        label: "Guardar",
        onClick: guardar,
        disabled: branchIds.length === 0,
        loading: updateUser.isPending,
      }}
    >
      <p className="ds-hint">
        Recepción ve la agenda, las conversaciones y las tareas de estas sedes.
      </p>
      <SedesSelect id={`sedes-de-${user.id}`} value={branchIds} onChange={setBranchIds} />
      {updateUser.isError ? (
        <ErrorState>
          {updateUser.error instanceof Error
            ? updateUser.error.message
            : "No pudimos guardar las sedes."}
        </ErrorState>
      ) : null}
    </Modal>
  );
}
