import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";

// ---------------------------------------------------------------------------
// DESCARGAR UNA URL QUE ELIGIÓ OTRO, SIN QUE SIRVA PARA LLEGAR A LA RED
// INTERNA (SSRF) — docs/importacion-de-datos.md §9.3. Hasta acá el backend
// solo hablaba con hosts fijos (Meta, Google, OpenRouter); la importación de
// stock baja fotos de links que vienen en la planilla de un cliente, y un
// link a http://169.254.169.254/ (la metadata de la nube) o a
// http://localhost:5432 tiene que fallar.
//
// LAS REGLAS:
//   - solo http: y https:, puertos 80 y 443 (los implícitos), sin usuario ni
//     contraseña en la URL;
//   - el host se resuelve (todas sus direcciones) y se rechaza si CUALQUIERA
//     es privada, de loopback, link-local, CGNAT, multicast, reservada, de
//     documentación, ULA de IPv6, o un IPv4 mapeado/traducido en IPv6 que
//     caiga en esos rangos;
//   - LA CONEXIÓN VA A LA IP YA VALIDADA (la opción `lookup` de
//     http/https.request): un DNS que cambia de respuesta entre la validación
//     y la conexión (DNS rebinding) no la saltea. SNI y Host siguen siendo el
//     nombre original;
//   - redirecciones a mano, hasta MAX_REDIRECCIONES, cada una validada como
//     la primera;
//   - tope de bytes cortando el stream (también si Content-Length miente),
//     tope de tiempo para conectar y para todo;
//   - sin cookies ni headers de autenticación.
//
// Sin dependencias: net.BlockList, dns.lookup y http(s).request de Node.
// ---------------------------------------------------------------------------

const PROHIBIDAS = new BlockList();
for (const [red, prefijo] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  PROHIBIDAS.addSubnet(red, prefijo, "ipv4");
}
for (const [red, prefijo] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  PROHIBIDAS.addSubnet(red, prefijo, "ipv6");
}

// Un IPv4 escrito dentro de un IPv6 (::ffff:10.0.0.1, o en hexa
// ::ffff:a00:1): se juzga por el IPv4.
function ipv4Embebida(ip: string): string | null {
  const m = /^::ffff:(?:0:)?(.+)$/i.exec(ip);
  if (!m) return null;
  if (isIP(m[1]) === 4) return m[1];
  const hexa = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(m[1]);
  if (!hexa) return null;
  const alto = parseInt(hexa[1], 16);
  const bajo = parseInt(hexa[2], 16);
  return [alto >> 8, alto & 255, bajo >> 8, bajo & 255].join(".");
}

export function esIpPublica(ip: string): boolean {
  const familia = isIP(ip);
  if (familia === 0) return false;
  if (familia === 6) {
    const v4 = ipv4Embebida(ip);
    if (v4) return !PROHIBIDAS.check(v4, "ipv4");
    return !PROHIBIDAS.check(ip, "ipv6");
  }
  return !PROHIBIDAS.check(ip, "ipv4");
}

export class DescargaRechazada extends Error {
  constructor(
    message: string,
    // PERMANENTE: no se reintenta (URL prohibida, 404, demasiado grande).
    // TRANSITORIO: puede salir bien la próxima vez (timeout, 5xx, red).
    readonly clase: "PERMANENTE" | "TRANSITORIO",
  ) {
    super(message);
    this.name = "DescargaRechazada";
  }
}

export interface OpcionesDeDescarga {
  maxBytes: number;
  timeoutMs: number;
  conectarTimeoutMs: number;
  maxRedirecciones?: number;
  // Solo para tests: qué IP se acepta (los tests levantan un servidor en
  // 127.0.0.1, que en producción está prohibida). Por defecto, esIpPublica.
  ipPermitida?: (ip: string) => boolean;
  // Solo para tests, por lo mismo: el servidor de prueba escucha en un puerto
  // que no es el 80.
  cualquierPuerto?: boolean;
}

export interface Descarga {
  buffer: Buffer;
  contentType: string | null;
  urlFinal: string;
}

const MAX_REDIRECCIONES = 3;

function validarUrl(texto: string, cualquierPuerto = false): URL {
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    throw new DescargaRechazada("no es una URL válida", "PERMANENTE");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DescargaRechazada("solo se aceptan links http o https", "PERMANENTE");
  }
  if (url.port !== "" && !cualquierPuerto) {
    throw new DescargaRechazada("el link no puede llevar un puerto propio", "PERMANENTE");
  }
  if (url.username !== "" || url.password !== "") {
    throw new DescargaRechazada("el link no puede llevar usuario ni contraseña", "PERMANENTE");
  }
  return url;
}

function hostSinCorchetes(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "");
}

type Lookup = (
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: (err: Error | null, address: string | LookupAddress[], family?: number) => void,
) => void;

// El resolutor que se le pasa a http.request: resuelve TODAS las direcciones,
// rechaza si alguna no está permitida, y entrega la validada. Así la conexión
// va exactamente a la IP que se revisó.
function lookupSeguro(ipPermitida: (ip: string) => boolean): Lookup {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { all: true }, (err, direcciones) => {
      if (err) {
        callback(new DescargaRechazada(`no se encontró el host «${hostname}»`, "TRANSITORIO"), []);
        return;
      }
      const lista = direcciones as LookupAddress[];
      if (lista.length === 0 || lista.some((d) => !ipPermitida(d.address))) {
        callback(
          new DescargaRechazada(
            `«${hostname}» apunta a una dirección que no es pública`,
            "PERMANENTE",
          ),
          [],
        );
        return;
      }
      if (options.all) callback(null, lista);
      else callback(null, lista[0].address, lista[0].family);
    });
  };
}

function pedir(url: URL, opciones: OpcionesDeDescarga, ipPermitida: (ip: string) => boolean) {
  return new Promise<{ respuesta: IncomingMessage; destruir: () => void }>((resolve, reject) => {
    const host = hostSinCorchetes(url);
    if (isIP(host) !== 0 && !ipPermitida(host)) {
      reject(
        new DescargaRechazada("el link apunta a una dirección que no es pública", "PERMANENTE"),
      );
      return;
    }
    const modulo = url.protocol === "https:" ? https : http;
    const req = modulo.request(url, {
      method: "GET",
      lookup: lookupSeguro(ipPermitida) as never,
      // Sin el agente global: un socket keep-alive ya abierto se reusaría sin
      // pasar por lookupSeguro. Cada descarga abre su conexión y valida su IP.
      agent: false,
      headers: { "User-Agent": "PlataformaCRM-importacion/1.0", Accept: "image/*,*/*;q=0.5" },
      timeout: opciones.conectarTimeoutMs,
    });
    req.on("timeout", () =>
      req.destroy(new DescargaRechazada("el servidor tardó demasiado en responder", "TRANSITORIO")),
    );
    req.on("error", (err) =>
      reject(
        err instanceof DescargaRechazada ? err : new DescargaRechazada(err.message, "TRANSITORIO"),
      ),
    );
    req.on("response", (respuesta) => resolve({ respuesta, destruir: () => req.destroy() }));
    req.end();
  });
}

function leerConTope(respuesta: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declarado = Number(respuesta.headers["content-length"]);
    if (Number.isFinite(declarado) && declarado > maxBytes) {
      respuesta.destroy();
      reject(
        new DescargaRechazada(`el archivo supera los ${String(maxBytes)} bytes`, "PERMANENTE"),
      );
      return;
    }
    const partes: Buffer[] = [];
    let total = 0;
    respuesta.on("data", (parte: Buffer) => {
      total += parte.length;
      if (total > maxBytes) {
        respuesta.destroy();
        reject(
          new DescargaRechazada(`el archivo supera los ${String(maxBytes)} bytes`, "PERMANENTE"),
        );
        return;
      }
      partes.push(parte);
    });
    respuesta.on("end", () => resolve(Buffer.concat(partes)));
    respuesta.on("error", (err) => reject(new DescargaRechazada(err.message, "TRANSITORIO")));
  });
}

export async function fetchPublico(texto: string, opciones: OpcionesDeDescarga): Promise<Descarga> {
  const ipPermitida = opciones.ipPermitida ?? esIpPublica;
  const maxRedirecciones = opciones.maxRedirecciones ?? MAX_REDIRECCIONES;
  let destruir: (() => void) | undefined;
  const total = new Promise<never>((_, reject) => {
    const t = setTimeout(() => {
      destruir?.();
      reject(new DescargaRechazada("la descarga tardó demasiado", "TRANSITORIO"));
    }, opciones.timeoutMs);
    t.unref();
  });

  const descargar = async (): Promise<Descarga> => {
    let url = validarUrl(texto, opciones.cualquierPuerto);
    for (let saltos = 0; ; saltos++) {
      const { respuesta, destruir: d } = await pedir(url, opciones, ipPermitida);
      destruir = d;
      const status = respuesta.statusCode ?? 0;
      if (status >= 300 && status < 400 && respuesta.headers.location) {
        respuesta.resume();
        if (saltos >= maxRedirecciones) {
          throw new DescargaRechazada("demasiadas redirecciones", "PERMANENTE");
        }
        url = validarUrl(
          new URL(respuesta.headers.location, url).toString(),
          opciones.cualquierPuerto,
        );
        continue;
      }
      if (status < 200 || status >= 300) {
        respuesta.resume();
        throw new DescargaRechazada(
          `el servidor respondió ${String(status)}`,
          status >= 500 || status === 429 ? "TRANSITORIO" : "PERMANENTE",
        );
      }
      const buffer = await leerConTope(respuesta, opciones.maxBytes);
      const tipo = respuesta.headers["content-type"];
      return {
        buffer,
        contentType: typeof tipo === "string" ? tipo : null,
        urlFinal: url.toString(),
      };
    }
  };

  return Promise.race([descargar(), total]);
}

// Un link de Google Drive a la página del archivo
// (drive.google.com/file/d/<id>/view, /open?id=<id>) devuelve HTML, no la
// imagen: se reescribe a la descarga directa (§6).
export function urlDeDescargaDirecta(texto: string): string {
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return texto;
  }
  if (url.hostname !== "drive.google.com") return texto;
  const porRuta = /^\/file\/d\/([^/]+)/.exec(url.pathname)?.[1];
  const id = porRuta ?? url.searchParams.get("id");
  return id ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}` : texto;
}
