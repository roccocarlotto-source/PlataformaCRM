import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { DescargaRechazada, esIpPublica, fetchPublico, urlDeDescargaDirecta } from "./fetchPublico";

// docs/importacion-de-datos.md §9.3: descargar un link que eligió otro sin
// que sirva para llegar a la red interna.

test("esIpPublica: los rangos privados, de loopback, link-local, CGNAT, multicast, reservados y de documentación no son públicos", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.10",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "192.0.2.1",
    "198.18.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "64:ff9b::7f00:1",
    "no-es-ip",
  ]) {
    assert.equal(esIpPublica(ip), false, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2001:4860:4860::8888", "::ffff:8.8.8.8"]) {
    assert.equal(esIpPublica(ip), true, ip);
  }
});

let servidor: Server;
let base: string;

before(async () => {
  servidor = createServer((req, res) => {
    switch (req.url) {
      case "/foto":
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
        return;
      case "/redirige":
        res.writeHead(302, { Location: "/foto" });
        res.end();
        return;
      case "/redirige-afuera":
        res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data" });
        res.end();
        return;
      case "/bucle":
        res.writeHead(302, { Location: "/bucle" });
        res.end();
        return;
      case "/grande":
        // Sin Content-Length: el tope se aplica cortando el stream.
        res.writeHead(200, { "Content-Type": "image/jpeg" });
        res.write(Buffer.alloc(600));
        res.end(Buffer.alloc(600));
        return;
      case "/lenta":
        res.writeHead(200);
        setTimeout(() => res.end("tarde"), 2_000).unref();
        return;
      case "/no-existe":
        res.writeHead(404);
        res.end();
        return;
      default:
        res.writeHead(503);
        res.end();
    }
  });
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  base = `http://localhost:${String((servidor.address() as AddressInfo).port)}`;
});

after(() => new Promise<void>((resolve) => servidor.close(() => resolve())));

// El servidor de prueba está en 127.0.0.1 y en un puerto propio: para los
// casos que tienen que llegar a él se permiten esa IP y ese puerto.
const PARA_EL_SERVIDOR = {
  maxBytes: 1_000,
  timeoutMs: 1_000,
  conectarTimeoutMs: 500,
  ipPermitida: (ip: string) => ip === "127.0.0.1" || ip === "::1",
  cualquierPuerto: true,
};

async function rechazo(promesa: Promise<unknown>): Promise<DescargaRechazada> {
  try {
    await promesa;
  } catch (err) {
    assert.ok(err instanceof DescargaRechazada, String(err));
    return err;
  }
  assert.fail("tenía que rechazarse");
}

test("fetchPublico: baja la imagen y sigue una redirección dentro de lo permitido", async () => {
  const directa = await fetchPublico(`${base}/foto`, PARA_EL_SERVIDOR);
  assert.equal(directa.contentType, "image/png");
  assert.equal(directa.buffer.length, 11);
  const redirigida = await fetchPublico(`${base}/redirige`, PARA_EL_SERVIDOR);
  assert.equal(redirigida.buffer.length, 11);
  assert.match(redirigida.urlFinal, /\/foto$/);
});

test("fetchPublico: con las reglas de verdad, localhost y 127.0.0.1 se rechazan aunque el servidor exista", async () => {
  const reglas = {
    maxBytes: 1_000,
    timeoutMs: 1_000,
    conectarTimeoutMs: 500,
    cualquierPuerto: true,
  };
  for (const url of [
    `${base}/foto`,
    `${base.replace("localhost", "127.0.0.1")}/foto`,
    "http://[::1]/foto",
  ]) {
    const err = await rechazo(fetchPublico(url, reglas));
    assert.equal(err.clase, "PERMANENTE", url);
    assert.match(err.message, /no es pública/);
  }
});

test("fetchPublico: una redirección a la metadata de la nube se rechaza, y un bucle de redirecciones también", async () => {
  const afuera = await rechazo(
    fetchPublico(`${base}/redirige-afuera`, {
      ...PARA_EL_SERVIDOR,
      ipPermitida: (ip) => ip === "127.0.0.1",
    }),
  );
  assert.match(afuera.message, /no es pública/);
  const bucle = await rechazo(fetchPublico(`${base}/bucle`, PARA_EL_SERVIDOR));
  assert.match(bucle.message, /demasiadas redirecciones/);
});

test("fetchPublico: con hostPermitido, ni la primera URL ni una redirección pueden ir a otro host", async () => {
  const soloOtro = { ...PARA_EL_SERVIDOR, hostPermitido: (h: string) => h === "docs.google.com" };
  assert.match(
    (await rechazo(fetchPublico(`${base}/foto`, soloOtro))).message,
    /no se sigue a «localhost»/,
  );
  const soloLocal = { ...PARA_EL_SERVIDOR, hostPermitido: (h: string) => h === "localhost" };
  assert.equal((await fetchPublico(`${base}/redirige`, soloLocal)).buffer.length, 11);
  const afuera = await rechazo(fetchPublico(`${base}/redirige-afuera`, soloLocal));
  assert.match(afuera.message, /no se sigue a «169\.254\.169\.254»/);
});

test("fetchPublico: el tope de bytes corta el stream, y el de tiempo corta una respuesta lenta", async () => {
  const grande = await rechazo(fetchPublico(`${base}/grande`, PARA_EL_SERVIDOR));
  assert.equal(grande.clase, "PERMANENTE");
  assert.match(grande.message, /supera los 1000 bytes/);
  const lenta = await rechazo(
    fetchPublico(`${base}/lenta`, { ...PARA_EL_SERVIDOR, timeoutMs: 200 }),
  );
  assert.equal(lenta.clase, "TRANSITORIO");
});

test("fetchPublico: un 404 es permanente, un 5xx transitorio", async () => {
  assert.equal(
    (await rechazo(fetchPublico(`${base}/no-existe`, PARA_EL_SERVIDOR))).clase,
    "PERMANENTE",
  );
  assert.equal((await rechazo(fetchPublico(`${base}/cae`, PARA_EL_SERVIDOR))).clase, "TRANSITORIO");
});

test("fetchPublico: otro esquema, un puerto propio o credenciales en la URL se rechazan sin conectar", async () => {
  const reglas = { maxBytes: 1_000, timeoutMs: 1_000, conectarTimeoutMs: 500 };
  for (const url of [
    "ftp://example.com/foto.jpg",
    "file:///etc/passwd",
    "http://example.com:8080/foto.jpg",
    "https://usuario:clave@example.com/foto.jpg",
    "no es una url",
  ]) {
    assert.equal((await rechazo(fetchPublico(url, reglas))).clase, "PERMANENTE", url);
  }
});

test("urlDeDescargaDirecta: un link de Drive a la página del archivo pasa a la descarga directa; lo demás queda igual", () => {
  assert.equal(
    urlDeDescargaDirecta("https://drive.google.com/file/d/ABC123/view?usp=sharing"),
    "https://drive.google.com/uc?export=download&id=ABC123",
  );
  assert.equal(
    urlDeDescargaDirecta("https://drive.google.com/open?id=XYZ"),
    "https://drive.google.com/uc?export=download&id=XYZ",
  );
  assert.equal(
    urlDeDescargaDirecta("https://fotos.example.com/a.jpg"),
    "https://fotos.example.com/a.jpg",
  );
});
