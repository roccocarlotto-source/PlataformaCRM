// ---------------------------------------------------------------------------
// Notas de promoción — el registro que exige §4 de
// docs/ingestion-architecture.md.
//
// "Si ambos tienen valor y difieren, se conserva el del CRM y SE DEJA REGISTRO
// en el IngestionEvent. NUNCA SOBRESCRIBIR EN SILENCIO."
//
// Esa frase describe filas que se procesaron CON ÉXITO, así que el registro no
// puede vivir en errorMessage sin romper la consulta que §5 pide poder hacer
// ("cuántos fallaron y por qué"). Vive en IngestionEvent.promotionNotes, una
// columna JSONB propia; ver la migración 20260825140000 para el razonamiento
// completo.
//
// El tipo es discriminado y cerrado a propósito: una columna JSONB sin forma
// declarada es exactamente la estructura inventada que este proyecto evita, y
// además haría imposible consultarla sin adivinar qué escribió cada versión del
// código.
// ---------------------------------------------------------------------------

// El CRM y el dato entrante tenían los dos un valor y no coincidían. Ganó el
// CRM (§4: "los datos que cargó una persona valen más que los que llegan de un
// formulario") y acá queda lo que se descartó, para que sea recuperable.
export interface NotaConflicto {
  tipo: "conflicto";
  campo: string;
  crm: string;
  entrante: string;
}

// §4: "Contactos sin email no se deduplican automáticamente. Se promueven como
// nuevos y se marcan para revisión manual."
export interface NotaRevisionManual {
  tipo: "revision_manual";
  motivo: string;
}

// Un campo que la fuente mandó y la promoción decidió no escribir NUNCA, ni
// siquiera sobre un valor nulo. Hoy solo lifecycleStage: la ingesta no lo
// escribe en ningún caso (ni al crear ni al actualizar), así que un payload que
// lo traiga se está ignorando por completo — y "nunca en silencio" aplica igual
// que a un conflicto, aunque no haya un valor previo que conservar.
export interface NotaIgnorado {
  tipo: "ignorado";
  campo: string;
  entrante: string;
  motivo: string;
}

export type PromotionNote = NotaConflicto | NotaRevisionManual | NotaIgnorado;
