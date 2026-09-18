import { useId, useState, type FormEvent } from "react";
import { Button } from "../../design-system/Button";
import { CurrencyInput } from "../../design-system/CurrencyInput";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { Modal } from "../../design-system/Modal";
import { Select } from "../../design-system/Select";
import { CURRENCY_OPTIONS, isKnownCurrency } from "../../lib/currencies";
import {
  EMPTY_LINE,
  toQuoteInput,
  validateQuoteForm,
  type QuoteFormValues,
  type QuoteInputFromForm,
  type QuoteLineFormValue,
} from "./quoteForm";

export interface QuoteFormPanelProps {
  title: string;
  initialValues: QuoteFormValues;
  // Aviso para "Nueva cotización" cuando la activa está en borrador o enviada:
  // guardar la manda al historial.
  supersedeNotice?: boolean;
  onSubmit: (input: QuoteInputFromForm) => Promise<void>;
  onClose: () => void;
  isSubmitting: boolean;
}

// ---------------------------------------------------------------------------
// Alta de una cotización nueva y edición de un borrador, en el panel lateral
// del sistema (Modal variant "panel"): la acción principal del pie dispara el
// submit del <form> por el atributo nativo form= (primaryAction.formId).
//
// El panel no se cierra con Escape ni clic afuera (ver Modal.tsx): acá eso
// también protege lo tipeado.
// ---------------------------------------------------------------------------
export function QuoteFormPanel({
  title,
  initialValues,
  supersedeNotice = false,
  onSubmit,
  onClose,
  isSubmitting,
}: QuoteFormPanelProps) {
  const formId = useId();
  const [values, setValues] = useState<QuoteFormValues>(initialValues);
  const [error, setError] = useState<string | null>(null);

  function updateLine(index: number, patch: Partial<QuoteLineFormValue>) {
    setValues((current) => ({
      ...current,
      lines: current.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));
  }

  function removeLine(index: number) {
    setValues((current) => ({
      ...current,
      lines: current.lines.filter((_, i) => i !== index),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validateQuoteForm(values);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      await onSubmit(toQuoteInput(values));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la cotización");
    }
  }

  // Una moneda guardada fuera de la lista se muestra como opción extra, mismo
  // trato que el select de Moneda de OpportunityFormPage.
  const hasKnownCurrency = isKnownCurrency(values.currency);

  return (
    <Modal
      title={title}
      onClose={onClose}
      closeLabel="Cancelar"
      primaryAction={{
        label: isSubmitting ? "Guardando…" : "Guardar",
        formId,
        disabled: isSubmitting,
      }}
    >
      <form id={formId} onSubmit={handleSubmit} noValidate className="ds-quote-form">
        {supersedeNotice ? (
          <p className="ds-hint">
            Al guardar, la cotización vigente pasa al historial como reemplazada.
          </p>
        ) : null}
        <div className="ds-field-row">
          <FormField label={<span className="ds-required">Precio ofertado</span>}>
            <CurrencyInput
              value={values.amount}
              onChange={(amount) => setValues((current) => ({ ...current, amount }))}
            />
          </FormField>
          {/* Suelto, sin FormField: Select trae su propio <label htmlFor> y
              FormField ES un <label>. */}
          <Select
            label="Moneda"
            value={values.currency}
            options={[
              ...(hasKnownCurrency ? [] : [{ value: values.currency, label: values.currency }]),
              ...CURRENCY_OPTIONS.map((currency) => ({ value: currency, label: currency })),
            ]}
            onChange={(currency) => {
              if (currency) setValues((current) => ({ ...current, currency }));
            }}
          />
        </div>
        <FormField label="Válida hasta">
          <input
            type="date"
            value={values.validUntil}
            onChange={(event) =>
              setValues((current) => ({ ...current, validUntil: event.target.value }))
            }
          />
        </FormField>

        <fieldset className="ds-field">
          <legend className="ds-field-label">Accesorios y descuentos</legend>
          {values.lines.length === 0 ? (
            <p className="ds-empty">Sin líneas adicionales.</p>
          ) : (
            <ol className="ds-mapping-rows">
              {values.lines.map((line, index) => (
                // Índice como key, mismo motivo que FieldMappingEditor: el
                // contenido es lo que cambia mientras se tipea y las filas no
                // se reordenan.
                <li key={index} className="ds-mapping-row ds-quote-line">
                  <label>
                    <span className="ds-field-label">Descripción</span>
                    <input
                      type="text"
                      value={line.description}
                      maxLength={200}
                      onChange={(event) => updateLine(index, { description: event.target.value })}
                    />
                  </label>
                  <Select
                    label="Tipo"
                    value={line.kind}
                    options={[
                      { value: "extra", label: "Accesorio" },
                      { value: "discount", label: "Descuento" },
                    ]}
                    onChange={(kind) => {
                      if (kind) updateLine(index, { kind });
                    }}
                  />
                  <label>
                    <span className="ds-field-label">Importe</span>
                    <CurrencyInput
                      value={line.amount}
                      onChange={(amount) => updateLine(index, { amount })}
                    />
                  </label>
                  <Button
                    variant="danger"
                    onClick={() => removeLine(index)}
                    aria-label={`Quitar la línea ${index + 1}`}
                  >
                    Quitar
                  </Button>
                </li>
              ))}
            </ol>
          )}
          <Button
            onClick={() =>
              setValues((current) => ({ ...current, lines: [...current.lines, { ...EMPTY_LINE }] }))
            }
          >
            Agregar línea
          </Button>
        </fieldset>

        {error ? <ErrorState>{error}</ErrorState> : null}
      </form>
    </Modal>
  );
}
