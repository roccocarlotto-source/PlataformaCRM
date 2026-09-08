import { env } from "../config/env";

export class ApiError extends Error {
  readonly status: number;
  // Detalle estructurado que el backend adjunta al mensaje en algunos errores
  // operacionales (AppError.details, errorHandler.ts): errorHandler hace
  // spread de ese objeto DENTRO de `error`, junto a `message`, así que el body
  // de un 422 de completitud es `{ error: { message, missingFields: [...] } }`,
  // no `{ error: { message, details: {...} } }`. Acá queda todo lo que vino en
  // `error` además de `message`. Opcional y aditivo: los ~40 call sites que
  // solo leen status/message no cambian.
  readonly details?: Record<string, unknown>;

  constructor(status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

type GetAccessToken = () => Promise<string | null>;

interface RequestOptions {
  // PUT entró con el reorden de fotos de Vehicle (PUT /vehicles/:id/photos/reorder).
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  getAccessToken?: GetAccessToken;
  signal?: AbortSignal;
}

// R1.4 — reacción a una sesión inválida/vencida (401). Registrable una sola
// vez en vez de inyectarse en cada llamada como getAccessToken: a
// diferencia del token, que varía por request, la reacción a un 401 es
// siempre la misma para toda la app. AuthContext la registra al montar,
// apuntando a supabase.auth.signOut() — este archivo sigue sin importar
// Supabase directamente, mismo desacoplamiento que ya tenía con el token.
type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export function registerUnauthorizedHandler(handler: UnauthorizedHandler): void {
  unauthorizedHandler = handler;
}

// env.apiUrl ya viene sin barra final (normalizado en config/env.ts) —
// path siempre debe empezar con "/" (convención interna de este wrapper).
//
// R1 — bug preexistente descubierto durante Product Readiness: todas las
// rutas de negocio del backend están montadas bajo /api (ver
// src/routes/index.ts — "las rutas de negocio van bajo /api"), pero hasta
// ahora ningún módulo de frontend excepto /api/me lo incluía en su path
// (ver AuthContext.tsx). Nunca se detectó porque cada test MSW construye
// su URL mock con el mismo criterio (sin /api) que el código que prueba —
// mock y código coincidían entre sí, nunca contra las rutas reales del
// backend. Centralizado acá, único lugar donde se arma esta URL, en vez de
// prefijar "/api" en cada uno de los ~40 call sites de request<T>(...).
function buildUrl(path: string): string {
  return `${env.apiUrl}/api${path}`;
}

function isErrorBody(
  value: unknown,
): value is { error: { message: string } & Record<string, unknown> } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { error?: { message?: unknown } }).error?.message === "string"
  );
}

interface ExtractedError {
  message: string;
  details?: Record<string, unknown>;
}

// Solo para la rama !res.ok: el status ya es una verdad conocida y
// confiable (vino de una respuesta HTTP real). Este helper nunca le quita
// el ApiError al llamador — como mucho degrada el mensaje a un fallback.
//
// `details` es lo que `error` trae además de `message` (ver ApiError). Se
// omite cuando no hay nada más, así un error común sigue siendo un ApiError
// sin details, igual que antes.
async function extractError(res: Response): Promise<ExtractedError> {
  const fallback = { message: res.statusText || `Error ${res.status} inesperado` };

  // Si la LECTURA del stream falla (conexión cortada a mitad de la
  // respuesta), eso se propaga tal cual, sin atraparlo acá — es un fallo
  // de red real, no un problema de formato del body.
  const text = await res.text();
  if (!text) return fallback;

  try {
    const payload: unknown = JSON.parse(text);
    if (!isErrorBody(payload)) return fallback;
    const { message, ...rest } = payload.error;
    return Object.keys(rest).length > 0 ? { message, details: rest } : { message };
  } catch {
    return fallback; // body no-JSON (ej. página de error de un proxy)
  }
}

// Wrapper base sobre fetch nativo. No conoce Supabase ni React Router ni
// ningún Context — el token se inyecta vía getAccessToken, así M1 lo
// consume sin tener que reescribir este archivo.
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};

  const token = await options.getAccessToken?.();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  // Si fetch() rechaza (DNS, conexión rechazada, offline), la excepción
  // nativa (TypeError, sin .status) se propaga sin ningún try/catch
  // alrededor — nunca se convierte en ApiError.
  const res = await fetch(buildUrl(path), {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  return handleResponse<T>(res);
}

// El manejo de la RESPUESTA, compartido por request() y uploadFile().
//
// Se extrajo al agregar el soporte de multipart: es exactamente la misma lógica
// —el 401 global, la extracción del mensaje de error, el 204 sin body, el parseo
// del JSON— y tenerla dos veces habría hecho que cualquier divergencia futura
// entre las dos funciones fuera un bug silencioso en una mitad de la app.
//
// El comportamiento es idéntico al que request() tenía inline: este cambio no
// altera nada para los call sites existentes.
async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    // 401 = el propio token ya no es válido (vencido más allá de lo que el
    // auto-refresh de Supabase pudo cubrir, revocado, etc.) — a diferencia
    // de un 403 (identidad válida, cuenta/organización no disponible, ver
    // AuthContext), acá no hay nada que reintentar: solo tiene sentido
    // cerrar la sesión. 204/205/304 no llegan nunca a esta rama (!res.ok
    // exige status >= 400), así que no hay riesgo de dispararlo fuera de un
    // error real.
    if (res.status === 401) {
      unauthorizedHandler?.();
    }
    const { message, details } = await extractError(res);
    throw new ApiError(res.status, message, details);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  // 2xx con body: sin red de contención. Si el JSON es inválido, el
  // SyntaxError nativo de res.json() se propaga tal cual — nunca se
  // convierte en null ni en ApiError. Una respuesta "exitosa" con body
  // corrupto es una violación de contrato del backend, no un error de
  // negocio ni un error de red.
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Subida de archivos por multipart — G-6 de
// docs/research-frontend-ingesta-2026-08-27.md.
//
// request() no sirve para esto y no es cuestión de agregarle una rama: siempre
// hace JSON.stringify del body y siempre fija Content-Type: application/json.
// Un FormData por ese camino llegaría al backend como "[object Object]".
//
// LO QUE NO SE FIJA ACÁ, Y ES EL PUNTO ENTERO: el Content-Type. Un multipart
// necesita un boundary —una marca aleatoria que separa las partes— y el header
// tiene que declararlo. `fetch` lo genera solo cuando recibe un FormData Y NADIE
// le puso el header a mano; ponerlo, aunque sea con el valor "correcto"
// multipart/form-data, deja al backend sin boundary que buscar y multer rechaza
// el cuerpo entero.
//
// Todo lo demás es igual que request(): mismo buildUrl, mismo token opcional,
// mismo handleResponse.
// ---------------------------------------------------------------------------
export async function uploadFile<T>(
  path: string,
  formData: FormData,
  // Método siempre POST: los dos usos (importar y previsualizar) lo son. Cuando
  // aparezca un PUT/PATCH multipart se agrega el parámetro; hoy sería una opción
  // sin consumidor.
  options: { getAccessToken?: GetAccessToken; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = {};

  const token = await options.getAccessToken?.();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(buildUrl(path), {
    method: "POST",
    headers,
    body: formData,
    signal: options.signal,
  });

  return handleResponse<T>(res);
}
