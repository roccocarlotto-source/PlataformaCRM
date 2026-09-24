import { esUrlDeBaseLocal, hostDeLaUrl } from "./baseLocal";

// ¿Arranca este proceso los workers (ingesta, outbox, canales de Google,
// cotizaciones, oportunidades estancadas) y los registros de automatizaciones?
// G-02 de docs/auditoria-2026-09-24-punta-a-punta.md (ítem 129).
//
// El problema: `npm run dev` con un .env que apunta a la base real arrancaba
// los cinco workers en la laptop de quien estuviera tocando el frontend, que
// pasaba a reclamar y procesar colas de producción (automatizaciones con LLM,
// ingesta real, eventos de oportunidades estancadas, renovación de canales de
// Google hacia su propia URL), con logs debug y PII en su consola.
//
// La regla: SOLO en development, y SOLO si la base no es local, los workers no
// arrancan salvo que se pidan con DEV_ALLOW_REMOTE_DB=true. Producción y test
// no cambian: ahí los workers son el comportamiento esperado (y en test
// server.ts ni se importa). Una DATABASE_URL vacía o imparseable en
// development cuenta como no local: si no se puede comprobar, no se arranca.
//
// Pura y sin efectos para poder probarla; server.ts es quien la aplica y
// quien loguea el motivo.

export interface EntradaDeWorkersHabilitados {
  nodeEnv: "development" | "production" | "test";
  databaseUrl: string | undefined;
  permitirBaseRemota: boolean;
}

export interface DecisionDeWorkers {
  arrancar: boolean;
  motivo: string;
}

export function workersHabilitados({
  nodeEnv,
  databaseUrl,
  permitirBaseRemota,
}: EntradaDeWorkersHabilitados): DecisionDeWorkers {
  if (nodeEnv !== "development") {
    return { arrancar: true, motivo: `NODE_ENV=${nodeEnv}` };
  }
  if (esUrlDeBaseLocal(databaseUrl)) {
    return { arrancar: true, motivo: "development contra una base local" };
  }
  const host = hostDeLaUrl(databaseUrl) ?? "(sin DATABASE_URL válida)";
  if (permitirBaseRemota) {
    return {
      arrancar: true,
      motivo: `development contra una base remota (${host}) con DEV_ALLOW_REMOTE_DB=true`,
    };
  }
  return {
    arrancar: false,
    motivo: `development contra una base que no es local (${host})`,
  };
}
