import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { IntegerInput } from "../../design-system/IntegerInput";
import { LoadingState } from "../../design-system/LoadingState";
import { PageHeader } from "../../design-system/PageHeader";
import { RequiredFieldsHint } from "../../design-system/RequiredFieldsHint";
import { useFormDraft } from "../../lib/useFormDraft";
import { BranchSelect } from "../branch/BranchSelect";
import { AYUDA } from "../guia/anclas";
import { ContactSelect } from "../opportunity/ContactSelect";
import { vehiculoDuplicadoDe } from "./formato";
import { useActualizarVehiculo, useCrearVehiculo } from "./mutations";
import { useVehiculo } from "./queries";
import type { CamposDelVehiculoInput, VehiculoDeCliente } from "./types";

// Alta y edición de un vehículo de cliente (docs/servicios.md §4.5). El dueño
// se elige solo al crear: después se cambia con "Cambiar dueño" en la ficha
// (el backend rechaza contactId en el PATCH). Lo abren ADMIN y USER (D9).
//
// Al crear acepta ?matricula= (el "Crear vehículo con esta matrícula" del
// listado) y ?contactId= (el "Agregar vehículo" de la ficha del contacto).

interface Valores {
  contactId: string | undefined;
  make: string;
  model: string;
  year: string;
  licensePlate: string;
  vin: string;
  mileage: string;
  branchId: string | undefined;
  purchasedOn: string;
  nextServiceDueOn: string;
  remindersOptOut: boolean;
  notes: string;
}

const VACIO: Valores = {
  contactId: undefined,
  make: "",
  model: "",
  year: "",
  licensePlate: "",
  vin: "",
  mileage: "",
  branchId: undefined,
  purchasedOn: "",
  nextServiceDueOn: "",
  remindersOptOut: false,
  notes: "",
};

function aValores(v: VehiculoDeCliente): Valores {
  return {
    contactId: v.contactId,
    make: v.make,
    model: v.model,
    year: v.year === null ? "" : String(v.year),
    licensePlate: v.licensePlate ?? "",
    vin: v.vin ?? "",
    mileage: v.mileage === null ? "" : String(v.mileage),
    branchId: v.branchId ?? undefined,
    purchasedOn: v.purchasedOn ?? "",
    nextServiceDueOn: v.nextServiceDueOn ?? "",
    remindersOptOut: v.remindersOptOut,
    notes: v.notes ?? "",
  };
}

// Vacío viaja como null: así "borrar el contenido de un campo" limpia el dato.
function aInput(v: Valores): Required<CamposDelVehiculoInput> {
  return {
    make: v.make,
    model: v.model,
    year: v.year ? Number(v.year) : null,
    licensePlate: v.licensePlate.trim() || null,
    vin: v.vin.trim() || null,
    mileage: v.mileage ? Number(v.mileage) : null,
    branchId: v.branchId || null,
    purchasedOn: v.purchasedOn || null,
    nextServiceDueOn: v.nextServiceDueOn || null,
    remindersOptOut: v.remindersOptOut,
    notes: v.notes.trim() || null,
  };
}

export function VehiculoDeClienteFormPage() {
  const { id } = useParams<{ id?: string }>();
  const esEdicion = id !== undefined;
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const vehiculoQuery = useVehiculo(esEdicion ? id : undefined);
  const crear = useCrearVehiculo();
  const actualizar = useActualizarVehiculo(id ?? "");

  const [valores, setValores] = useFormDraft<Valores>(
    vehiculoQuery.data?.id,
    vehiculoQuery.data
      ? aValores(vehiculoQuery.data)
      : {
          ...VACIO,
          licensePlate: params.get("matricula") ?? "",
          contactId: params.get("contactId") ?? undefined,
        },
  );
  const [error, setError] = useState<string | null>(null);
  const [duplicado, setDuplicado] = useState<string | null>(null);

  const guardando = crear.isPending || actualizar.isPending;

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setDuplicado(null);
    if (!esEdicion && !valores.contactId) {
      setError("Elegí el dueño del vehículo.");
      return;
    }
    try {
      const guardado = esEdicion
        ? await actualizar.mutateAsync(aInput(valores))
        : await crear.mutateAsync({ ...aInput(valores), contactId: valores.contactId ?? "" });
      navigate(`/taller/vehiculos/${guardado.id}`);
    } catch (err) {
      setDuplicado(vehiculoDuplicadoDe(err));
      setError(err instanceof Error ? err.message : "No pudimos guardar el vehículo");
    }
  }

  if (esEdicion && vehiculoQuery.isLoading) return <LoadingState variant="lines" />;
  if (esEdicion && vehiculoQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar el vehículo
        {vehiculoQuery.error instanceof Error ? `: ${vehiculoQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  const set = <K extends keyof Valores>(campo: K, valor: Valores[K]) =>
    setValores({ ...valores, [campo]: valor });

  return (
    <form onSubmit={guardar} className="ds-form">
      <PageHeader
        help={AYUDA.vehiculoDeClienteForm}
        title={esEdicion ? "Editar vehículo" : "Nuevo vehículo"}
      />
      <div className="ds-stack">
        <Card heading="Datos del vehículo">
          <div className="ds-field-grid">
            {esEdicion ? null : (
              <div className="ds-field-grid--full">
                <ContactSelect
                  id="vehiculo-dueno"
                  label="Dueño"
                  value={valores.contactId}
                  onChange={(contactId) => set("contactId", contactId)}
                />
              </div>
            )}
            <FormField label={<span className="ds-required">Marca</span>}>
              <input
                type="text"
                value={valores.make}
                maxLength={60}
                onChange={(event) => set("make", event.target.value)}
                required
              />
            </FormField>
            <FormField label={<span className="ds-required">Modelo</span>}>
              <input
                type="text"
                value={valores.model}
                maxLength={80}
                onChange={(event) => set("model", event.target.value)}
                required
              />
            </FormField>
            <FormField label="Año">
              <input
                type="number"
                min={1900}
                max={new Date().getFullYear() + 1}
                value={valores.year}
                onChange={(event) => set("year", event.target.value)}
              />
            </FormField>
            <FormField label="Kilómetros">
              <IntegerInput value={valores.mileage} onChange={(v) => set("mileage", v)} />
            </FormField>
            <FormField label="Matrícula">
              <input
                type="text"
                value={valores.licensePlate}
                maxLength={20}
                onChange={(event) => set("licensePlate", event.target.value)}
              />
            </FormField>
            <FormField label="Chasis">
              <input
                type="text"
                value={valores.vin}
                maxLength={30}
                onChange={(event) => set("vin", event.target.value)}
              />
            </FormField>
            <BranchSelect
              id="vehiculo-sucursal"
              label="Sucursal de referencia"
              value={valores.branchId}
              emptyOptionLabel="Sin sucursal"
              onChange={(branchId) => set("branchId", branchId || undefined)}
            />
            <FormField label="Fecha de compra">
              <input
                type="date"
                value={valores.purchasedOn}
                onChange={(event) => set("purchasedOn", event.target.value)}
              />
            </FormField>
            <FormField label="Próximo service">
              <input
                type="date"
                value={valores.nextServiceDueOn}
                onChange={(event) => set("nextServiceDueOn", event.target.value)}
              />
            </FormField>
            <FormField label="No recordar">
              <input
                type="checkbox"
                checked={valores.remindersOptOut}
                onChange={(event) => set("remindersOptOut", event.target.checked)}
              />
            </FormField>
            <div className="ds-field-grid--full">
              <FormField label="Notas">
                <textarea
                  value={valores.notes}
                  maxLength={2000}
                  rows={3}
                  onChange={(event) => set("notes", event.target.value)}
                />
              </FormField>
            </div>
          </div>
        </Card>
        {error ? (
          <ErrorState>
            {error}
            {duplicado ? (
              <>
                {" "}
                <Link to={`/taller/vehiculos/${duplicado}`}>Abrir el vehículo</Link>
              </>
            ) : null}
          </ErrorState>
        ) : null}
        <div>
          <RequiredFieldsHint />
          <Button type="submit" variant="primary" disabled={guardando} loading={guardando}>
            {guardando ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </form>
  );
}
