import type { Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// ExchangeRate — la única tabla de negocio SIN organizationId (decisión de la
// Fase 1: la cotización USD→X es un dato público, igual para todas las
// cuentas). La escribe solo el worker de cotizaciones; las lecturas de
// negocio ("la última cotización de las monedas de ESTA organización") viven
// en organization.repository.ts, al lado de la configuración que las pide.
// ---------------------------------------------------------------------------

export interface ExchangeRateUpsertData {
  baseCurrency: string;
  targetCurrency: string;
  rate: number;
  rateDate: Date;
  fetchedAt: Date;
}

// Upsert sobre la unique compuesta (base, destino, día). Si el worker corre
// dos veces el mismo día —reinicio del proceso— la segunda pasada PISA rate y
// fetchedAt, no duplica fila. `baseCurrency_targetCurrency_rateDate` es el
// nombre que Prisma generó para el @@unique de tres campos (verificado en
// node_modules/.prisma/client/index.d.ts, no asumido).
export function upsertExchangeRate(data: ExchangeRateUpsertData, db: Db = prisma) {
  const where: Prisma.ExchangeRateWhereUniqueInput = {
    baseCurrency_targetCurrency_rateDate: {
      baseCurrency: data.baseCurrency,
      targetCurrency: data.targetCurrency,
      rateDate: data.rateDate,
    },
  };
  return db.exchangeRate.upsert({
    where,
    create: data,
    update: { rate: data.rate, fetchedAt: data.fetchedAt },
  });
}
