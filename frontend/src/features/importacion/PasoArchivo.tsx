import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FileInputButton } from "../../design-system/FileInputButton";
import { FormField } from "../../design-system/FormField";
import { Select } from "../../design-system/Select";
import { subirArchivo, subirLinkDeSheets } from "./api";
import { TIPOS } from "./labels";
import type { OpcionesDeImportacion, SubidaDeArchivo, TipoImportable } from "./types";

// ---------------------------------------------------------------------------
// Pasos 1 y 2 del asistente (docs/importacion-de-datos.md §8.1): qué se
// importa, de qué sistema de origen, y el archivo. El stock también puede
// venir de un link de Google Sheets (decisión 3); lo demás, solo archivo,
// porque tiene datos personales.
// ---------------------------------------------------------------------------

const NUEVA_FUENTE = "__nueva__";

type Origen = "archivo" | "sheets";
const ORIGENES: { value: Origen; label: string }[] = [
  { value: "archivo", label: "Un archivo (.csv o .xlsx)" },
  { value: "sheets", label: "Un link de Google Sheets" },
];

export function PasoArchivo({
  organizationId,
  opciones,
  sinEmpresas = false,
  onSubido,
}: {
  organizationId: string;
  opciones: OpcionesDeImportacion;
  // La organización destino no tiene empresas (ESENCIAL).
  sinEmpresas?: boolean;
  onSubido: (subida: SubidaDeArchivo) => void;
}) {
  const [tipo, setTipo] = useState<TipoImportable | "">("");
  const fuentesActivas = opciones.fuentes.filter((f) => f.isActive);
  const [fuente, setFuente] = useState<string>(fuentesActivas.length === 0 ? NUEVA_FUENTE : "");
  const [nombreDeFuente, setNombreDeFuente] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [origenElegido, setOrigen] = useState<Origen>("archivo");
  const [link, setLink] = useState("");
  const origen: Origen = tipo === "VEHICLE" ? origenElegido : "archivo";

  const subida = useMutation({
    mutationFn: () => {
      if (!tipo) throw new Error("Faltan datos");
      const pedido = {
        entityType: tipo,
        ...(fuente === NUEVA_FUENTE ? { sourceName: nombreDeFuente.trim() } : { sourceId: fuente }),
      };
      if (origen === "sheets") {
        return subirLinkDeSheets(organizationId, { ...pedido, sheetUrl: link.trim() });
      }
      if (!archivo) throw new Error("Faltan datos");
      return subirArchivo(organizationId, archivo, pedido);
    },
    onSuccess: onSubido,
  });

  const completo =
    tipo !== "" &&
    (origen === "sheets" ? link.trim() !== "" : archivo !== null) &&
    (fuente === NUEVA_FUENTE ? nombreDeFuente.trim() !== "" : fuente !== "");

  function enviar(event: FormEvent) {
    event.preventDefault();
    if (completo) subida.mutate();
  }

  return (
    <Card heading="Archivo">
      <form className="ds-stack" onSubmit={enviar}>
        <Select
          label="Qué se importa"
          value={tipo}
          options={sinEmpresas ? TIPOS.filter((t) => t.value !== "COMPANY") : TIPOS}
          emptyOption={{ label: "Elegir…" }}
          onChange={setTipo}
        />
        <p className="ds-hint">
          {sinEmpresas
            ? "Primero stock, después contactos, por último historial."
            : "Primero empresas y stock, después contactos, por último historial."}
        </p>
        <Select
          label="Sistema de origen"
          value={fuente}
          options={[
            ...fuentesActivas.map((f) => ({ value: f.id, label: f.name })),
            { value: NUEVA_FUENTE, label: "Uno nuevo…" },
          ]}
          emptyOption={{ label: "Elegir…" }}
          onChange={setFuente}
        />
        {fuente === NUEVA_FUENTE ? (
          <FormField label="Nombre del sistema de origen">
            <input
              type="text"
              value={nombreDeFuente}
              maxLength={255}
              placeholder="Por ejemplo: Planilla de ventas"
              onChange={(event) => setNombreDeFuente(event.target.value)}
            />
          </FormField>
        ) : null}
        <p className="ds-hint">Volver a subir del mismo origen actualiza sin duplicar.</p>
        {tipo === "VEHICLE" ? (
          <Select
            label="De dónde"
            value={origenElegido}
            options={ORIGENES}
            onChange={(valor) => setOrigen(valor === "sheets" ? "sheets" : "archivo")}
          />
        ) : null}
        {origen === "sheets" ? (
          <>
            <FormField label="Link de la planilla">
              <input
                type="url"
                value={link}
                maxLength={2048}
                placeholder="https://docs.google.com/spreadsheets/d/…"
                onChange={(event) => setLink(event.target.value)}
              />
            </FormField>
            <p className="ds-hint">Compartida como «Cualquier persona con el enlace puede ver».</p>
          </>
        ) : (
          <>
            <FileInputButton
              label="Archivo (.csv o .xlsx, hasta 10 MB)"
              accept=".csv,.xlsx"
              selectedFileName={archivo?.name ?? null}
              onFileSelected={setArchivo}
              onClear={() => setArchivo(null)}
            />
            <p className="ds-hint">
              Un .xls o un .ods no se pueden leer: guardalo como .xlsx o .csv y volvé a subirlo.
            </p>
          </>
        )}
        {subida.isError ? (
          <ErrorState>
            {origen === "sheets" ? "No pudimos leer la planilla" : "No pudimos leer el archivo"}
            {subida.error instanceof Error ? `: ${subida.error.message}` : "."}
          </ErrorState>
        ) : null}
        <div className="ds-card-actions">
          <Button type="submit" disabled={!completo} loading={subida.isPending}>
            Subir y continuar
          </Button>
        </div>
      </form>
    </Card>
  );
}
