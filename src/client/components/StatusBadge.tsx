import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { STATUS_DESCRIPTION, STATUS_LABEL, type LootStatus } from "../../shared/status.ts";
import { faHand, faPeopleGroup, faSackDollar, faTag, faTrashCan, faUser, Icon } from "./Icon.tsx";

const COLOR: Record<LootStatus, string> = {
  available: "badge-success",
  party: "badge-info",
  claimed: "badge-warning",
  bought: "badge-neutral",
  sold: "badge-ghost",
  abandoned: "badge-ghost",
};

const ICON: Record<LootStatus, IconDefinition> = {
  available: faTag,
  party: faPeopleGroup,
  claimed: faHand,
  bought: faUser,
  sold: faSackDollar,
  abandoned: faTrashCan,
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
        className={`badge badge-sm badge-soft gap-1 ps-1.5 whitespace-nowrap ${COLOR[status]}`}
        aria-description={STATUS_DESCRIPTION[status]}
      >
        <Icon icon={ICON[status]} />
        {STATUS_LABEL[status]}
      </span>
    </span>
  );
}
