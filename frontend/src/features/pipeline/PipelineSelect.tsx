import { Select } from "../../design-system/Select";
import { usePipelines } from "./queries";
import { InlineLoading } from "../../design-system/LoadingState";

interface PipelineSelectProps {
  id?: string;
  label: string;
  value: string | undefined;
  onChange: (pipelineId: string) => void;
  // Obligatorio: marca el rótulo con el "*" de .ds-required Y pone `required`
  // en el input del selector, siempre juntos para que la señal visual coincida
  // con el bloqueo real (ítem 10 de docs/frontend-cambios-pendientes.md). El
  // selector solo existe cuando la lista cargó: el formulario que lo exige
  // cubre ese hueco con su propio chequeo en el submit.
  required?: boolean;
}

// Combobox del design system (Select, §46 de docs/frontend-cambios-pendientes.md;
// plantilla directa: BranchSelect, migrado en §44) de una sola línea, sin
// subtítulo. La búsqueda es LOCAL, sobre la página ya traída — a diferencia de
// CompanySelect, que la pide al backend. GET /api/pipelines sí tiene `search`
// (pipeline.repository.ts), pero no se usa acá: se asume baja cardinalidad de
// Pipelines por organización (dominio: CRM de ventas, "MVP: uno por
// organización" según el comentario del schema, aunque el modelo soporte
// varios), así que filtrar las hasta 100 ya traídas alcanza. Límite de 100
// documentado como riesgo residual (ver docs/project-overview.md).
export function PipelineSelect({
  id,
  label,
  value,
  onChange,
  required = false,
}: PipelineSelectProps) {
  const pipelinesQuery = usePipelines({ pageSize: 100, sortBy: "name", sortOrder: "asc" });

  // Con la lista cargada, Select trae su propio div > label[for] + input.
  // Mientras carga o si falló, se conserva el rótulo con el aviso debajo,
  // igual que con el <select> de antes.
  if (pipelinesQuery.isSuccess) {
    return (
      <Select
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        options={pipelinesQuery.data.data.map((pipeline) => ({
          value: pipeline.id,
          label: pipeline.name,
        }))}
        // La fila vacía reemplaza a la <option value="" disabled> de antes:
        // se ofrece solo mientras no hay pipeline elegido, así el campo nunca
        // vuelve a vacío una vez que tiene valor (elegirla sin valor es un
        // no-op, Select solo llama a onChange si el valor cambia). Mismo
        // criterio que UserSelect con clearable={false}.
        emptyOption={value ? undefined : { label: "Elegí uno…" }}
        required={required}
      />
    );
  }

  return (
    <div>
      <label htmlFor={id}>{required ? <span className="ds-required">{label}</span> : label}</label>
      {pipelinesQuery.isLoading ? <InlineLoading /> : null}
      {pipelinesQuery.isError ? (
        <p role="alert">
          No pudimos cargar los procesos de venta
          {pipelinesQuery.error instanceof Error ? `: ${pipelinesQuery.error.message}` : "."}
        </p>
      ) : null}
    </div>
  );
}
