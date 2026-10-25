import { useToast } from "./Toast.tsx";
import { Icon, faCircleCheck, faCopy, faWifi } from "./Icon.tsx";

const pretty = (code: string) => `${code.slice(0, 5)}-${code.slice(5)}`;

/**
 * The GM's view of a character's or observer's seat: its unused join code
 * with a copy button, or whether a player has taken it and is online.
 */
export function JoinCodeStatus({
  name,
  joinCode,
  hasPlayer,
  online,
  onlineTitle,
}: {
  name: string;
  joinCode?: string | null;
  hasPlayer?: boolean;
  online?: boolean;
  /** Says who has the campaign open, for the Online pill's title. */
  onlineTitle: string;
}) {
  const toast = useToast();

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(pretty(code));
      toast("Code copied.");
    } catch {
      toast("Couldn't copy automatically. Select the code and copy it instead.", "error");
    }
  }

  if (joinCode) {
    return (
      <span className="inline-flex items-center gap-1">
        <code className="font-mono tracking-wider select-all">{pretty(joinCode)}</code>
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-square"
          aria-label={`Copy ${name}'s join code`}
          onClick={() => copy(joinCode)}
        >
          <Icon icon={faCopy} />
        </button>
      </span>
    );
  }
  if (hasPlayer) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="badge badge-sm badge-success badge-soft">
          <Icon icon={faCircleCheck} /> Joined
        </span>
        {online && (
          <span className="badge badge-sm badge-info badge-soft" title={onlineTitle}>
            <Icon icon={faWifi} /> Online
          </span>
        )}
      </span>
    );
  }
  return <span className="text-base-content/60 text-sm">No code</span>;
}
