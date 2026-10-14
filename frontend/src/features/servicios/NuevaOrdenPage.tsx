import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { IntegerInput } from "../../design-system/IntegerInput";
import { LoadingState } from "../../design-system/LoadingState";
import { PageHeader } from "../../design-system/PageHeader";
import { RequiredFieldsHint } from "../../design-system/RequiredFieldsHint";
import { BranchSelect } from "../branch/BranchSelect";
import { AYUDA } from "../guia/anclas";
import { EncargadoSelect, TiposDeLaOrden } from "./camposDeLaOrden";
import { aMonto, deInputLocal, descripcionDe, nombreDe } from "./formato";
import { useCrearOrden } from "./mutations";
import { useVehiculo, useVehiculos } from "./queries";
import { VEHICULO_EN_EL_TALLER, type VehiculoDeCliente } from "./types";

// "Nueva orden" (docs/servicios.md §4.2): elegir el vehículo buscando por
// matrícula (o crearlo si no está), y cargar sucursal, estado inicial (Agendado
// con fecha, o Recibido con km), tipos, notas, encargado y valor. El cliente es
// el dueño del vehículo. Acepta ?vehiculoId= (el botón de la ficha del vehículo).

export function NuevaOrdenPage() {
  const [params] = useSearchParams();
  const desdeLaFicha = params.get("vehiculoId") ?? undefined;
  const [elegido, setElegido] = useState<string | undefined>(desdeLaFicha);
  const vehiculo = useVehiculo(elegido);

  return (
    <div>
      <PageHeader help={AYUDA.nuevaOrden} title="Nueva orden" />
      {!elegido ? <ElegirVehiculo onElegir={setElegido} /> : null}
      {elegido && vehiculo.isLoading ? <LoadingState variant="lines" /> : null}
      {elegido && vehiculo.isError ? <ErrorState>No pudimos cargar el vehículo.</ErrorState> : null}
      {vehiculo.data ? (
        <FormularioDeOrden vehiculo={vehiculo.data} onCambiar={() => setElegido(undefined)} />
      ) : null}
    </div>
  );
}

function ElegirVehiculo({ onElegir }: { onElegir: (id: string) => void }) {
  const [busqueda, setBusqueda] = useState("");
  const q = busqueda.trim();
  const vehiculos = useVehiculos({ q: q || undefined, pageSize: 10 }, { enabled: q.length > 0 });
  return (
    <Card heading="Vehículo">
      <div className="ds-stack">
        <label>
          <span className="ds-sr-only">Buscar vehículo</span>
          <input
            type="search"
            placeholder="Buscar por matrícula, chasis o dueño"
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
            autoFocus
          />
        </label>
        {q && vehiculos.isSuccess && vehiculos.data.data.length === 0 ? (
          <p>
            {`No hay vehículos que coincidan con "${q}". `}
            <Link to={`/taller/vehiculos/nuevo?matricula=${encodeURIComponent(q)}`}>
              Crear vehículo con esta matrícula
            </Link>
          </p>
        ) : null}
        {vehiculos.isSuccess && vehiculos.data.data.length > 0 ? (
          <ul className="ds-stack">
            {vehiculos.data.data.map((v) => (
              <li key={v.id}>
                <button type="button" className="ds-linklike" onClick={() => onElegir(v.id)}>
                  {[v.licensePlate ?? "Sin matrícula", descripcionDe(v), nombreDe(v.contact)].join(
                    " · ",
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}

function FormularioDeOrden({
  vehiculo,
  onCambiar,
}: {
  vehiculo: VehiculoDeCliente;
  onCambiar: () => void;
}) {
  const navigate = useNavigate();
  const crear = useCrearOrden();
  const [sucursal, setSucursal] = useState<string | undefined>(vehiculo.branchId ?? undefined);
  const [estado, setEstado] = useState<"AGENDADO" | "RECIBIDO">("RECIBIDO");
  const [fecha, setFecha] = useState("");
  const [km, setKm] = useState(vehiculo.mileage === null ? "" : String(vehiculo.mileage));
  const [danos, setDanos] = useState("");
  const [tipos, setTipos] = useState<string[]>([]);
  const [encargado, setEncargado] = useState<string | null>(null);
  const [notas, setNotas] = useState("");
  const [monto, setMonto] = useState("");
  const [moneda, setMoneda] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setOcupada(null);
    if (!sucursal) return setError("Elegí la sucursal.");
    if (estado === "AGENDADO" && !fecha) return setError("Elegí cuándo se espera el auto.");
    if (estado === "RECIBIDO" && km === "") return setError("Cargá los km al ingreso.");
    try {
      const amount = aMonto(monto);
      const orden = await crear.mutateAsync({
        customerVehicleId: vehiculo.id,
        branchId: sucursal,
        estado,
        ...(estado === "AGENDADO"
          ? { scheduledFor: deInputLocal(fecha) }
          : { mileageIn: Number(km), damageNotes: danos.trim() || null }),
        jobTypeIds: tipos,
        assigneeId: encargado,
        notes: notas.trim() || null,
        amount,
        ...(amount !== null && moneda.trim() ? { currency: moneda.trim().toUpperCase() } : {}),
      });
      navigate(`/taller/ordenes/${orden.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.details?.code === VEHICULO_EN_EL_TALLER) {
        setOcupada(typeof err.details.ordenId === "string" ? err.details.ordenId : null);
      }
      setError(err instanceof Error ? err.message : "No pudimos crear la orden");
    }
  }

  return (
    <form onSubmit={guardar} className="ds-form">
      <div className="ds-stack">
        <Card heading="Vehículo">
          <p>
            <Link to={`/taller/vehiculos/${vehiculo.id}`}>
              {[descripcionDe(vehiculo), vehiculo.licensePlate].filter(Boolean).join(" · ")}
            </Link>
            {` — ${nombreDe(vehiculo.contact)}`}{" "}
            <button type="button" className="ds-linklike" onClick={onCambiar}>
              Cambiar
            </button>
          </p>
          {vehiculo.ownershipEndedAt ? (
            <ErrorState>Este vehículo ya no es de un cliente: no se le abren órdenes.</ErrorState>
          ) : null}
          {vehiculo.ordenAbierta ? (
            <p className="ds-hint">
              {"Ya tiene una orden abierta: "}
              <Link to={`/taller/ordenes/${vehiculo.ordenAbierta.id}`}>
                {vehiculo.ordenAbierta.numero}
              </Link>
            </p>
          ) : null}
        </Card>
        <Card heading="Orden">
          <div className="ds-field-grid">
            <BranchSelect
              id="orden-sucursal"
              label="Sucursal"
              required
              value={sucursal}
              onChange={(id) => setSucursal(id || undefined)}
            />
            <fieldset className="ds-stack">
              <legend>Estado inicial</legend>
              <label>
                <input
                  type="radio"
                  name="estado"
                  checked={estado === "RECIBIDO"}
                  onChange={() => setEstado("RECIBIDO")}
                />{" "}
                Recibido: el auto ya está en el taller
              </label>
              <label>
                <input
                  type="radio"
                  name="estado"
                  checked={estado === "AGENDADO"}
                  onChange={() => setEstado("AGENDADO")}
                />{" "}
                Agendado: viene más adelante
              </label>
            </fieldset>
            {estado === "AGENDADO" ? (
              <FormField label={<span className="ds-required">Cuándo se espera</span>}>
                <input
                  type="datetime-local"
                  value={fecha}
                  onChange={(event) => setFecha(event.target.value)}
                />
              </FormField>
            ) : (
              <>
                <FormField label={<span className="ds-required">Km al ingreso</span>}>
                  <IntegerInput value={km} onChange={setKm} />
                </FormField>
                <div className="ds-field-grid--full">
                  <FormField label="Daños al ingreso">
                    <textarea
                      rows={2}
                      maxLength={4000}
                      value={danos}
                      onChange={(event) => setDanos(event.target.value)}
                    />
                  </FormField>
                </div>
              </>
            )}
            <div className="ds-field-grid--full">
              <TiposDeLaOrden value={tipos} onChange={setTipos} />
            </div>
            <EncargadoSelect value={encargado ?? undefined} onChange={setEncargado} />
            <div className="ds-field-grid--full">
              <FormField label="Notas">
                <textarea
                  rows={3}
                  maxLength={8000}
                  placeholder="Qué servicio se hace"
                  value={notas}
                  onChange={(event) => setNotas(event.target.value)}
                />
              </FormField>
            </div>
            <FormField label="Valor">
              <input
                type="text"
                inputMode="decimal"
                value={monto}
                onChange={(event) => setMonto(event.target.value)}
              />
            </FormField>
            <FormField label="Moneda">
              <input
                type="text"
                maxLength={3}
                placeholder="La de la organización"
                value={moneda}
                onChange={(event) => setMoneda(event.target.value)}
              />
            </FormField>
          </div>
        </Card>
        {error ? (
          <ErrorState>
            {error}
            {ocupada ? (
              <>
                {" "}
                <Link to={`/taller/ordenes/${ocupada}`}>Abrir la orden</Link>
              </>
            ) : null}
          </ErrorState>
        ) : null}
        <div>
          <RequiredFieldsHint />
          <Button
            type="submit"
            variant="primary"
            disabled={crear.isPending || vehiculo.ownershipEndedAt !== null}
            loading={crear.isPending}
          >
            {crear.isPending ? "Creando…" : "Crear orden"}
          </Button>
        </div>
      </div>
    </form>
  );
}
