import { useOrganizationSettings } from "../organization/queries";

/** La moneda que usa el backend cuando no viene ninguna: la de preferencia de
 *  la organización y, si no configuró, USD (la misma que el dashboard).
 *  `undefined` mientras carga la configuración. */
export function useMonedaPorDefecto(): string | undefined {
  const settings = useOrganizationSettings();
  if (!settings.isSuccess) return undefined;
  return settings.data.preferredCurrency ?? "USD";
}
