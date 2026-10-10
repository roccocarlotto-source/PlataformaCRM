import type { ContactTerm } from "@prisma/client";
import { MARCA, termino, type Termino, type Vocabulario } from "../../config/terminos";

// ---------------------------------------------------------------------------
// Configuración del rubro CLINICA (docs/rubros.md §1.3). Es parte del
// producto: nadie la cambia desde la app.
//
// Este archivo crece por secciones, una por PR del plan. Hoy:
//   - VOCABULARIO (R3, §3).
// Los textos del agente y los mensajes fijos de salud (R4, §3.2 y §5.3) van en
// sus propios archivos de src/clinicas/config/.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// VOCABULARIO (§3)
// ---------------------------------------------------------------------------

/** Cómo una clínica llama a sus contactos: lo elige su ADMIN
 *  (ClinicSettings.contactTerm, default PACIENTE). */
export const TERMINO_DEL_CONTACTO: Readonly<Record<ContactTerm, Termino>> = {
  PACIENTE: termino("paciente", "pacientes"),
  CLIENTE: termino("cliente", "clientes"),
};

export function vocabularioDeClinica(contactTerm: ContactTerm): Vocabulario {
  return {
    marca: MARCA,
    contacto: TERMINO_DEL_CONTACTO[contactTerm],
    recurso: termino("profesional", "profesionales"),
    tipoDeServicio: termino("prestación", "prestaciones"),
    reserva: termino("turno", "turnos"),
    agenda: termino("agenda", "agendas"),
    responsable: termino("responsable", "responsables"),
  };
}
