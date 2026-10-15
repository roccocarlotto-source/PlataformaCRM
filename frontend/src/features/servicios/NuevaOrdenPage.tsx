import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { ApiError } from "../../lib/api";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { IntegerInput } from "../../design-system/IntegerInput";
import { LoadingState } from "../../design-system/LoadingState";
import { PageHeader } from "../../design-system/PageHeader";
import { RequiredFieldsHint } from "../../design-system/RequiredFieldsHint";
import { formatDateTime } from "../../design-system/detailFormat";
import { BranchSelect } from "../branch/BranchSelect";
import type { Booking } from "../booking/types";
import { AYUDA } from "../guia/anclas";
import { EncargadoSelect, MonedaSelect, TiposDeLaOrden } from "./camposDeLaOrden";
import { useMonedaPorDefecto } from "./monedaPorDefecto";
import { aMonto, deInputLocal, descripcionDe, nombreDe } from "./formato";
import { useCrearOrden } from "./mutations";
import { useTurno, useVehiculo, useVehiculos } from "./queries";
import { VEHICULO_EN_EL_TALLER, type VehiculoDeCliente } from "./types";

// "Nueva orden" (docs/servicios.md §4.2): elegir el vehículo buscando por
// matrícula (o crearlo si no está), y cargar sucursal, estado inicial (Agendado
// con fecha, o Recibido con km), tipos, notas, encargado y valor. El cliente es
// el dueño del vehículo. Acepta ?vehiculoId= (el botón de la ficha del vehículo)
// y ?turnoId= ("Crear orden de servicio" en el detalle de un turno, §4.4, S4b):
// se elige entre los vehículos del cliente del turno, y la orden nace Agendada
// para su horario, en su sucursal y vinculada a él.

export function NuevaOrdenPage() {
  const [params] = useSearchParams();
  const desdeLaFicha = params.get("vehiculoId") ?? undefined;
  const turnoId = params.get("turnoId") ?? undefined;
  const [elegido, setElegido] = useState<string | undefined>(desdeLaFicha);
  const vehiculo = useVehiculo(elegido);
  const turno = useTurno(turnoId);

  if (turnoId && turno.isLoading) return <LoadingState variant="lines" />;
  if (turnoId && !turno.data) {
    return <ErrorState>No pudimos cargar el turno.</ErrorState>;
  }

  return (
    <div>
      <PageHeader help={AYUDA.nuevaOrden} title="Nueva orden" />
      {turno.data ? <TurnoDeLaOrdenNueva turno={turno.data} /> : null}
      {!elegido ? (
        turno.data ? (
          <ElegirVehiculoDelCliente contactId={turno.data.contactId} onElegir={setElegido} />
        ) : (
          <ElegirVehiculo onElegir={setElegido} />
        )
      ) : null}
      {elegido && vehiculo.isLoading ? <LoadingState variant="lines" /> : null}
      {elegido && vehiculo.isError ? <ErrorState>No pudimos cargar el vehículo.</ErrorState> : null}
      {vehiculo.data ? (
        <FormularioDeOrden
          vehiculo={vehiculo.data}
          turno={turno.data}
          onCambiar={() => setElegido(undefined)}
        />
      ) : null}
    </div>
  );
}

/** El turno desde el que se crea la orden: de solo lectura. */
function TurnoDeLaOrdenNueva({ turno }: { turno: Booking }) {
  return (
    <Card heading="Turno">
      <p>{formatDateTime(turno.startsAt)}</p>
      <p className="ds-hint">La orden queda Agendada para ese horario y vinculada al turno.</p>
    </Card>
  );
}

/** Con turno, el vehículo es uno del cliente del turno (o uno nuevo). */
function ElegirVehiculoDelCliente({
  contactId,
  onElegir,
}: {
  contactId: string;
  onElegir: (id: string) => void;
}) {
  const vehiculos = useVehiculos({ contactId, pageSize: 50 });
  return (
    <Card heading="Vehículo">
      <div className="ds-stack">
        {vehiculos.isLoading ? <LoadingState variant="lines" /> : null}
        {vehiculos.isSuccess && vehiculos.data.data.length === 0 ? (
          <p>El cliente del turno todavía no tiene vehículos cargados.</p>
        ) : null}
        {vehiculos.isSuccess && vehiculos.data.data.length > 0 ? (
          <ul className="ds-stack">
            {vehiculos.data.data.map((v) => (
              <li key={v.id}>
                <button type="button" className="ds-linklike" onClick={() => onElegir(v.id)}>
                  {[v.licensePlate ?? "Sin matrícula", descripcionDe(v)].join(" · ")}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <p>
          <Link to={`/taller/vehiculos/nuevo?contactId=${contactId}`}>
            Cargar un vehículo de este cliente
          </Link>
        </p>
      </div>
    </Card>
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
  turno,
  onCambiar,
}: {
  vehiculo: VehiculoDeCliente;
  // Con turno: Agendada para su horario, en su sucursal y vinculada.
  turno?: Booking;
  onCambiar: () => void;
}) {
  const navigate = useNavigate();
  const crear = useCrearOrden();
  const { me } = useAuth();
  const [sucursal, setSucursal] = useState<string | undefined>(
    turno?.branchId ?? vehiculo.branchId ?? undefined,
  );
  const [estado, setEstado] = useState<"AGENDADO" | "RECIBIDO">(turno ? "AGENDADO" : "RECIBIDO");
  const [fecha, setFecha] = useState("");
  const [km, setKm] = useState(vehiculo.mileage === null ? "" : String(vehiculo.mileage));
  const [danos, setDanos] = useState("");
  const [tipos, setTipos] = useState<string[]>([]);
  // Por defecto, quien la crea (editable; decisión de Rocco tras la prueba de S4a).
  const [encargado, setEncargado] = useState<string | null>(me?.id ?? null);
  const [notas, setNotas] = useState("");
  const [monto, setMonto] = useState("");
  const [moneda, setMoneda] = useState("");
  // Se manda la que muestra el selector: la elegida o la de la organización.
  const monedaPorDefecto = useMonedaPorDefecto();
  const monedaElegida = moneda || monedaPorDefecto;
  const [error, setError] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setOcupada(null);
    if (!sucursal) return setError("Elegí la sucursal.");
    if (estado === "AGENDADO" && !fecha && !turno) {
      return setError("Elegí cuándo se espera el auto.");
    }
    if (estado === "RECIBIDO" && km === "") return setError("Cargá los km al ingreso.");
    try {
      const amount = aMonto(monto);
      const orden = await crear.mutateAsync({
        customerVehicleId: vehiculo.id,
        branchId: sucursal,
        estado,
        ...(estado === "AGENDADO"
          ? turno
            ? {}
            : { scheduledFor: deInputLocal(fecha) }
          : { mileageIn: Number(km), damageNotes: danos.trim() || null }),
        ...(turno ? { bookingId: turno.id } : {}),
        jobTypeIds: tipos,
        assigneeId: encargado,
        notes: notas.trim() || null,
        amount,
        ...(amount !== null && monedaElegida ? { currency: monedaElegida } : {}),
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
            {estado === "AGENDADO" && turno ? (
              <FormField label="Cuándo se espera">
                <span>{`${formatDateTime(turno.startsAt)} (el horario del turno)`}</span>
              </FormField>
            ) : estado === "AGENDADO" ? (
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
            <MonedaSelect id="orden-moneda" value={moneda} onChange={setMoneda} />
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
