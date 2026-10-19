import { useId, useState, type FormEvent } from "react";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { Modal } from "../../design-system/Modal";
import { ContactSelect } from "../opportunity/ContactSelect";
import { useCambiarDueno } from "./mutations";

// "Cambiar dueño" (docs/servicios.md §2.2.1): pasa a otro contacto, o deja de
// ser de un cliente nuestro. La permuta no está acá: la marca el barrido de
// ventas (S10), nunca una persona.

type Opcion = "OTRO_CONTACTO" | "VENDIDO_A_TERCERO" | "OTRO";

export function CambiarDuenoDialog({
  vehiculoId,
  onClose,
}: {
  vehiculoId: string;
  onClose: () => void;
}) {
  const formId = useId();
  const cambiar = useCambiarDueno(vehiculoId);
  const [opcion, setOpcion] = useState<Opcion>("OTRO_CONTACTO");
  const [toContactId, setToContactId] = useState<string | undefined>(undefined);
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function confirmar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const notaFinal = nota.trim() || null;
    if (opcion === "OTRO_CONTACTO" && !toContactId) {
      setError("Elegí el contacto que pasa a ser el dueño.");
      return;
    }
    try {
      await cambiar.mutateAsync(
        opcion === "OTRO_CONTACTO"
          ? { toContactId: toContactId ?? "", nota: notaFinal }
          : { fin: opcion, nota: notaFinal },
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cambiar el dueño");
    }
  }

  return (
    <Modal
      variant="dialog"
      title="Cambiar dueño"
      closeLabel="Cancelar"
      onClose={onClose}
      primaryAction={{
        label: "Cambiar dueño",
        formId,
        disabled: cambiar.isPending,
        loading: cambiar.isPending,
      }}
    >
      <form id={formId} onSubmit={confirmar} className="ds-stack">
        <fieldset className="ds-stack">
          <legend className="ds-sr-only">Qué pasó con el vehículo</legend>
          <label>
            <input
              type="radio"
              name="opcion"
              checked={opcion === "OTRO_CONTACTO"}
              onChange={() => setOpcion("OTRO_CONTACTO")}
            />{" "}
            Pasa a otro contacto
          </label>
          <label>
            <input
              type="radio"
              name="opcion"
              checked={opcion === "VENDIDO_A_TERCERO"}
              onChange={() => setOpcion("VENDIDO_A_TERCERO")}
            />{" "}
            Ya no es de un cliente nuestro: lo vendió a un tercero
          </label>
          <label>
            <input
              type="radio"
              name="opcion"
              checked={opcion === "OTRO"}
              onChange={() => setOpcion("OTRO")}
            />{" "}
            Ya no es de un cliente nuestro: otro motivo
          </label>
        </fieldset>
        {opcion === "OTRO_CONTACTO" ? (
          <ContactSelect
            id="cambiar-dueno-contacto"
            label="Dueño nuevo"
            value={toContactId}
            onChange={setToContactId}
          />
        ) : null}
        <FormField label="Nota">
          <textarea
            value={nota}
            maxLength={1000}
            rows={2}
            onChange={(event) => setNota(event.target.value)}
          />
        </FormField>
        <p className="ds-hint">Se borra la fecha de compra y no se puede deshacer.</p>
        {error ? <ErrorState>{error}</ErrorState> : null}
      </form>
    </Modal>
  );
}
