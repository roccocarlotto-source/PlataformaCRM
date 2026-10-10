import { useAuth, type TerminoDelVocabulario, type Vocabulario } from "../../auth/AuthContext";

// El vocabulario del rubro para las pantallas de clínica (docs/rubros.md §3):
// lo arma el backend y llega en /api/me. Si un backend anterior no lo manda,
// estas pantallas (que solo ve una clínica) usan los textos de clínica de
// src/clinicas/config/rubro.ts.

function termino(singular: string, plural: string): TerminoDelVocabulario {
  const titulo = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);
  return { singular, plural, singularTitulo: titulo(singular), pluralTitulo: titulo(plural) };
}

export const VOCABULARIO_DE_CLINICA_POR_DEFECTO: Vocabulario = {
  marca: "Plataforma CRM",
  contacto: termino("paciente", "pacientes"),
  recurso: termino("profesional", "profesionales"),
  tipoDeServicio: termino("prestación", "prestaciones"),
  reserva: termino("turno", "turnos"),
  agenda: termino("agenda", "agendas"),
  responsable: termino("responsable", "responsables"),
};

export function useVocabularioDeClinica(): Vocabulario {
  const { me } = useAuth();
  return me?.vocabulario ?? VOCABULARIO_DE_CLINICA_POR_DEFECTO;
}
