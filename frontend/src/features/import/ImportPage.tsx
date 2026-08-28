import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
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
    return <LoadingState />;
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
      <div>
        <h1>Importar archivo</h1>
        <ErrorState>
          La fuente <strong>{source.name}</strong> no es de tipo Importación de archivo, así que no
          acepta subidas. Solo las fuentes FILE_IMPORT reciben archivos.
        </ErrorState>
        <Link to="/sources">Volver a fuentes</Link>
      </div>
    );
  }

  return (
    <div>
      <div className="ds-page-header">
        <h1>Importar archivo{source ? `: ${source.name}` : ""}</h1>
        <Link to="/sources" className="ds-link-button">
          Volver a fuentes
        </Link>
      </div>

      {source && !source.isActive ? (
        <ErrorState>
          Esta fuente está pausada. El backend rechaza las importaciones de una fuente pausada:
          reactivala antes de subir un archivo.
        </ErrorState>
      ) : null}

      <form onSubmit={handleSubmit}>
        <FormField label="Archivo (.csv o .xlsx, hasta 10 MB)">
          <input
            type="file"
            accept=".csv,.xlsx"
            onChange={(event) => {
              setArchivo(event.target.files?.[0] ?? null);
              setErrorLocal(null);
            }}
          />
        </FormField>

        <Button type="submit" variant="primary" disabled={importFileMutation.isPending}>
          {importFileMutation.isPending ? "Importando…" : "Importar"}
        </Button>
      </form>

      {errorLocal ? <ErrorState>{errorLocal}</ErrorState> : null}

      {importFileMutation.isError ? (
        <ErrorState>
          No pudimos importar el archivo
          {importFileMutation.error instanceof Error
            ? `: ${importFileMutation.error.message}`
            : "."}
        </ErrorState>
      ) : null}

      {resultado ? (
        <section>
          <h2>Resultado de la importación</h2>
          <p>
            Lote <code>{resultado.batchId}</code>
          </p>
          <ul>
            <li>Filas leídas: {resultado.filasLeidas}</li>
            <li>Eventos creados: {resultado.insertados}</li>
            {/* `duplicados` SOLO se ve acá: las filas repetidas quedan bajo el
                lote que las trajo primero, no bajo este, así que el resumen del
                lote no las cuenta (§9.9 de docs/ingestion-architecture.md). */}
            <li>Filas ya importadas antes (no se duplicaron): {resultado.duplicados}</li>
          </ul>
          <p className="ds-hint">Columnas detectadas: {resultado.encabezados.join(", ")}</p>

          {/* Las dos vistas se complementan en vez de competir: acá viven los
              contadores agregados del lote (un GROUP BY barato), allá la cola
              fila por fila, con el motivo de cada falla y el botón de
              reintentar. El batchId del filtro viaja por la URL. */}
          <p>
            <Link to={`/ingestion-events?batchId=${resultado.batchId}`}>Ver estas filas</Link>
          </p>

          <p className="ds-hint">
            Las filas se procesan en segundo plano: entran pendientes y se promueven a contactos
            después. Actualizá el estado para ver cómo va.
          </p>

          <Button onClick={() => void batchQuery.refetch()} disabled={batchQuery.isFetching}>
            {batchQuery.isFetching ? "Actualizando…" : "Actualizar estado"}
          </Button>

          {batchQuery.isError ? (
            <ErrorState>
              No pudimos consultar el estado del lote
              {batchQuery.error instanceof Error ? `: ${batchQuery.error.message}` : "."}
            </ErrorState>
          ) : null}

          {batchQuery.data ? (
            <div>
              <ul>
                <li>Total: {batchQuery.data.total}</li>
                <li>Pendientes: {batchQuery.data.pendientes}</li>
                <li>Promovidos a contactos: {batchQuery.data.promovidos}</li>
                <li>Fallidos: {batchQuery.data.fallidos}</li>
              </ul>

              {batchQuery.data.fallas.length > 0 ? (
                <>
                  <h3>Filas que fallaron</h3>
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
                </>
              ) : null}

              {/* Nunca truncar en silencio, mismo criterio que el backend, que
                  topea la muestra en 100 y devuelve el resto como un número. */}
              {batchQuery.data.fallasOmitidas > 0 ? (
                <p className="ds-hint">
                  Se muestran las primeras {batchQuery.data.fallas.length} fallas;{" "}
                  {batchQuery.data.fallasOmitidas} quedaron afuera.
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
