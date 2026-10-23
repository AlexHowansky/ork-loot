import { STATUS_DESCRIPTION, STATUS_LABEL, type LootStatus } from "../../shared/status.ts";

const COLOR: Record<LootStatus, string> = {
  available: "badge-success",
  party: "badge-info",
  claimed: "badge-warning",
  bought: "badge-neutral",
  sold: "badge-ghost",
  abandoned: "badge-ghost",
};

/** Which side the description tooltip opens on, so it stays inside the table. */
const TIP_SIDE = {
  left: "tooltip-left",
  right: "tooltip-right",
} as const;

export function StatusBadge({ status, tip = "left" }: { status: LootStatus; tip?: keyof typeof TIP_SIDE }) {
  return (
    <span className={`tooltip ${TIP_SIDE[tip]}`} data-tip={STATUS_DESCRIPTION[status]}>
      <span
        className={`badge badge-sm badge-soft whitespace-nowrap ${COLOR[status]}`}
        aria-description={STATUS_DESCRIPTION[status]}
      >
        {STATUS_LABEL[status]}
      </span>
    </span>
  );
}
