import type { BadgeVariant } from "../../design-system/Badge";
import type { VoucherStatus } from "./types";

// Los topes de la regla del cupón (configDeCuponSchema del backend), que el
// alta manual reusa. El backend es quien los hace cumplir; acá solo limitan
// los inputs.
export const MAX_LABEL_LENGTH = 200;
export const MAX_EXPIRES_IN_DAYS = 365;

export const VOUCHER_STATUS_LABEL: Record<VoucherStatus, string> = {
  ACTIVE: "Vigente",
  CONSUMED: "Canjeado",
  EXPIRED: "Vencido",
};

export const VOUCHER_STATUS_VARIANT: Record<VoucherStatus, BadgeVariant> = {
  ACTIVE: "success",
  CONSUMED: "neutral",
  EXPIRED: "danger",
};
