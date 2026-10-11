import { useState } from "react";
import { ErrorState } from "../../design-system/ErrorState";
import { Modal } from "../../design-system/Modal";
import { UserSelect } from "../user/UserSelect";
import { useUpdateContact } from "./mutations";

export interface AsignarVendedorDialogProps {
  contactId: string;
  ownerId: string | null;
  onClose: () => void;
  // A quién se asigna, con el término del rubro (vocabulario.responsable:
  // vendedor o responsable). Sin el prop, "vendedor", como siempre.
  responsable?: { singular: string; singularTitulo: string };
}

const VENDEDOR = { singular: "vendedor", singularTitulo: "Vendedor" };

// ---------------------------------------------------------------------------
// "Asignar vendedor" desde una fila de Consultas sin identificar (ítem 184):
// el mismo PATCH de ownerId que hace la ficha, sin pasar por el formulario
// entero. Solo ADMIN (D2: un USER no reasigna), y por eso puede montar
// UserSelect, que pide GET /api/users. El selector no es "clearable": ownerId
// no se puede limpiar por PATCH (ver UserSelect).
// ---------------------------------------------------------------------------
export function AsignarVendedorDialog({
  contactId,
  ownerId,
  onClose,
  responsable = VENDEDOR,
}: AsignarVendedorDialogProps) {
  const [elegido, setElegido] = useState<string | undefined>(ownerId ?? undefined);
  const actualizar = useUpdateContact(contactId);

  function handleGuardar() {
    if (!elegido) return;
    actualizar.mutate({ ownerId: elegido }, { onSuccess: onClose });
  }

  return (
    <Modal
      variant="dialog"
      title={`Asignar ${responsable.singular}`}
      onClose={onClose}
      closeLabel="Cancelar"
      primaryAction={{
        label: "Asignar",
        onClick: handleGuardar,
        disabled: !elegido || elegido === ownerId,
        loading: actualizar.isPending,
      }}
    >
      <div className="ds-stack">
        <UserSelect
          id="asignar-vendedor"
          label={responsable.singularTitulo}
          value={elegido}
          onChange={setElegido}
          emptyOptionLabel="Sin asignar"
          clearable={false}
        />
        {actualizar.isError ? (
          <ErrorState>
            No pudimos asignar el {responsable.singular}
            {actualizar.error instanceof Error ? `: ${actualizar.error.message}` : "."}
          </ErrorState>
        ) : null}
      </div>
    </Modal>
  );
}
