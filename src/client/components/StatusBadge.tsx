import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { LOOT_STATUSES, STATUS_DESCRIPTION, STATUS_LABEL, type LootStatus } from "../../shared/status.ts";
import {
  faChevronDown,
  faHand,
  faPeopleGroup,
  faSackDollar,
  faTag,
  faTrashCan,
  faUser,
  Icon,
} from "./Icon.tsx";
import { Menu } from "./Menu.tsx";

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

const PILL = "badge badge-sm badge-soft gap-1 ps-1.5 whitespace-nowrap";

export function StatusBadge({ status, tip = "left" }: { status: LootStatus; tip?: keyof typeof TIP_SIDE }) {
  return (
    <span className={`tooltip ${TIP_SIDE[tip]}`} data-tip={STATUS_DESCRIPTION[status]}>
      <span
        className={`${PILL} ${COLOR[status]}`}
        aria-description={STATUS_DESCRIPTION[status]}
      >
        <Icon icon={ICON[status]} />
        {STATUS_LABEL[status]}
      </span>
    </span>
  );
}

/**
 * A status pill that opens a menu of the other statuses, for the GM to
 * change an item's status in place. Statuses in `unavailable` are shown
 * but can't be chosen.
 */
export function StatusMenu({
  status,
  itemName,
  onChoose,
  unavailable = [],
  tip = "left",
}: {
  status: LootStatus;
  itemName: string;
  onChoose: (status: LootStatus) => void;
  unavailable?: readonly LootStatus[];
  tip?: keyof typeof TIP_SIDE;
}) {
  return (
    <Menu
      align={tip === "left" ? "end" : "start"}
      ariaLabel={`Status of ${itemName}: ${STATUS_LABEL[status]}. Change status`}
      buttonClass={`${PILL} ${COLOR[status]} cursor-pointer hover:brightness-90`}
      menuClass="w-40 font-normal"
      label={
        // The tooltip sits inside the pill so it doesn't cover the open menu.
        <span className={`tooltip ${TIP_SIDE[tip]} inline-flex items-center gap-1`} data-tip={STATUS_DESCRIPTION[status]}>
          <Icon icon={ICON[status]} />
          {STATUS_LABEL[status]}
          <Icon icon={faChevronDown} className="text-[0.6rem] opacity-70" />
        </span>
      }
    >
      {LOOT_STATUSES.filter((s) => s !== status).map((s) => (
        <li key={s} className={unavailable.includes(s) ? "menu-disabled" : ""}>
          <button
            type="button"
            disabled={unavailable.includes(s)}
            aria-description={STATUS_DESCRIPTION[s]}
            onClick={() => onChoose(s)}
          >
            <Icon icon={ICON[s]} />
            {STATUS_LABEL[s]}
          </button>
        </li>
      ))}
    </Menu>
  );
}
