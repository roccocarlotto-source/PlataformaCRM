import { useConfiguracionDelTaller } from "./queries";

/** La moneda que usa el backend cuando no viene ninguna: la del taller
 *  (Taller → Configuración, UYU por defecto; #12). Antes era la de preferencia
 *  de la organización, que en una automotora es la de las ventas.
 *  `undefined` mientras carga la configuración. */
export function useMonedaPorDefecto(): string | undefined {
  const configuracion = useConfiguracionDelTaller();
  if (!configuracion.isSuccess) return undefined;
  return configuracion.data.currency;
}
