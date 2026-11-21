import assert from "node:assert/strict";
import { test } from "node:test";
import { TOKEN_NOMBRE } from "../../utils/whatsappTemplateText";
import type { RecordatorioParaEnviar } from "./repository";
import { valoresDelRecordatorio } from "./recordatorioWorker";

// ---------------------------------------------------------------------------
// El nombre del saludo de la plantilla ({nombre}) cuando el contacto no tiene
// nombre: el término de la organización (docs/primera-clinica.md §4, PR3).
// Antes era siempre "paciente", también en un centro de belleza que llama
// "cliente" a sus contactos.
// ---------------------------------------------------------------------------

function fila(
  firstName: string,
  contactTerm: "PACIENTE" | "CLIENTE" | null,
): RecordatorioParaEnviar {
  return {
    contact: {
      firstName,
      lastName: "",
      phone: "+59899000000",
      deletedAt: null,
      noInterestAt: null,
    },
    booking: {
      startsAt: new Date("2027-03-01T13:00:00Z"),
      branch: { name: "Centro", timezone: "America/Montevideo", deletedAt: null },
      resource: { name: "Ana" },
      serviceType: { followUpAfterDays: null },
    },
    organization: {
      name: "Centro Ejemplo",
      clinicSettings: contactTerm === null ? null : { contactTerm },
    },
  } as unknown as RecordatorioParaEnviar;
}

test("sin nombre, el saludo usa el término de la organización; con nombre, el nombre", () => {
  assert.equal(valoresDelRecordatorio(fila("", "CLIENTE"), 1)[TOKEN_NOMBRE], "cliente");
  assert.equal(valoresDelRecordatorio(fila("  ", "PACIENTE"), 1)[TOKEN_NOMBRE], "paciente");
  // Sin fila de configuración de clínica: el de siempre.
  assert.equal(valoresDelRecordatorio(fila("", null), 1)[TOKEN_NOMBRE], "paciente");
  assert.equal(valoresDelRecordatorio(fila("Lucía", "CLIENTE"), 1)[TOKEN_NOMBRE], "Lucía");
});
