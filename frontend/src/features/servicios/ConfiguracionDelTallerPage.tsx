import { useState, type FormEvent } from "react";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { PageHeader } from "../../design-system/PageHeader";
import { Table } from "../../design-system/Table";
import { useConfirm } from "../../design-system/useConfirm";
import { AYUDA } from "../guia/anclas";
import {
  useActualizarTipo,
  useBorrarTipo,
  useCrearTipo,
  useGuardarConfiguracion,
} from "./mutations";
import { useConfiguracionDelTaller, useTiposDeService } from "./queries";
import type { ConfiguracionDelTaller, TipoDeService } from "./types";

// Taller → Configuración (docs/servicios.md §4.8), solo ADMIN: los intervalos
// por defecto y los tipos de service con su "próximo service a los N meses".
// Los recordatorios no se configuran acá: son reglas de Automatizaciones (S7).

/** "" = sin intervalo (null); si no, los meses. */
function aMeses(valor: string): number | null {
  return valor.trim() === "" ? null : Number(valor);
}

export function ConfiguracionDelTallerPage() {
  return (
    <div>
      <PageHeader help={AYUDA.configuracionDelTaller} title="Configuración del taller" />
      <div className="ds-stack">
        <Intervalos />
        <Tipos />
      </div>
    </div>
  );
}

function Intervalos() {
  const configuracion = useConfiguracionDelTaller();
  if (configuracion.isLoading) return <LoadingState variant="lines" />;
  if (configuracion.isError || !configuracion.data) {
    return <ErrorState>No pudimos cargar la configuración.</ErrorState>;
  }
  return <FormularioDeIntervalos inicial={configuracion.data} />;
}

function FormularioDeIntervalos({ inicial }: { inicial: ConfiguracionDelTaller }) {
  const guardar = useGuardarConfiguracion();
  const [porDefecto, setPorDefecto] = useState(String(inicial.defaultNextServiceMonths ?? ""));
  const [primero, setPrimero] = useState(String(inicial.firstServiceAfterMonths ?? ""));
  const [guardado, setGuardado] = useState(false);

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGuardado(false);
    await guardar.mutateAsync({
      defaultNextServiceMonths: aMeses(porDefecto),
      firstServiceAfterMonths: aMeses(primero),
    });
    setGuardado(true);
  }

  return (
    <form onSubmit={enviar} className="ds-form">
      <Card heading="Próximo service">
        <div className="ds-field-grid">
          <FormField label="Intervalo por defecto (meses)">
            <input
              type="number"
              min={1}
              max={60}
              value={porDefecto}
              onChange={(event) => setPorDefecto(event.target.value)}
            />
          </FormField>
          <FormField label="Primer service de un auto vendido (meses)">
            <input
              type="number"
              min={1}
              max={60}
              value={primero}
              onChange={(event) => setPrimero(event.target.value)}
            />
          </FormField>
        </div>
        <p className="ds-hint">
          El intervalo por defecto se usa al entregar una orden sin tipos con intervalo. Vacío: no
          se propone fecha. El primer service de un auto vendido se aplica cuando las ventas pasan
          al taller.
        </p>
        {guardar.isError ? (
          <ErrorState>
            {guardar.error instanceof Error ? guardar.error.message : "No pudimos guardar."}
          </ErrorState>
        ) : null}
        {guardado ? <p className="ds-hint">Guardado.</p> : null}
        <Button
          type="submit"
          variant="primary"
          disabled={guardar.isPending}
          loading={guardar.isPending}
        >
          Guardar
        </Button>
      </Card>
    </form>
  );
}

function Tipos() {
  const tipos = useTiposDeService(false);
  const crear = useCrearTipo();
  const [nombre, setNombre] = useState("");
  const [meses, setMeses] = useState("");

  async function agregar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await crear.mutateAsync({ name: nombre.trim(), nextServiceAfterMonths: aMeses(meses) });
    setNombre("");
    setMeses("");
  }

  return (
    <Card heading="Tipos de service">
      {tipos.isLoading ? <LoadingState variant="rows" /> : null}
      {tipos.isError ? <ErrorState>No pudimos cargar los tipos.</ErrorState> : null}
      {tipos.isSuccess && tipos.data.length === 0 ? (
        <EmptyState>Todavía no hay tipos de service.</EmptyState>
      ) : null}
      {tipos.isSuccess && tipos.data.length > 0 ? (
        <Table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Próximo service</th>
              <th>Activo</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {tipos.data.map((t) => (
              <FilaDeTipo key={t.id} tipo={t} />
            ))}
          </tbody>
        </Table>
      ) : null}
      <form onSubmit={agregar} className="ds-filters">
        <label>
          <span className="ds-sr-only">Nombre del tipo nuevo</span>
          <input
            type="text"
            required
            maxLength={120}
            placeholder="Service 10.000 km"
            value={nombre}
            onChange={(event) => setNombre(event.target.value)}
          />
        </label>
        <label>
          <span className="ds-sr-only">Meses hasta el próximo service</span>
          <input
            type="number"
            min={1}
            max={60}
            placeholder="Meses (vacío: no fija)"
            value={meses}
            onChange={(event) => setMeses(event.target.value)}
          />
        </label>
        <Button type="submit" disabled={crear.isPending || !nombre.trim()}>
          Agregar tipo
        </Button>
      </form>
      {crear.isError ? (
        <ErrorState>
          {crear.error instanceof Error ? crear.error.message : "No pudimos agregar el tipo."}
        </ErrorState>
      ) : null}
    </Card>
  );
}

function FilaDeTipo({ tipo }: { tipo: TipoDeService }) {
  const confirm = useConfirm();
  const actualizar = useActualizarTipo();
  const borrar = useBorrarTipo();

  async function eliminar() {
    const ok = await confirm(
      `¿Eliminar "${tipo.name}"? Las órdenes que lo tuvieron lo siguen mostrando.`,
      { confirmLabel: "Eliminar", danger: true },
    );
    if (ok) borrar.mutate(tipo.id);
  }

  return (
    <tr>
      <td className="ds-cell-primary">{tipo.name}</td>
      <td>
        {tipo.nextServiceAfterMonths ? `A los ${tipo.nextServiceAfterMonths} meses` : "No fija"}
      </td>
      <td>
        <input
          type="checkbox"
          aria-label={`${tipo.name} activo`}
          checked={tipo.isActive}
          onChange={(event) => actualizar.mutate({ id: tipo.id, isActive: event.target.checked })}
        />
      </td>
      <td>
        <Button type="button" variant="danger" onClick={eliminar}>
          Eliminar
        </Button>
      </td>
    </tr>
  );
}
