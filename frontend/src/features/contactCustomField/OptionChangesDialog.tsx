import { useState } from "react";
import { Modal } from "../../design-system/Modal";
import { Select } from "../../design-system/Select";
import type { ContactCustomFieldType, DecisionSobreEliminada } from "./types";

// ---------------------------------------------------------------------------
// Antes de guardar un cambio de opciones que toca a contactos: qué pasa con
// cada opción renombrada (informativo: sus contactos pasan al texto nuevo) y
// qué hacer con cada opción ELIMINADA que algún contacto tiene elegida. Por
// cada eliminada, un selector:
//   - "Dejar sin cargar" (por defecto): se saca del contacto;
//   - "Pasar a: <opción>": se reemplaza por esa opción;
//   - en selección múltiple, "Pasar a todas las nuevas": se reemplaza por
//     todas las opciones que se agregaron en este guardado (el caso de partir
//     «Contado, financiado, permuta» en tres);
//   - "Conservar como opción eliminada": el contacto se queda con el texto
//     viejo, marcado en su ficha.
// Lo elegido viaja como removedOptions y el backend lo aplica en la misma
// transacción que la definición, solo en esta organización.
// ---------------------------------------------------------------------------

export interface OpcionRenombradaEnUso {
  from: string;
  to: string;
  contactos: number;
}

export interface OpcionEliminadaEnUso {
  opcion: string;
  contactos: number;
}

export interface OptionChangesDialogProps {
  type: ContactCustomFieldType;
  renombradas: OpcionRenombradaEnUso[];
  eliminadas: OpcionEliminadaEnUso[];
  // Las opciones que quedan después de guardar, en orden.
  opcionesFinales: string[];
  // Las que se agregaron en este guardado (sin opción guardada detrás).
  opcionesAgregadas: string[];
  guardando?: boolean;
  onConfirm: (decisiones: Record<string, DecisionSobreEliminada>) => void;
  onClose: () => void;
}

const SIN_CARGAR = "clear";
const CONSERVAR = "keep";
const TODAS_LAS_NUEVAS = "all";
const PASAR_A = "to:";

function contactosQueLaTienen(cantidad: number): string {
  return cantidad === 1
    ? "un contacto la tiene elegida"
    : `${cantidad} contactos la tienen elegida`;
}

export function OptionChangesDialog({
  type,
  renombradas,
  eliminadas,
  opcionesFinales,
  opcionesAgregadas,
  guardando = false,
  onConfirm,
  onClose,
}: OptionChangesDialogProps) {
  const [elecciones, setElecciones] = useState<Record<string, string>>({});
  const ofreceTodasLasNuevas = type === "MULTI_SELECT" && opcionesAgregadas.length > 1;

  function eleccionDe(opcion: string): string {
    return elecciones[opcion] ?? SIN_CARGAR;
  }

  function confirmar() {
    const decisiones: Record<string, DecisionSobreEliminada> = {};
    for (const { opcion } of eliminadas) {
      const eleccion = eleccionDe(opcion);
      if (eleccion === SIN_CARGAR) decisiones[opcion] = { action: "clear" };
      else if (eleccion === CONSERVAR) decisiones[opcion] = { action: "keep" };
      else if (eleccion === TODAS_LAS_NUEVAS)
        decisiones[opcion] = { action: "move", to: opcionesAgregadas };
      else decisiones[opcion] = { action: "move", to: [eleccion.slice(PASAR_A.length)] };
    }
    onConfirm(decisiones);
  }

  return (
    <Modal
      variant="dialog"
      title="Opciones que ya usan contactos"
      closeLabel="Cancelar"
      onClose={onClose}
      primaryAction={{ label: "Guardar", onClick: confirmar, loading: guardando }}
    >
      <div className="ds-stack">
        {renombradas.map(({ from, to, contactos }) => (
          <p key={from}>
            «{from}» pasa a llamarse «{to}»: se actualiza en {contactosQueLaTienen(contactos)}.
          </p>
        ))}
        {eliminadas.map(({ opcion, contactos }) => (
          <div key={opcion}>
            <p>
              «{opcion}» se elimina de la lista y {contactosQueLaTienen(contactos)}.
            </p>
            <Select
              id={`opcion-eliminada-${opcion}`}
              label={`Qué hacer con «${opcion}»`}
              value={eleccionDe(opcion)}
              options={[
                { value: SIN_CARGAR, label: "Dejar sin cargar" },
                ...opcionesFinales.map((destino) => ({
                  value: `${PASAR_A}${destino}`,
                  label: `Pasar a: ${destino}`,
                })),
                ...(ofreceTodasLasNuevas
                  ? [
                      {
                        value: TODAS_LAS_NUEVAS,
                        label: `Pasar a todas las nuevas (${opcionesAgregadas.join(", ")})`,
                      },
                    ]
                  : []),
                { value: CONSERVAR, label: "Conservar como opción eliminada" },
              ]}
              onChange={(eleccion) => {
                if (eleccion) setElecciones({ ...elecciones, [opcion]: eleccion });
              }}
            />
          </div>
        ))}
      </div>
    </Modal>
  );
}
