import type { Express } from "express";
import { authenticate } from "../middlewares/authenticate";
import { rolesDeAuthorize } from "../middlewares/authorize";
import type { RoleName } from "../types/auth";

// ---------------------------------------------------------------------------
// Las rutas que la app tiene montadas, recorriendo el router real de Express
// 4. Lo usan el test de clasificación de ediciones (src/config/ediciones.test.ts)
// y el de roles (src/services/permisos.test.ts).
//
//   - autenticada: si su cadena tiene `authenticate` (se compara la función,
//     no el nombre);
//   - roles: los que deja pasar su `authorize(...)`, o null si no tiene.
// ---------------------------------------------------------------------------

export interface RutaMontada {
  ruta: string;
  autenticada: boolean;
  roles: readonly RoleName[] | null;
}

interface Capa {
  route?: {
    path: string | string[];
    methods: Record<string, boolean>;
    stack: { handle: unknown }[];
  };
  name: string;
  regexp?: RegExp;
  handle: { stack?: Capa[] };
}

// El prefijo de un router montado con app.use("/api", router), a partir de la
// regexp que arma Express 4: /^\/api\/?(?=\/|$)/i. Los routers sin prefijo
// tienen la regexp de "/" (/^\/?(?=\/|$)/i).
function prefijoDe(capa: Capa): string {
  const fuente = capa.regexp?.source ?? "";
  const crudo = fuente
    .replace(/^\^/, "")
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, "")
    .replace(/\\\//g, "/");
  return crudo === "/" || crudo === "" ? "" : crudo;
}

export function rutasMontadas(app: Express): RutaMontada[] {
  const salida: RutaMontada[] = [];
  const recorrer = (pila: Capa[], prefijo: string) => {
    for (const capa of pila) {
      if (capa.route) {
        const paths = Array.isArray(capa.route.path) ? capa.route.path : [capa.route.path];
        const autenticada = capa.route.stack.some((s) => s.handle === authenticate);
        const roles =
          capa.route.stack.map((s) => rolesDeAuthorize(s.handle)).find((r) => r !== null) ?? null;
        for (const metodo of Object.keys(capa.route.methods)) {
          if (!capa.route.methods[metodo]) continue;
          for (const path of paths) {
            salida.push({ ruta: `${metodo.toUpperCase()} ${prefijo}${path}`, autenticada, roles });
          }
        }
      } else if (capa.name === "router" && capa.handle.stack) {
        recorrer(capa.handle.stack, prefijo + prefijoDe(capa));
      }
    }
  };
  recorrer((app as unknown as { _router: { stack: Capa[] } })._router.stack, "");
  return salida;
}
