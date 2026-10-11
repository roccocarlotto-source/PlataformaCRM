import { useAuth, type Vocabulario } from "../../auth/AuthContext";
import { VOCABULARIO_DE_CLINICA_POR_DEFECTO } from "../../auth/vocabulario";

// El vocabulario del rubro para las pantallas de clínica (docs/rubros.md §3):
// lo arma el backend y llega en /api/me. Si un backend anterior no lo manda,
// estas pantallas (que solo ve una clínica) usan los textos de clínica de
// auth/vocabulario.ts.
export function useVocabularioDeClinica(): Vocabulario {
  const { me } = useAuth();
  return me?.vocabulario ?? VOCABULARIO_DE_CLINICA_POR_DEFECTO;
}
