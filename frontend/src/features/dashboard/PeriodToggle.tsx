import type { OpportunityRevenueGranularity } from "../opportunity/types";
import { PERIODS } from "./period";

interface PeriodToggleProps {
  value: OpportunityRevenueGranularity;
  onChange: (value: OpportunityRevenueGranularity) => void;
}

// Segmented control de texto, con el mismo patrón visual y accesible que
// ThemeToggle (role="group" con nombre + aria-pressed por botón): un lector de
// pantalla anuncia "Semanal, botón, presionado".
//
// Nació en el header de la tarjeta del gráfico (§33) y en el §35 se mudó al
// header de la página, junto al <h1>: dejó de controlar una tarjeta para
// controlar todo el Dashboard. El componente no cambió al mudarse —es el mismo
// markup y las mismas clases—, solo dejó de vivir adentro de uno de sus
// consumidores.
export function PeriodToggle({ value, onChange }: PeriodToggleProps) {
  return (
    <div className="ds-period-toggle" role="group" aria-label="Período">
      {PERIODS.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className={`ds-period-toggle-button${isActive ? " is-active" : ""}`}
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
          >
            {option.button}
          </button>
        );
      })}
    </div>
  );
}
