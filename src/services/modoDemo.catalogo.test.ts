import assert from "node:assert/strict";
import { test } from "node:test";
import * as metaSend from "./metaSend.service";
import * as whatsappGraph from "./whatsappGraph.service";
import { depsDePlantillasReales } from "./whatsappTemplate.service";

// ---------------------------------------------------------------------------
// El catálogo de salidas reales (docs-privados/taller-demo-diseno.md §2.4,
// local), con el mismo criterio que "el catálogo tiene exactamente las N
// tools": toda función exportada con sufijo `Real` de whatsappGraph.service.ts
// y metaSend.service.ts tiene que estar clasificada acá. Una salida nueva que
// no esté rompe este test hasta que alguien decida qué hace en modo demo y la
// agregue, con la guardia que le corresponda.
//
//   simulada    la reemplaza salidasPara / depsDePlantillasPara;
//   bloqueada   la acción que la dispara responde 409 en una demo;
//   lectura     no le llega nada a nadie, y solo corre al RECIBIR algo real
//               (una demo no tiene número ni página): no hace falta cortarla.
// ---------------------------------------------------------------------------

type Clase = "simulada" | "bloqueada" | "lectura";

export const CATALOGO_DE_SALIDAS: Record<string, Clase> = {
  // Mensajes (salidasPara).
  sendWhatsappTextReal: "simulada",
  sendWhatsappTemplateReal: "simulada",
  sendMetaTextReal: "simulada",
  // Plantillas (depsDePlantillasPara).
  createWhatsappTemplateReal: "simulada",
  uploadTemplateSampleReal: "simulada",
  deleteWhatsappTemplateReal: "simulada",
  getWhatsappTemplateStatusReal: "simulada",
  // Alta de un WABA propio: conectarWabaDeLaClinica da 409 en una demo.
  subscribeAppToWabaReal: "bloqueada",
  listWabaPhoneNumbersReal: "bloqueada",
  // Un adjunto que mandó un cliente real por un número real.
  downloadWhatsappMediaReal: "lectura",
};

function exportadasReal(modulo: Record<string, unknown>): string[] {
  return Object.keys(modulo)
    .filter((k) => k.endsWith("Real") && typeof modulo[k] === "function")
    .sort();
}

test("toda salida `*Real` de WhatsApp y Meta está clasificada en el catálogo del modo demo", () => {
  const exportadas = [...exportadasReal(whatsappGraph), ...exportadasReal(metaSend)].sort();
  assert.deepEqual(
    exportadas,
    Object.keys(CATALOGO_DE_SALIDAS).sort(),
    "hay una salida real nueva (o una que ya no existe): decidí qué hace en modo demo y actualizá CATALOGO_DE_SALIDAS y modoDemo.service.ts",
  );
});

test("las salidas simuladas del catálogo son exactamente las que la guardia reemplaza", () => {
  const simuladas = Object.entries(CATALOGO_DE_SALIDAS)
    .filter(([, clase]) => clase === "simulada")
    .map(([nombre]) => nombre)
    .sort();
  // Las de mensajes, por las claves de SalidasDeMensajes; las de plantillas,
  // por las claves de DepsDePlantillas que depsDePlantillasReales toma de
  // whatsappGraph. Si alguien agrega una `*Real` a un deps sin agregarla a la
  // guardia, el primer test ya falla; este fija cuáles son.
  assert.deepEqual(simuladas, [
    "createWhatsappTemplateReal",
    "deleteWhatsappTemplateReal",
    "getWhatsappTemplateStatusReal",
    "sendMetaTextReal",
    "sendWhatsappTemplateReal",
    "sendWhatsappTextReal",
    "uploadTemplateSampleReal",
  ]);
  assert.equal(depsDePlantillasReales.create, whatsappGraph.createWhatsappTemplateReal);
  assert.equal(depsDePlantillasReales.delete, whatsappGraph.deleteWhatsappTemplateReal);
  assert.equal(depsDePlantillasReales.getStatus, whatsappGraph.getWhatsappTemplateStatusReal);
  assert.equal(depsDePlantillasReales.uploadSample, whatsappGraph.uploadTemplateSampleReal);
});
