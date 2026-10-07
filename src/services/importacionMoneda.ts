import type { Db } from "../lib/prisma";
import { findLatestExchangeRates } from "../repositories/organization.repository";

// ---------------------------------------------------------------------------
// La moneda local de la organización y su cotización vigente, para pasar a
// dólares el costo y el precio mínimo del stock importado (decisión 8 de
// docs/importacion-de-datos.md): los dos se guardan solo en USD.
//
// "Local" es la moneda de la organización que no es USD: la preferida, o si la
// preferida es USD, la alternativa. La cotización es la última que guardó el
// worker de cotizaciones (USD -> local); sin ella, la fila que la necesita
// falla con el motivo, y la vista previa lo avisa antes de confirmar.
// ---------------------------------------------------------------------------

export interface MonedaLocal {
  codigo: string | null;
  // Unidades de moneda local por dólar, y de qué día.
  cotizacion: { rate: number; fecha: string } | null;
}

export async function monedaLocalDe(organizationId: string, db: Db): Promise<MonedaLocal> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { preferredCurrency: true, alternateCurrency: true },
  });
  const codigo =
    org?.preferredCurrency && org.preferredCurrency !== "USD"
      ? org.preferredCurrency
      : org?.alternateCurrency && org.alternateCurrency !== "USD"
        ? org.alternateCurrency
        : null;
  if (!codigo) return { codigo: null, cotizacion: null };
  const [ultima] = await findLatestExchangeRates([codigo], db);
  return {
    codigo,
    cotizacion: ultima
      ? { rate: Number(ultima.rate), fecha: ultima.rateDate.toISOString().slice(0, 10) }
      : null,
  };
}

export const FALTA_MONEDA_LOCAL =
  "Hay montos en moneda local y la organización no tiene una moneda local configurada";
export const FALTA_COTIZACION =
  "Hay montos en moneda local y no hay una cotización cargada para pasarlos a dólares";
