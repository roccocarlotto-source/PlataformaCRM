import { useState } from "react";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { useGenerateConversationBrief, useUpdateConversationBrief } from "./mutations";
import type { ConversationDetail } from "./types";

// ---------------------------------------------------------------------------
// El brief de una conversación (ítem 73 de docs/frontend-cambios-pendientes.md):
// dos a cuatro oraciones que cuentan qué pasó, arriba del hilo.
//
// LO REDACTA LA IA, y ese es el punto del ítem: nadie tiene que sentarse a
// escribir un resumen: siempre hay algo, y la persona lo corrige si quiere.
// Mismo criterio que el vendedor provisorio del ítem 69. Por eso el estado
// vacío ofrece GENERAR y no "escribir": escribir de cero está disponible —se
// genera y se edita— pero no es el camino que la pantalla propone.
//
// ARCHIVO PROPIO Y NO UN BLOQUE DENTRO DE ConversationDetail.tsx: es la única
// parte de esa pantalla con estado propio (el modo edición y el borrador), dos
// mutaciones y cuatro botones. Dejarlo adentro habría duplicado el largo de un
// componente que hasta hoy no tenía un solo useState. ConversationDetail lo
// monta en una línea y sigue leyéndose de arriba abajo.
//
// TRES ESTADOS Y NADA MÁS:
//   1. Sin brief   -> EmptyState + "Generar resumen".
//   2. Con brief   -> el texto + "Editar" y "Regenerar".
//   3. Editando    -> textarea + "Guardar" y "Cancelar".
//
// REGENERAR PISA UNA EDICIÓN A MANO, y por eso pregunta antes cuando hay una:
// es la única acción de esta tarjeta que destruye algo que escribió una
// persona. Generar sobre un brief vacío no pregunta nada —no hay nada que
// perder— y regenerar sobre un texto de la IA tampoco: volver a pedirle al
// modelo lo que el modelo ya había escrito no es una pérdida.
// ---------------------------------------------------------------------------

export interface ConversationBriefCardProps {
  conversation: ConversationDetail;
}

export function ConversationBriefCard({ conversation }: ConversationBriefCardProps) {
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState("");

  const guardar = useUpdateConversationBrief(conversation.id);
  const generar = useGenerateConversationBrief(conversation.id);

  const brief = conversation.brief?.trim() ?? "";
  const tieneBrief = brief.length > 0;
  const editadoAMano = conversation.briefEditedByUserId !== null;
  // Mientras algo está en curso se deshabilitan TODOS los controles de la
  // tarjeta, no solo el que se apretó: las dos mutaciones escriben la misma
  // columna, y dejar "Regenerar" vivo mientras se guarda una edición sería
  // ofrecer una carrera entre dos escrituras del mismo dato.
  const enCurso = guardar.isPending || generar.isPending;

  function abrirEdicion() {
    setBorrador(brief);
    setEditando(true);
  }

  function cancelarEdicion() {
    setEditando(false);
    setBorrador("");
  }

  function confirmarEdicion() {
    // Vaciar el textarea y guardar equivale a borrar el resumen: se manda null
    // y la tarjeta vuelve al estado 1, ofreciendo generarlo de nuevo. Es la
    // única forma de borrarlo, y no hace falta un botón "Eliminar" aparte.
    const texto = borrador.trim();
    guardar.mutate(texto.length > 0 ? texto : null, { onSuccess: () => cancelarEdicion() });
  }

  function regenerar() {
    if (
      editadoAMano &&
      !window.confirm(
        "Este resumen lo editó una persona. Volver a generarlo con IA reemplaza ese texto y no se puede deshacer. ¿Seguir?",
      )
    ) {
      return;
    }
    generar.mutate();
  }

  // Una sola zona de error para las dos mutaciones, con el verbo de la que
  // falló: "no pudimos guardar" cuando falló una edición y "no pudimos
  // generar" cuando falló el modelo son dos cosas distintas para quien lee.
  const error = guardar.error ?? generar.error;
  const verboDelError = guardar.error ? "guardar" : "generar";

  return (
    <Card heading="Resumen">
      {editando ? (
        <div className="ds-stack">
          <label>
            <span className="ds-sr-only">Resumen de la conversación</span>
            <textarea
              rows={4}
              value={borrador}
              onChange={(event) => setBorrador(event.target.value)}
              disabled={enCurso}
            />
          </label>
          <p className="ds-hint">
            Vaciá el texto y guardá para borrar el resumen y poder generarlo de nuevo.
          </p>
          <div className="ds-card-actions">
            <Button onClick={cancelarEdicion} disabled={enCurso}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={confirmarEdicion}
              disabled={enCurso}
              loading={guardar.isPending}
            >
              {guardar.isPending ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="ds-stack">
          {tieneBrief ? (
            <>
              {/* .ds-brief-text conserva los saltos de línea: el modelo puede
                  separar en dos párrafos y una edición a mano casi siempre los
                  tiene. Perderlos convertiría el resumen en un bloque. */}
              <p className="ds-brief-text">{brief}</p>
              {editadoAMano ? (
                <p className="ds-hint">
                  Editado a mano
                  {conversation.briefEditedBy ? ` por ${conversation.briefEditedBy.fullName}` : ""}.
                </p>
              ) : null}
            </>
          ) : (
            <EmptyState>
              Esta conversación todavía no tiene un resumen. Generalo para ver de qué se trata sin
              leer el hilo entero.
            </EmptyState>
          )}

          <div className="ds-card-actions">
            {tieneBrief ? (
              <Button onClick={abrirEdicion} disabled={enCurso}>
                Editar
              </Button>
            ) : null}
            <Button
              variant="primary"
              onClick={regenerar}
              disabled={enCurso}
              loading={generar.isPending}
            >
              {generar.isPending
                ? "Generando…"
                : tieneBrief
                  ? "Regenerar resumen"
                  : "Generar resumen"}
            </Button>
          </div>
        </div>
      )}

      {/* El error se muestra abajo y la tarjeta NO se rompe: el brief que
          había sigue a la vista, que es lo correcto cuando falla generar uno
          nuevo. El mensaje viene del backend (el proveedor de LLM caído o sin
          configurar dice exactamente eso). */}
      {error ? (
        <ErrorState>
          No pudimos {verboDelError} el resumen
          {error instanceof Error ? `: ${error.message}` : "."}
        </ErrorState>
      ) : null}
    </Card>
  );
}
