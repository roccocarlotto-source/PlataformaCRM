import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { Select } from "../../design-system/Select";
import { useContactCustomFields } from "./queries";
import type { ContactCustomFieldDefinition, ContactCustomFieldValue } from "./types";

interface ContactCustomFieldsCardProps {
  // { key: valor } tal como está en el formulario. Lo que no tiene key está
  // sin cargar.
  values: Record<string, ContactCustomFieldValue>;
  onChange: (values: Record<string, ContactCustomFieldValue>) => void;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// La tarjeta "Campos personalizados" de la ficha del contacto (B6): un input
// por definición de la organización, según su tipo. Sin definiciones no se
// muestra nada. La validación real la hace el backend contra las mismas
// definiciones; acá los inputs solo acotan lo que se puede tipear.
//
// Vaciar un valor lo manda como null (borra): así "lo borré" se distingue de
// "no lo toqué" para el PATCH, que mezcla con lo guardado.
// ---------------------------------------------------------------------------
export function ContactCustomFieldsCard({
  values,
  onChange,
  disabled,
}: ContactCustomFieldsCardProps) {
  const fieldsQuery = useContactCustomFields();
  const definiciones = fieldsQuery.data ?? [];

  if (fieldsQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar los campos personalizados
        {fieldsQuery.error instanceof Error ? `: ${fieldsQuery.error.message}` : "."}
      </ErrorState>
    );
  }
  if (definiciones.length === 0) {
    return null;
  }

  function set(key: string, valor: ContactCustomFieldValue) {
    onChange({ ...values, [key]: valor });
  }

  function input(def: ContactCustomFieldDefinition) {
    const valor = values[def.key];
    switch (def.type) {
      case "TEXT":
        return (
          <FormField label={def.label}>
            <input
              type="text"
              value={typeof valor === "string" ? valor : ""}
              maxLength={500}
              disabled={disabled}
              onChange={(event) =>
                set(def.key, event.target.value === "" ? null : event.target.value)
              }
            />
          </FormField>
        );
      case "NUMBER":
        return (
          <FormField label={def.label}>
            <input
              type="number"
              step="any"
              value={typeof valor === "number" ? String(valor) : ""}
              disabled={disabled}
              onChange={(event) =>
                set(def.key, event.target.value === "" ? null : Number(event.target.value))
              }
            />
          </FormField>
        );
      case "DATE":
        return (
          <FormField label={def.label}>
            <input
              type="date"
              value={typeof valor === "string" ? valor : ""}
              disabled={disabled}
              onChange={(event) =>
                set(def.key, event.target.value === "" ? null : event.target.value)
              }
            />
          </FormField>
        );
      case "BOOLEAN":
        return (
          <FormField label={def.label}>
            <input
              type="checkbox"
              checked={valor === true}
              disabled={disabled}
              onChange={(event) => set(def.key, event.target.checked)}
            />
          </FormField>
        );
      case "SELECT": {
        // Una opción que el contacto tenía elegida y un ADMIN eliminó de la
        // lista: el contacto la conserva. Se muestra, marcada, para que no
        // parezca "Sin cargar"; una vez que se cambia por otra no se puede
        // volver a elegir.
        const eliminada = typeof valor === "string" && !def.options.includes(valor) ? valor : null;
        // Suelto, sin FormField: Select trae su propio <label htmlFor>.
        return (
          <Select
            id={`custom-field-${def.key}`}
            label={def.label}
            value={typeof valor === "string" ? valor : ""}
            options={[
              ...def.options.map((opcion) => ({ value: opcion, label: opcion })),
              ...(eliminada !== null
                ? [{ value: eliminada, label: `${eliminada} (opción eliminada)` }]
                : []),
            ]}
            emptyOption={{ label: "Sin cargar" }}
            disabled={disabled}
            onChange={(opcion) => set(def.key, opcion === "" ? null : opcion)}
          />
        );
      }
    }
  }

  return (
    <Card heading="Campos personalizados">
      <div className="ds-field-grid">
        {definiciones.map((def) => (
          <div key={def.id}>{input(def)}</div>
        ))}
      </div>
    </Card>
  );
}
