import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { Select } from "../../design-system/Select";
import { configurarLote } from "./api";
import {
  COMBUSTIBLES,
  CONDICIONES,
  DESTINOS,
  ESTADOS_DE_STOCK,
  ETAPAS,
  POLITICAS,
  TIPOS_DE_HISTORIAL,
  TRANSMISIONES,
  opcionesDeDestino,
} from "./labels";
import { importacionKeys } from "./queries";
import type {
  Ajustes,
  AjustesDeStock,
  FormatoDeFecha,
  Lote,
  OpcionesDeImportacion,
  Politica,
  TipoDeHistorial,
  TipoImportable,
  ValorDeCelda,
} from "./types";

// ---------------------------------------------------------------------------
// Pasos 3 y 4 del asistente (docs/importacion-de-datos.md §8.1): a qué campo
// va cada columna del archivo, y cómo leer sus valores. Guardar manda el lote
// a analizar: la vista previa la calcula el worker, no el navegador.
// ---------------------------------------------------------------------------

const SI_POR_DEFECTO = ["sí", "si", "s", "x", "1", "true", "yes", "verdadero"];
const NO_POR_DEFECTO = ["no", "n", "0", "false", "falso"];

function lista(texto: string): string[] {
  return texto
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");
}

function clave(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

// Los valores distintos de la columna mapeada a `destino`, en la muestra.
function valoresDeColumna(
  mapeo: Record<string, string>,
  destino: string,
  muestra: Record<string, ValorDeCelda>[],
): { columna: string | undefined; valores: string[] } {
  const columna = Object.entries(mapeo).find(([, d]) => d === destino)?.[0];
  if (!columna) return { columna, valores: [] };
  const vistos = new Map<string, string>();
  for (const fila of muestra) {
    const v = fila[columna];
    if (v === null || String(v).trim() === "") continue;
    const t = String(v).trim();
    if (!vistos.has(clave(t))) vistos.set(clave(t), t);
  }
  return { columna, valores: [...vistos.values()] };
}

// Solo los valores que aparecen en la muestra (los de otro archivo no sirven).
function soloLosVistos<T>(mapa: Record<string, T>, valores: string[]): Record<string, T> {
  return Object.fromEntries(Object.entries(mapa).filter(([valor]) => valores.includes(valor)));
}

// "Qué es cada valor del origen": un Select por valor distinto de la columna.
// Lo usan la etapa, el tipo de actividad y, en el stock, el estado, la
// condición, el combustible y la caja.
function MapeoDeValores<T extends string>({
  titulo,
  columna,
  valores,
  opciones,
  mapa,
  sinAsignar,
  onChange,
}: {
  titulo: string;
  columna: string | undefined;
  valores: string[];
  opciones: { value: T; label: string }[];
  mapa: Record<string, T>;
  sinAsignar: string;
  onChange: (mapa: Record<string, T>) => void;
}) {
  if (!columna || valores.length === 0) return null;
  return (
    <div className="ds-stack">
      <p className="ds-hint">
        {titulo} «{columna}».
      </p>
      <div className="ds-field-grid">
        {valores.map((valor) => (
          <Select
            key={valor}
            label={valor}
            value={mapa[valor] ?? ""}
            options={opciones}
            emptyOption={{ label: sinAsignar }}
            onChange={(elegido) => {
              const nuevo = { ...mapa };
              if (elegido === "") delete nuevo[valor];
              else nuevo[valor] = elegido;
              onChange(nuevo);
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function PasoMapeo({
  organizationId,
  lote,
  opciones,
  sugerido,
  sinEmpresas = false,
  muestra,
  onGuardado,
  onCancelar,
}: {
  organizationId: string;
  lote: Lote;
  opciones: OpcionesDeImportacion;
  sugerido: Record<string, string>;
  // La organización destino no tiene empresas (ESENCIAL): sin la casilla.
  sinEmpresas?: boolean;
  muestra: Record<string, ValorDeCelda>[];
  onGuardado: () => void;
  onCancelar?: () => void;
}) {
  const tipo = lote.entityType as TipoImportable;
  const encabezados = lote.config.archivo.encabezados;
  const previos = lote.config.ajustes;
  const [mapeo, setMapeo] = useState<Record<string, string>>(previos?.mapeo ?? sugerido);
  const [fecha, setFecha] = useState<FormatoDeFecha>(previos?.formato.fecha ?? "DD/MM/AAAA");
  const [decimal, setDecimal] = useState<"," | ".">(previos?.formato.separadorDecimal ?? ",");
  const [opcionesSep, setOpcionesSep] = useState<";" | ",">(
    previos?.formato.separadorDeOpciones ?? ";",
  );
  const [si, setSi] = useState((previos?.formato.si ?? SI_POR_DEFECTO).join(", "));
  const [no, setNo] = useState((previos?.formato.no ?? NO_POR_DEFECTO).join(", "));
  const [duplicados, setDuplicados] = useState<Politica>(previos?.duplicados ?? "FILL_EMPTY");
  const [crearEmpresas, setCrearEmpresas] = useState(previos?.crearEmpresas ?? true);
  const [etapas, setEtapas] = useState(previos?.etapas ?? {});

  // El usuario por defecto (autor del historial, responsable del stock) es el
  // ADMIN más antiguo (decisión 5); la lista viene ordenada por antigüedad.
  const usuarioPorDefecto =
    opciones.usuarios.find((u) => u.rol === "ADMIN")?.id ?? opciones.usuarios[0]?.id ?? "";
  const opcionesDeUsuario = opciones.usuarios.map((u) => ({
    value: u.id,
    label: u.fullName,
    subtitle: u.email,
  }));

  // Historial.
  const [autorId, setAutorId] = useState(previos?.historial?.autorId ?? usuarioPorDefecto);
  const [tipoPorDefecto, setTipoPorDefecto] = useState<TipoDeHistorial | "">(
    previos?.historial?.tipoPorDefecto ?? "",
  );
  const [tipos, setTipos] = useState(previos?.historial?.tipos ?? {});

  // Stock.
  const sucursales = opciones.sucursales ?? [];
  const [stock, setStock] = useState<AjustesDeStock>(
    previos?.stock ?? {
      branchId: sucursales.length === 1 ? sucursales[0].id : "",
      responsableId: usuarioPorDefecto,
      condicionPorDefecto: "USED",
      monedaPorDefecto: "USD",
      importarVendidas: false,
      estados: {},
      condiciones: {},
      combustibles: {},
      transmisiones: {},
    },
  );
  const cambiarStock = (cambios: Partial<AjustesDeStock>) => setStock({ ...stock, ...cambios });

  const destinos = opcionesDeDestino(tipo, opciones.camposPersonalizados);
  const deEtapa = useMemo(
    () => valoresDeColumna(mapeo, "lifecycleStage", muestra),
    [mapeo, muestra],
  );
  const deTipo = useMemo(() => valoresDeColumna(mapeo, "type", muestra), [mapeo, muestra]);
  const deEstado = useMemo(() => valoresDeColumna(mapeo, "status", muestra), [mapeo, muestra]);
  const deCondicion = useMemo(
    () => valoresDeColumna(mapeo, "condition", muestra),
    [mapeo, muestra],
  );
  const deCombustible = useMemo(
    () => valoresDeColumna(mapeo, "fuelType", muestra),
    [mapeo, muestra],
  );
  const deCaja = useMemo(() => valoresDeColumna(mapeo, "transmission", muestra), [mapeo, muestra]);

  const queryClient = useQueryClient();
  const guardar = useMutation({
    mutationFn: (ajustes: Ajustes) => configurarLote(organizationId, lote.id, ajustes),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: importacionKeys.lote(organizationId, lote.id),
      });
      onGuardado();
    },
  });

  function cambiarDestino(encabezado: string, destino: string) {
    const nuevo = { ...mapeo };
    if (destino === "") delete nuevo[encabezado];
    else {
      // Un destino va en una sola columna: si otra ya lo tenía, se le saca.
      for (const [h, d] of Object.entries(nuevo)) if (d === destino) delete nuevo[h];
      nuevo[encabezado] = destino;
    }
    setMapeo(nuevo);
  }

  const usados = new Set(Object.values(mapeo));
  const falta =
    tipo === "CONTACT"
      ? !usados.has("fullName") && !(usados.has("firstName") && usados.has("lastName"))
      : tipo === "ACTIVITY"
        ? !["contactExternalId", "contactEmail", "contactPhone"].some((d) => usados.has(d)) ||
          (!usados.has("type") && tipoPorDefecto === "") ||
          autorId === ""
        : tipo === "VEHICLE"
          ? !["make", "model", "year"].every((d) => usados.has(d)) ||
            stock.branchId === "" ||
            stock.responsableId === ""
          : !usados.has("name");

  const textoDeFalta: Record<TipoImportable, string> = {
    CONTACT: `Falta elegir la columna de «${DESTINOS.CONTACT.fullName}», o las de «${DESTINOS.CONTACT.firstName}» y «${DESTINOS.CONTACT.lastName}».`,
    ACTIVITY:
      "Falta elegir a qué contacto va cada fila (id del origen, email o teléfono), el tipo (una columna o un tipo para todo el archivo) y el autor.",
    VEHICLE: "Falta elegir las columnas de marca, modelo y año, la sucursal y el responsable.",
    COMPANY: `Falta elegir la columna de «${DESTINOS.COMPANY.name}».`,
  };

  function enviar(event: FormEvent) {
    event.preventDefault();
    guardar.mutate({
      mapeo,
      formato: {
        fecha,
        separadorDecimal: decimal,
        si: lista(si),
        no: lista(no),
        separadorDeOpciones: opcionesSep,
      },
      etapas: soloLosVistos(etapas, deEtapa.valores),
      duplicados,
      crearEmpresas,
      ...(tipo === "ACTIVITY"
        ? {
            historial: {
              autorId,
              ...(tipoPorDefecto ? { tipoPorDefecto } : {}),
              tipos: soloLosVistos(tipos, deTipo.valores),
            },
          }
        : {}),
      ...(tipo === "VEHICLE"
        ? {
            stock: {
              ...stock,
              estados: soloLosVistos(stock.estados, deEstado.valores),
              condiciones: soloLosVistos(stock.condiciones, deCondicion.valores),
              combustibles: soloLosVistos(stock.combustibles, deCombustible.valores),
              transmisiones: soloLosVistos(stock.transmisiones, deCaja.valores),
            },
          }
        : {}),
    });
  }

  return (
    <form className="ds-stack" onSubmit={enviar}>
      <Card heading="Columnas">
        <p className="ds-hint">
          Columnas de «{lote.config.archivo.nombre ?? "el archivo"}». Las que quedan en «Ignorar{" "}
          columna» no se importan.
        </p>
        <ol className="ds-mapping-rows">
          {encabezados.map((encabezado) => (
            <li key={encabezado} className="ds-mapping-row">
              <Select
                label={encabezado}
                value={mapeo[encabezado] ?? ""}
                options={destinos}
                emptyOption={{ label: "Ignorar columna" }}
                onChange={(destino) => cambiarDestino(encabezado, destino)}
              />
            </li>
          ))}
        </ol>
        {falta ? (
          <p className="ds-hint" role="status">
            {textoDeFalta[tipo]}
          </p>
        ) : null}
      </Card>

      {tipo === "ACTIVITY" ? (
        <Card heading="Historial">
          <div className="ds-field-grid">
            <Select
              label="Autor de las actividades"
              value={autorId}
              options={opcionesDeUsuario}
              emptyOption={{ label: "Elegir…" }}
              onChange={setAutorId}
            />
            <Select
              label="Tipo para las filas sin tipo"
              value={tipoPorDefecto}
              options={TIPOS_DE_HISTORIAL}
              emptyOption={{ label: "Ninguno (la fila falla)" }}
              onChange={setTipoPorDefecto}
            />
          </div>
          <p className="ds-hint">
            Las tareas hechas quedan completadas; las vencidas, abiertas y asignadas al autor.
          </p>
          <MapeoDeValores
            titulo="Qué tipo es cada valor de"
            columna={deTipo.columna}
            valores={deTipo.valores}
            opciones={TIPOS_DE_HISTORIAL}
            mapa={tipos}
            sinAsignar="Sin asignar"
            onChange={setTipos}
          />
        </Card>
      ) : null}

      {tipo === "VEHICLE" ? (
        <Card heading="Stock">
          <div className="ds-field-grid">
            <Select
              label="Sucursal de las unidades nuevas"
              value={stock.branchId}
              options={sucursales.map((s) => ({ value: s.id, label: s.name }))}
              emptyOption={{ label: "Elegir…" }}
              onChange={(branchId) => cambiarStock({ branchId })}
            />
            <Select
              label="Responsable de los cambios en las fichas"
              value={stock.responsableId}
              options={opcionesDeUsuario}
              emptyOption={{ label: "Elegir…" }}
              onChange={(responsableId) => cambiarStock({ responsableId })}
            />
            <Select
              label="Condición si la fila no la trae"
              value={stock.condicionPorDefecto}
              options={CONDICIONES}
              onChange={(v) => v && cambiarStock({ condicionPorDefecto: v })}
            />
            <Select
              label="Moneda de los montos sin moneda"
              value={stock.monedaPorDefecto}
              options={[
                { value: "USD", label: "Dólares" },
                { value: "LOCAL", label: "Moneda local" },
              ]}
              onChange={(v) => v && cambiarStock({ monedaPorDefecto: v })}
            />
            <FormField label="Importar también las vendidas (historial)">
              <input
                type="checkbox"
                checked={stock.importarVendidas}
                onChange={(e) => cambiarStock({ importarVendidas: e.target.checked })}
              />
            </FormField>
          </div>
          <p className="ds-hint">
            Las reservadas entran como «No disponible»; los importes locales se pasan a dólares.
          </p>
          <MapeoDeValores
            titulo="Qué estado es cada valor de"
            columna={deEstado.columna}
            valores={deEstado.valores}
            opciones={ESTADOS_DE_STOCK}
            mapa={stock.estados}
            sinAsignar="Sin asignar (la fila falla)"
            onChange={(estados) => cambiarStock({ estados })}
          />
          <MapeoDeValores
            titulo="Qué condición es cada valor de"
            columna={deCondicion.columna}
            valores={deCondicion.valores}
            opciones={CONDICIONES}
            mapa={stock.condiciones}
            sinAsignar="Sin asignar (la fila falla)"
            onChange={(condiciones) => cambiarStock({ condiciones })}
          />
          <MapeoDeValores
            titulo="Qué combustible es cada valor de"
            columna={deCombustible.columna}
            valores={deCombustible.valores}
            opciones={COMBUSTIBLES}
            mapa={stock.combustibles}
            sinAsignar="Sin asignar (la fila falla)"
            onChange={(combustibles) => cambiarStock({ combustibles })}
          />
          <MapeoDeValores
            titulo="Qué caja es cada valor de"
            columna={deCaja.columna}
            valores={deCaja.valores}
            opciones={TRANSMISIONES}
            mapa={stock.transmisiones}
            sinAsignar="Sin asignar (la fila falla)"
            onChange={(transmisiones) => cambiarStock({ transmisiones })}
          />
        </Card>
      ) : null}

      <Card heading="Formato de los datos">
        <div className="ds-field-grid">
          <Select
            label="Formato de fecha"
            value={fecha}
            options={[
              { value: "DD/MM/AAAA", label: "DD/MM/AAAA" },
              { value: "MM/DD/AAAA", label: "MM/DD/AAAA" },
              { value: "AAAA-MM-DD", label: "AAAA-MM-DD" },
            ]}
            onChange={(v) => v && setFecha(v)}
          />
          <Select
            label="Separador decimal"
            value={decimal}
            options={[
              { value: ",", label: "Coma (1.234,56)" },
              { value: ".", label: "Punto (1,234.56)" },
            ]}
            onChange={(v) => v && setDecimal(v)}
          />
          {tipo === "CONTACT" ? (
            <Select
              label="Separador de listas de opciones"
              value={opcionesSep}
              options={[
                { value: ";", label: "Punto y coma (Contado; Permuta)" },
                { value: ",", label: "Coma (Contado, Permuta)" },
              ]}
              onChange={(v) => v && setOpcionesSep(v)}
            />
          ) : null}
          <FormField label="Valores que cuentan como «sí»">
            <input type="text" value={si} onChange={(e) => setSi(e.target.value)} />
          </FormField>
          <FormField label="Valores que cuentan como «no»">
            <input type="text" value={no} onChange={(e) => setNo(e.target.value)} />
          </FormField>
        </div>
        <MapeoDeValores
          titulo="Qué etapa del CRM es cada valor de"
          columna={deEtapa.columna}
          valores={deEtapa.valores}
          opciones={ETAPAS}
          mapa={etapas}
          sinAsignar="Sin asignar (la fila falla)"
          onChange={setEtapas}
        />
      </Card>

      <Card heading="Duplicados">
        <Select
          label="Si un registro ya existe"
          value={duplicados}
          options={POLITICAS}
          onChange={(v) => v && setDuplicados(v)}
        />
        <p className="ds-hint">En la vista previa se puede cambiar fila por fila.</p>
        {tipo === "CONTACT" && !sinEmpresas ? (
          <FormField label="Crear las empresas que no existen">
            <input
              type="checkbox"
              checked={crearEmpresas}
              onChange={(e) => setCrearEmpresas(e.target.checked)}
            />
          </FormField>
        ) : null}
      </Card>

      {guardar.isError ? (
        <ErrorState>
          No pudimos guardar el mapeo
          {guardar.error instanceof Error ? `: ${guardar.error.message}` : "."}
        </ErrorState>
      ) : null}
      <div className="ds-card-actions">
        <Button type="submit" disabled={falta} loading={guardar.isPending}>
          Ver la vista previa
        </Button>
        {onCancelar ? (
          <Button type="button" variant="secondary" onClick={onCancelar}>
            Volver a la vista previa
          </Button>
        ) : null}
      </div>
    </form>
  );
}
