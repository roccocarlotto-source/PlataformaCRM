import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FileInputButton } from "../../design-system/FileInputButton";
import { FormField } from "../../design-system/FormField";
import { Select } from "../../design-system/Select";
import { subirArchivo } from "./api";
import { TIPOS } from "./labels";
import type { OpcionesDeImportacion, SubidaDeArchivo, TipoImportable } from "./types";

// ---------------------------------------------------------------------------
// Pasos 1 y 2 del asistente (docs/importacion-de-datos.md §8.1): qué se
// importa, de qué sistema de origen, y el archivo. Solo archivos: el link de
// Google Sheets es para stock (decisión 3), que llega en otro PR.
// ---------------------------------------------------------------------------

const NUEVA_FUENTE = "__nueva__";

export function PasoArchivo({
  organizationId,
  opciones,
  onSubido,
}: {
  organizationId: string;
  opciones: OpcionesDeImportacion;
  onSubido: (subida: SubidaDeArchivo) => void;
}) {
  const [tipo, setTipo] = useState<TipoImportable | "">("");
  const fuentesActivas = opciones.fuentes.filter((f) => f.isActive);
  const [fuente, setFuente] = useState<string>(fuentesActivas.length === 0 ? NUEVA_FUENTE : "");
  const [nombreDeFuente, setNombreDeFuente] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);

  const subida = useMutation({
    mutationFn: () => {
      if (!archivo || !tipo) throw new Error("Faltan datos");
      return subirArchivo(organizationId, archivo, {
        entityType: tipo,
        ...(fuente === NUEVA_FUENTE ? { sourceName: nombreDeFuente.trim() } : { sourceId: fuente }),
      });
    },
    onSuccess: onSubido,
  });

  const completo =
    tipo !== "" &&
    archivo !== null &&
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
          options={TIPOS}
          emptyOption={{ label: "Elegir…" }}
          onChange={setTipo}
        />
        <p className="ds-hint">
          Primero las empresas y el stock, después los contactos y por último el historial: así cada
          uno encuentra a lo que se refiere.
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
        <p className="ds-hint">
          Volver a subir un archivo del mismo sistema de origen actualiza lo que ya se importó, sin
          duplicar.
        </p>
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
        {subida.isError ? (
          <ErrorState>
            No pudimos leer el archivo
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
