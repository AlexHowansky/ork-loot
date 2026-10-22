import { formatMoney } from "../../shared/money.ts";
import type { CampaignInfo } from "../../shared/types.ts";

export function Money({
  amount,
  campaign,
  className = "",
}: {
  amount: number;
  campaign: Pick<CampaignInfo, "currencyDecimals" | "currencyLabel">;
  className?: string;
}) {
  return (
    <span className={`tabular-nums whitespace-nowrap ${amount < 0 ? "text-error" : ""} ${className}`}>
      {formatMoney(amount, campaign.currencyDecimals, campaign.currencyLabel)}
    </span>
  );
}
