import { setupServer } from "msw/node";

// Sin handlers por default: cada test define exactamente la respuesta que
// necesita vía server.use(...) — server.listen({ onUnhandledRequest: "error" })
// en setup.ts hace que cualquier request no contemplada falle ruidosamente
// en vez de intentar pegarle a una red real dentro de jsdom.
export const server = setupServer();
