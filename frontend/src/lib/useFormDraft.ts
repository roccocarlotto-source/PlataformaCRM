import { useState } from "react";

// ---------------------------------------------------------------------------
// Estado de un formulario que se SIEMBRA desde una query y después se edita.
//
// Reemplaza al patrón que tenían las seis páginas de formulario:
//
//     const [values, setValues] = useState(EMPTY_FORM);
//     useEffect(() => {
//       if (isEditMode && query.data) setValues({ ...query.data });
//     }, [isEditMode, query.data]);
//
// Ese efecto no era solo ruido de lint (react-hooks/set-state-in-effect):
// PERDÍA DATOS. El QueryClient corre con refetchOnWindowFocus: true y
// staleTime de 30s (lib/queryClient.ts), así que alcanzaba con que alguien
// editara el mismo registro del otro lado mientras vos escribías: al volver a
// la pestaña, el refetch traía un objeto nuevo, el efecto se disparaba y
// setValues pisaba todo lo tipeado, sin aviso. Reproducido con un test antes
// de tocar nada, no deducido.
//
// LA FORMA DE ARREGLARLO NO PODÍA SER MOVER EL setState A OTRO LADO. Sacarlo
// del efecto y hacerlo en render cambia set-state-in-effect por
// set-state-in-render, que el mismo preset también prende como error — y con
// razón, porque el problema nunca fue DÓNDE ocurría la escritura sino que
// ocurriera una segunda vez.
//
// Acá los valores se DERIVAN de la query mientras nadie los tocó, y el estado
// local aparece recién con la primera edición. No hay una segunda escritura
// que pise nada: un refetch del mismo registro deja el borrador intacto.
//
// EL BORRADOR ESTÁ ATADO A UNA CLAVE DE REGISTRO, y esa es la parte que no es
// obvia. React Router NO remonta el componente al ir de /companies/c1/edit a
// /companies/c2/edit —es la misma ruta—, así que un borrador suelto se
// arrastraría de un registro al siguiente y mostraría los cambios de c1
// encima de c2. Guardando junto al borrador el id para el que se escribió, un
// registro distinto simplemente no matchea y se vuelve a derivar. Es lo mismo
// que lograría un `key` en el router, pero sin depender de que el router
// remonte ni de tocar una configuración compartida por doce rutas.
// ---------------------------------------------------------------------------

export type FormDraftSetter<T> = (next: T | ((current: T) => T)) => void;

export function useFormDraft<T>(
  // id del registro que se está editando; undefined en modo creación.
  recordId: string | undefined,
  // Valores derivados de la query. En creación, el formulario vacío.
  derived: T,
): [T, FormDraftSetter<T>] {
  const [draft, setDraft] = useState<{ key: string; values: T } | null>(null);

  // "new" como centinela de creación: no colisiona con un uuid, y hace que un
  // formulario de alta conserve su borrador entre renders igual que uno de
  // edición.
  const key = recordId ?? "new";
  const values = draft !== null && draft.key === key ? draft.values : derived;

  const setValues: FormDraftSetter<T> = (next) => {
    setDraft({
      key,
      // Se acepta la forma updater porque OpportunityFormPage la usa para
      // limpiar stageId al cambiar de pipeline. `values` de arriba ya es el
      // valor vigente —borrador si existe, derivado si no—, así que el updater
      // recibe lo mismo que recibiría de un useState normal.
      values: typeof next === "function" ? (next as (current: T) => T)(values) : next,
    });
  };

  return [values, setValues];
}
