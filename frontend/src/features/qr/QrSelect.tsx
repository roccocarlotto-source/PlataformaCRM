import { Select } from "../../design-system/Select";
import { BRANCHES_PARA_SELECT, useBranches } from "../branch/queries";
import { QRS_PARA_SELECT, useQrCodes } from "./queries";

interface QrSelectProps {
  id?: string;
  label: string;
  value: string | undefined;
  onChange: (qrCodeId: string) => void;
  required?: boolean;
  disabled?: boolean;
}

// Selector de un QR de la organización (ítem 159: la acción "Enviar QR por
// WhatsApp" del motor de automatizaciones). Plantilla directa: BranchSelect.
// El listado del backend ya trae solo los QR activos (deletedAt: null en el
// repositorio). Cada QR es de una sucursal, así que la sucursal va en el
// subtítulo junto con el destino: es lo que distingue dos "QR 1" de sucursales
// distintas y lo que el cliente va a recibir.
export function QrSelect({
  id,
  label,
  value,
  onChange,
  required = false,
  disabled = false,
}: QrSelectProps) {
  const qrCodesQuery = useQrCodes(QRS_PARA_SELECT);
  // Solo para el nombre de la sucursal en el subtítulo: si no carga, el QR se
  // puede elegir igual.
  const branchesQuery = useBranches(BRANCHES_PARA_SELECT);

  if (qrCodesQuery.isSuccess) {
    const sucursales = new Map(
      (branchesQuery.data?.data ?? []).map((branch) => [branch.id, branch.name]),
    );
    return (
      <Select
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        options={qrCodesQuery.data.data.map((qr) => ({
          value: qr.id,
          label: [qr.displayNumber === null ? null : `QR ${qr.displayNumber}`, qr.name]
            .filter(Boolean)
            .join(" · "),
          subtitle: [qr.branchId ? sucursales.get(qr.branchId) : undefined, qr.destinationUrl]
            .filter(Boolean)
            .join(" · "),
        }))}
        emptyOption={{ label: "Elegir QR…" }}
        required={required}
        disabled={disabled}
      />
    );
  }

  return (
    <div>
      <label htmlFor={id}>{required ? <span className="ds-required">{label}</span> : label}</label>
      {qrCodesQuery.isLoading ? <p>Cargando…</p> : null}
      {qrCodesQuery.isError ? (
        <p role="alert">
          No pudimos cargar los QR
          {qrCodesQuery.error instanceof Error ? `: ${qrCodesQuery.error.message}` : "."}
        </p>
      ) : null}
    </div>
  );
}
