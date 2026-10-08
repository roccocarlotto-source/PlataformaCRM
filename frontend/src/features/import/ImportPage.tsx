import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHeader } from "../../design-system/PageHeader";
import { AYUDA } from "../guia/anclas";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { DetailList } from "../../design-system/DetailList";
import { ErrorState } from "../../design-system/ErrorState";
import { FileInputButton } from "../../design-system/FileInputButton";
import { LoadingState } from "../../design-system/LoadingState";
import { Notice } from "../../design-system/Notice";
import { Table } from "../../design-system/Table";
import { useSource } from "../source/queries";
import { validarArchivo } from "./fileValidation";
import { useImportFile } from "./mutations";
import { useImportBatch } from "./queries";
import type { ImportResult } from "./types";

// ---------------------------------------------------------------------------
// Subida real de un archivo contra una Source FILE_IMPORT.
//
// EL RESULTADO SE MUESTRA EN UN PANEL QUE SE QUEDA, no en un modal. La diferencia
// con el secreto de una ApiKey —que sí usa modal— es que aquello era terminal:
// se mostraba una vez y no se podía recuperar. Esto sigue vivo después: los
// eventos entran PENDING y el worker los promueve más tarde, así que el resumen
// cambia con el tiempo y hay un botón para volver a pedirlo. Un cuadro que se
// cierra no encaja con algo que todavía está pasando.
// ---------------------------------------------------------------------------

export function ImportPage() {
  const { id } = useParams<{ id: string }>();
  const sourceQuery = useSource(id);

  const [archivo, setArchivo] = useState<File | null>(null);
  const [errorLocal, setErrorLocal] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ImportResult | null>(null);

  const importFileMutation = useImportFile(id ?? "");
  // El resumen se pide a mano con el botón: enabled queda atado a que ya exista
  // un lote, y refetch() es lo que dispara cada actualización.
  const batchQuery = useImportBatch(resultado?.batchId);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorLocal(null);

    if (!archivo) {
      setErrorLocal("Elegí un archivo para importar.");
      return;
    }

    // Se valida ANTES de tocar la red: extensión y tamaño ya se saben acá, y
    // mandar 10 MB para que el backend conteste 413 es gastar la subida entera
    // en algo previsible.
    const invalido = validarArchivo(archivo);
    if (invalido) {
      setErrorLocal(invalido);
      return;
    }

    try {
      const nuevo = await importFileMutation.mutateAsync(archivo);
      // El panel anterior se reemplaza por el del lote nuevo: mostrar dos
      // resultados a la vez no diría cuál corresponde a qué archivo.
      setResultado(nuevo);
    } catch {
      // El error queda en importFileMutation.isError y se muestra abajo.
    }
  }

  if (sourceQuery.isLoading) {
    return <LoadingState variant="lines" />;
  }

  if (sourceQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar la fuente
        {sourceQuery.error instanceof Error ? `: ${sourceQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  const source = sourceQuery.data;

  // Entrar por URL escrita a mano a una fuente que no corresponde. El cross-link
  // de SourceListPage ya solo aparece en las FILE_IMPORT, pero la URL es
  // editable — y una subida contra otro tipo daría un 400 garantizado
  // (import.service.ts), así que no se ofrece el formulario en absoluto.
  if (source && source.type !== "FILE_IMPORT") {
    return (
      <div className="ds-form">
        <PageHeader
          help={AYUDA.importarArchivo}
          title="Importar archivo"
          back={{ to: "/sources", label: "Fuentes" }}
        />
        <ErrorState>
          La fuente <strong>{source.name}</strong> no es de tipo Importación de archivo, así que no
          acepta subidas.
        </ErrorState>
      </div>
    );
  }

  // Misma estructura que un formulario (.ds-form + tarjetas en .ds-stack): la
  // subida en una tarjeta, el resultado en otra, con los contadores en
  // DetailList. Hasta acá era un <section> con <h2>/<ul> sueltos sobre el
  // fondo.
  return (
    <div className="ds-form">
      <PageHeader
        help={AYUDA.importarArchivo}
        title="Importar archivo"
        back={{ to: "/sources", label: "Fuentes" }}
        subtitle={
          source ? (
            <>
              Fuente: <strong>{source.name}</strong>
            </>
          ) : undefined
        }
      />

      <div className="ds-stack">
        {source && !source.isActive ? (
          <Notice tone="warning" title="Esta fuente está pausada">
            Las importaciones de una fuente pausada se rechazan: reactivala antes de subir un
            archivo.
          </Notice>
        ) : null}

        <Card heading="Archivo">
          <form className="ds-stack" onSubmit={handleSubmit}>
            {/* Solo la ELECCIÓN del archivo: la importación sigue siendo el submit
                del botón de abajo, que es lo que gasta la subida. */}
            <FileInputButton
              label="Archivo (.csv o .xlsx, hasta 10 MB)"
              accept=".csv,.xlsx"
              selectedFileName={archivo?.name ?? null}
              onFileSelected={(elegido) => {
                setArchivo(elegido);
                setErrorLocal(null);
              }}
            />

            {errorLocal ? <ErrorState>{errorLocal}</ErrorState> : null}

            {importFileMutation.isError ? (
              <ErrorState>
                No pudimos importar el archivo
                {importFileMutation.error instanceof Error
                  ? `: ${importFileMutation.error.message}`
                  : "."}
              </ErrorState>
            ) : null}

            <div>
              <Button
                type="submit"
                variant="primary"
                disabled={importFileMutation.isPending}
                loading={importFileMutation.isPending}
              >
                {importFileMutation.isPending ? "Importando…" : "Importar"}
              </Button>
            </div>
          </form>
        </Card>

        {resultado ? (
          <Card heading="Resultado de la importación">
            <div className="ds-stack">
              <DetailList
                sections={[
                  {
                    items: [
                      { label: "Lote", value: <code>{resultado.batchId}</code> },
                      { label: "Filas leídas", value: resultado.filasLeidas },
                      { label: "Eventos creados", value: resultado.insertados },
                      // `duplicados` SOLO se ve acá: las filas repetidas quedan
                      // bajo el lote que las trajo primero, no bajo este, así que
                      // el resumen del lote no las cuenta (§9.9 de
                      // docs/ingestion-architecture.md).
                      {
                        label: "Filas ya importadas antes (no se duplicaron)",
                        value: resultado.duplicados,
                      },
                      { label: "Columnas detectadas", value: resultado.encabezados.join(", ") },
                    ],
                  },
                ]}
              />

              <Notice>Se procesan en segundo plano: actualizá el estado para ver cómo va.</Notice>

              {/* Las dos vistas se complementan en vez de competir: acá viven los
                  contadores agregados del lote (un GROUP BY barato), allá la cola
                  fila por fila, con el motivo de cada falla y el botón de
                  reintentar. El batchId del filtro viaja por la URL. */}
              <div className="ds-card-actions">
                <Button
                  onClick={() => void batchQuery.refetch()}
                  disabled={batchQuery.isFetching}
                  loading={batchQuery.isFetching}
                >
                  {batchQuery.isFetching ? "Actualizando…" : "Actualizar estado"}
                </Button>
                <Link
                  to={`/ingestion-events?batchId=${resultado.batchId}`}
                  className="ds-button ds-button--secondary"
                >
                  Ver estas filas
                </Link>
              </div>

              {batchQuery.isError ? (
                <ErrorState>
                  No pudimos consultar el estado del lote
                  {batchQuery.error instanceof Error ? `: ${batchQuery.error.message}` : "."}
                </ErrorState>
              ) : null}

              {batchQuery.data ? (
                <DetailList
                  sections={[
                    {
                      heading: "Estado del lote",
                      items: [
                        { label: "Total", value: batchQuery.data.total },
                        { label: "Pendientes", value: batchQuery.data.pendientes },
                        { label: "Promovidos a contactos", value: batchQuery.data.promovidos },
                        { label: "Fallidos", value: batchQuery.data.fallidos },
                      ],
                    },
                  ]}
                />
              ) : null}

              {batchQuery.data && batchQuery.data.fallas.length > 0 ? (
                <div>
                  <h3 className="ds-detail-heading">Filas que fallaron</h3>
                  <Table>
                    <thead>
                      <tr>
                        <th>Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchQuery.data.fallas.map((falla) => (
                        <tr key={falla.id}>
                          <td>{falla.errorMessage ?? "Sin motivo registrado"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              ) : null}

              {/* Nunca truncar en silencio, mismo criterio que el backend, que
                  topea la muestra en 100 y devuelve el resto como un número. */}
              {batchQuery.data && batchQuery.data.fallasOmitidas > 0 ? (
                <p className="ds-hint">
                  Se muestran las primeras {batchQuery.data.fallas.length} fallas;{" "}
                  {batchQuery.data.fallasOmitidas} quedaron afuera.
                </p>
              ) : null}
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
