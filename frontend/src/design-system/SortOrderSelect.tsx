import { Select } from "./Select";

export type SortDirection = "asc" | "desc";

interface SortOrderSelectProps {
  value: SortDirection;
  onChange: (sortOrder: SortDirection) => void;
}

// El filtro "Orden" de la barra de filtros, idéntico en los doce listados que
// lo tienen (Actividad, API keys, Sucursal, Empresa, Contacto, Invitación,
// Oportunidad, Pipeline, QR, Fuente, Usuario, Vehículo). Extraído al migrarlo
// al combobox en §46 de docs/frontend-cambios-pendientes.md: era el ÚNICO
// <select> que se repetía letra por letra —mismo rótulo, mismas dos opciones,
// mismo tipo— así que doce copias del mismo bloque de siete líneas era
// duplicación real. "Ordenar por", en cambio, ofrece campos distintos en cada
// listado y se queda inline en cada página.
//
// Vive en el design system y no en un feature porque no pertenece a ninguno:
// cada feature declara su propio `SortOrder = "asc" | "desc"` (doce
// declaraciones estructuralmente idénticas), y todas encajan en `SortDirection`
// por compatibilidad estructural, sin que este componente importe nada de
// features/.
export function SortOrderSelect({ value, onChange }: SortOrderSelectProps) {
  return (
    <Select
      label="Orden"
      value={value}
      options={[
        { value: "desc", label: "Descendente" },
        { value: "asc", label: "Ascendente" },
      ]}
      // Sin emptyOption no hay fila que produzca "", pero el tipo de Select lo
      // admite igual (es el mismo callback para selectores que sí la tienen):
      // el guard descarta ese caso imposible sin recurrir a un cast.
      onChange={(sortOrder) => {
        if (sortOrder) onChange(sortOrder);
      }}
    />
  );
}
