import { useId, useState, type FormEvent } from "react";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { Modal } from "../../design-system/Modal";
import { useMonedaPorDefecto } from "./monedaPorDefecto";
import { aInputLocal, aMonto, deInputLocal, ETIQUETA_DE_CANAL } from "./formato";
import { useRegistrarAprobacion } from "./mutations";
import type { Aprobacion } from "./types";

// "Registrar aprobación" (docs/servicios.md §2.5): el cliente aprobó o rechazó
// un trabajo extra por teléfono, WhatsApp o en persona, y alguien del taller lo
// anota. Es solo un registro; "Sumar al valor de la orden" suma el monto al
// Valor en la misma operación.

export function RegistrarAprobacionDialog({
  ordenId,
  moneda,
  onClose,
}: {
  ordenId: string;
  // La moneda del Valor de la orden, si tiene: el monto que se suma va en esa.
  moneda: string | null;
  onClose: () => void;
}) {
  const formId = useId();
  const registrar = useRegistrarAprobacion(ordenId);
  // Sin Valor en la orden, el monto va en la moneda por defecto (la que usa el
  // backend): se muestra igual, para que se sepa en qué moneda se carga.
  const monedaPorDefecto = useMonedaPorDefecto();
  const monedaDelMonto = moneda ?? monedaPorDefecto;
  const [descripcion, setDescripcion] = useState("");
  const [decision, setDecision] = useState<Aprobacion["decision"]>("APROBADO");
  const [quien, setQuien] = useState("");
  const [canal, setCanal] = useState<Aprobacion["channel"]>("TELEFONO");
  const [cuando, setCuando] = useState(aInputLocal(new Date().toISOString()));
  const [monto, setMonto] = useState("");
  const [sumar, setSumar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const amount = aMonto(monto);
      await registrar.mutateAsync({
        description: descripcion,
        decision,
        approverName: quien,
        channel: canal,
        decidedAt: deInputLocal(cuando) ?? new Date().toISOString(),
        amount,
        ...(amount !== null && moneda ? { currency: moneda } : {}),
        sumarAlValor: amount !== null && decision === "APROBADO" && sumar,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos registrar la aprobación");
    }
  }

  return (
    <Modal
      variant="dialog"
      title="Registrar aprobación"
      closeLabel="Cancelar"
      onClose={onClose}
      primaryAction={{
        label: "Registrar",
        formId,
        disabled: registrar.isPending,
        loading: registrar.isPending,
      }}
    >
      <form id={formId} onSubmit={guardar} className="ds-stack">
        <FormField label={<span className="ds-required">Qué se le consultó</span>}>
          <input
            type="text"
            required
            maxLength={2000}
            placeholder="Cambio de pastillas de freno"
            value={descripcion}
            onChange={(event) => setDescripcion(event.target.value)}
          />
        </FormField>
        <fieldset className="ds-stack">
          <legend>Qué respondió</legend>
          <label>
            <input
              type="radio"
              name="decision"
              checked={decision === "APROBADO"}
              onChange={() => setDecision("APROBADO")}
            />{" "}
            Aprobó
          </label>
          <label>
            <input
              type="radio"
              name="decision"
              checked={decision === "RECHAZADO"}
              onChange={() => setDecision("RECHAZADO")}
            />{" "}
            Rechazó
          </label>
        </fieldset>
        <FormField label={<span className="ds-required">Quién respondió</span>}>
          <input
            type="text"
            required
            maxLength={200}
            placeholder="El titular"
            value={quien}
            onChange={(event) => setQuien(event.target.value)}
          />
        </FormField>
        <FormField label="Por dónde">
          <select
            value={canal}
            onChange={(event) => setCanal(event.target.value as Aprobacion["channel"])}
          >
            {Object.entries(ETIQUETA_DE_CANAL).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Cuándo">
          <input
            type="datetime-local"
            value={cuando}
            onChange={(event) => setCuando(event.target.value)}
          />
        </FormField>
        <FormField label={monedaDelMonto ? `Monto (${monedaDelMonto})` : "Monto"}>
          <input
            type="text"
            inputMode="decimal"
            value={monto}
            onChange={(event) => setMonto(event.target.value)}
          />
        </FormField>
        {decision === "APROBADO" ? (
          <label>
            <input
              type="checkbox"
              checked={sumar}
              disabled={!monto.trim()}
              onChange={(event) => setSumar(event.target.checked)}
            />{" "}
            Sumar al valor de la orden
          </label>
        ) : null}
        {error ? <ErrorState>{error}</ErrorState> : null}
      </form>
    </Modal>
  );
}
