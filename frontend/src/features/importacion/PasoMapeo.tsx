import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { Select } from "../../design-system/Select";
import { configurarLote } from "./api";
import { DESTINOS, ETAPAS, POLITICAS, TIPOS_DE_HISTORIAL, opcionesDeDestino } from "./labels";
import { importacionKeys } from "./queries";
import type {
  Ajustes,
  Etapa,
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

export function PasoMapeo({
  organizationId,
  lote,
  opciones,
  sugerido,
  muestra,
  onGuardado,
  onCancelar,
}: {
  organizationId: string;
  lote: Lote;
  opciones: OpcionesDeImportacion;
  sugerido: Record<string, string>;
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
  const [etapas, setEtapas] = useState<Record<string, Etapa>>(previos?.etapas ?? {});
  // Historial: el autor por defecto es el ADMIN más antiguo (decisión 5); la
  // lista viene ordenada por antigüedad.
  const autorPorDefecto =
    opciones.usuarios.find((u) => u.rol === "ADMIN")?.id ?? opciones.usuarios[0]?.id ?? "";
  const [autorId, setAutorId] = useState(previos?.historial?.autorId ?? autorPorDefecto);
  const [tipoPorDefecto, setTipoPorDefecto] = useState<TipoDeHistorial | "">(
    previos?.historial?.tipoPorDefecto ?? "",
  );
  const [tipos, setTipos] = useState<Record<string, TipoDeHistorial>>(
    previos?.historial?.tipos ?? {},
  );

  const destinos = opcionesDeDestino(tipo, opciones.camposPersonalizados);

  // Los valores distintos de la columna de etapa en la muestra: a cada uno se
  // le asigna una etapa del CRM ("Cliente" -> CUSTOMER).
  const columnaDeEtapa = Object.entries(mapeo).find(([, d]) => d === "lifecycleStage")?.[0];
  const valoresDeEtapa = useMemo(() => {
    if (!columnaDeEtapa) return [];
    const vistos = new Map<string, string>();
    for (const fila of muestra) {
      const v = fila[columnaDeEtapa];
      if (v === null || String(v).trim() === "") continue;
      const t = String(v).trim();
      if (!vistos.has(clave(t))) vistos.set(clave(t), t);
    }
    return [...vistos.values()];
  }, [columnaDeEtapa, muestra]);

  // Lo mismo para la columna de tipo del historial ("Llamada" -> CALL).
  const columnaDeTipo = Object.entries(mapeo).find(([, d]) => d === "type")?.[0];
  const valoresDeTipo = useMemo(() => {
    if (!columnaDeTipo) return [];
    const vistos = new Map<string, string>();
    for (const fila of muestra) {
      const v = fila[columnaDeTipo];
      if (v === null || String(v).trim() === "") continue;
      const t = String(v).trim();
      if (!vistos.has(clave(t))) vistos.set(clave(t), t);
    }
    return [...vistos.values()];
  }, [columnaDeTipo, muestra]);

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
  const faltaNombre =
    tipo === "CONTACT"
      ? !usados.has("fullName") && !(usados.has("firstName") && usados.has("lastName"))
      : tipo === "ACTIVITY"
        ? !["contactExternalId", "contactEmail", "contactPhone"].some((d) => usados.has(d)) ||
          (!usados.has("type") && tipoPorDefecto === "") ||
          autorId === ""
        : !usados.has("name");

  function enviar(event: FormEvent) {
    event.preventDefault();
    const etapasUsadas = Object.fromEntries(
      Object.entries(etapas).filter(([valor]) => valoresDeEtapa.includes(valor)),
    );
    guardar.mutate({
      mapeo,
      formato: {
        fecha,
        separadorDecimal: decimal,
        si: lista(si),
        no: lista(no),
        separadorDeOpciones: opcionesSep,
      },
      etapas: etapasUsadas,
      duplicados,
      crearEmpresas,
      ...(tipo === "ACTIVITY"
        ? {
            historial: {
              autorId,
              ...(tipoPorDefecto ? { tipoPorDefecto } : {}),
              tipos: Object.fromEntries(
                Object.entries(tipos).filter(([valor]) => valoresDeTipo.includes(valor)),
              ),
            },
          }
        : {}),
    });
  }

  return (
    <form className="ds-stack" onSubmit={enviar}>
      <Card heading="Columnas">
        <p className="ds-hint">
          A qué campo va cada columna de «{lote.config.archivo.nombre ?? "el archivo"}». Las que
          quedan en «Ignorar columna» no se importan.
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
        {faltaNombre ? (
          <p className="ds-hint" role="status">
            {tipo === "CONTACT"
              ? `Falta elegir la columna de «${DESTINOS.CONTACT.fullName}», o las de «${DESTINOS.CONTACT.firstName}» y «${DESTINOS.CONTACT.lastName}».`
              : tipo === "ACTIVITY"
                ? "Falta elegir a qué contacto va cada fila (id del origen, email o teléfono), el tipo (una columna o un tipo para todo el archivo) y el autor."
                : `Falta elegir la columna de «${DESTINOS.COMPANY.name}».`}
          </p>
        ) : null}
      </Card>

      {tipo === "ACTIVITY" ? (
        <Card heading="Historial">
          <div className="ds-field-grid">
            <Select
              label="Autor de las actividades"
              value={autorId}
              options={opciones.usuarios.map((u) => ({
                value: u.id,
                label: u.fullName,
                subtitle: u.email,
              }))}
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
            El autor que trae el archivo, si lo trae, se agrega al texto («Autor original: …»). Las
            tareas hechas quedan completadas y confirmadas; las vencidas sin hacer, abiertas y
            asignadas a este autor.
          </p>
          {valoresDeTipo.length > 0 ? (
            <div className="ds-field-grid">
              {valoresDeTipo.map((valor) => (
                <Select
                  key={valor}
                  label={valor}
                  value={tipos[valor] ?? ""}
                  options={TIPOS_DE_HISTORIAL}
                  emptyOption={{ label: "Sin asignar" }}
                  onChange={(t) => {
                    const nuevo = { ...tipos };
                    if (t === "") delete nuevo[valor];
                    else nuevo[valor] = t;
                    setTipos(nuevo);
                  }}
                />
              ))}
            </div>
          ) : null}
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
        {valoresDeEtapa.length > 0 ? (
          <div className="ds-stack">
            <p className="ds-hint">Qué etapa del CRM es cada valor de «{columnaDeEtapa}».</p>
            <div className="ds-field-grid">
              {valoresDeEtapa.map((valor) => (
                <Select
                  key={valor}
                  label={valor}
                  value={etapas[valor] ?? ""}
                  options={ETAPAS}
                  emptyOption={{ label: "Sin asignar (la fila falla)" }}
                  onChange={(etapa) => {
                    const nuevo = { ...etapas };
                    if (etapa === "") delete nuevo[valor];
                    else nuevo[valor] = etapa;
                    setEtapas(nuevo);
                  }}
                />
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      <Card heading="Duplicados">
        <Select
          label="Si un registro ya existe"
          value={duplicados}
          options={POLITICAS}
          onChange={(v) => v && setDuplicados(v)}
        />
        <p className="ds-hint">
          Nunca se pisan el email ni el teléfono que identifican a un contacto, y la etapa no
          retrocede. En la vista previa se puede cambiar fila por fila.
        </p>
        {tipo === "CONTACT" ? (
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
        <Button type="submit" disabled={faltaNombre} loading={guardar.isPending}>
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
