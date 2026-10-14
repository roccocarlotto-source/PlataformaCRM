import { FormField } from "../../design-system/FormField";
import { InlineLoading } from "../../design-system/LoadingState";
import { Select } from "../../design-system/Select";
import { CURRENCY_OPTIONS, isKnownCurrency } from "../../lib/currencies";
import { useMonedaPorDefecto } from "./monedaPorDefecto";
import { useTiposDeService, useUsuariosDelTaller } from "./queries";

// Piezas que comparten "Nueva orden" y la edición de una orden.

/** Moneda del Valor: un selector cerrado (antes era texto libre y, vacío,
 *  fallaba en una organización sin moneda: prueba de S4a). `value` vacío =
 *  todavía no eligió, se muestra la de la organización. */
export function MonedaSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (moneda: string) => void;
}) {
  const porDefecto = useMonedaPorDefecto();
  const vigente = value || porDefecto || "";
  return (
    <Select
      id={id}
      label="Moneda"
      value={vigente || undefined}
      options={[
        // Una moneda guardada fuera de la lista se muestra mientras sea la
        // vigente (mismo criterio que Organización y Oportunidad).
        ...(vigente === "" || isKnownCurrency(vigente) ? [] : [{ value: vigente, label: vigente }]),
        ...CURRENCY_OPTIONS.map((moneda) => ({ value: moneda, label: moneda })),
      ]}
      onChange={(moneda) => onChange(moneda)}
    />
  );
}

/** El encargado: cualquier usuario activo de la organización (D9). Sale de
 *  GET /api/servicios/usuarios, abierto a ADMIN y USER. */
export function EncargadoSelect({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (id: string | null) => void;
}) {
  const usuarios = useUsuariosDelTaller();
  if (!usuarios.isSuccess) {
    return (
      <FormField label="Encargado">
        {usuarios.isError ? "No pudimos cargar los usuarios." : <InlineLoading />}
      </FormField>
    );
  }
  return (
    <Select
      id="orden-encargado"
      label="Encargado"
      value={value}
      options={usuarios.data.map((u) => ({ value: u.id, label: u.fullName }))}
      emptyOption={{ label: "Sin encargado" }}
      onChange={(id) => onChange(id || null)}
    />
  );
}

/** Los tipos de service de la orden: casillas con los activos, y los que la
 *  orden ya tenía aunque ahora estén inactivos. */
export function TiposDeLaOrden({
  value,
  onChange,
  yaTenia = [],
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  yaTenia?: { id: string; name: string }[];
}) {
  const tipos = useTiposDeService(true);
  const opciones = [
    ...(tipos.data ?? []),
    ...yaTenia.filter((t) => !(tipos.data ?? []).some((a) => a.id === t.id)),
  ];
  return (
    <fieldset className="ds-stack">
      <legend>Tipos de service</legend>
      {tipos.isLoading ? <InlineLoading /> : null}
      {tipos.isSuccess && opciones.length === 0 ? (
        <p className="ds-hint">
          Todavía no hay tipos de service. Un administrador los carga en Taller → Configuración.
        </p>
      ) : null}
      {opciones.map((t) => (
        <label key={t.id}>
          <input
            type="checkbox"
            checked={value.includes(t.id)}
            onChange={(event) =>
              onChange(event.target.checked ? [...value, t.id] : value.filter((id) => id !== t.id))
            }
          />{" "}
          {t.name}
          {"nextServiceAfterMonths" in t && t.nextServiceAfterMonths
            ? ` (próximo a los ${t.nextServiceAfterMonths} meses)`
            : ""}
        </label>
      ))}
    </fieldset>
  );
}
