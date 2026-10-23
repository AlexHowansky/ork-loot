import { STATUS_LABEL, type LootStatus } from "../../shared/status.ts";

const COLOR: Record<LootStatus, string> = {
  available: "badge-success",
  party: "badge-info",
  claimed: "badge-warning",
  bought: "badge-neutral",
  sold: "badge-ghost",
  abandoned: "badge-ghost",
};

export function StatusBadge({ status }: { status: LootStatus }) {
  return (
    <span className={`badge badge-sm badge-soft whitespace-nowrap ${COLOR[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}
