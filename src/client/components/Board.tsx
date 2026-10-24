import { useState, type ReactNode } from "react";
import type { CampaignView } from "../../shared/types.ts";
import { Money } from "./Money.tsx";
import { LootTable, type StatusFilter } from "./LootTable.tsx";
import { CharacterTable } from "./CharacterTable.tsx";
import { SessionTable } from "./SessionTable.tsx";
import { SplitHistory } from "./SplitHistory.tsx";
import { PettyCashLedger } from "./PettyCashLedger.tsx";
import { formatMoney } from "../../shared/money.ts";
import { Icon, faCalendarDays } from "./Icon.tsx";

export type Mode = { kind: "gm" } | { kind: "player"; characterId: string };

type Tab = "loot" | "sessions" | "splits" | "characters" | "pettyCash";

/** The campaign's header, totals and tabs, for both GMs and players. */
export function CampaignBoard({
  view,
  mode,
  actions,
}: {
  view: CampaignView;
  mode: Mode;
  /** Buttons for the header, e.g. edit or split. */
  actions?: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("loot");
  const [sessionFilter, setSessionFilter] = useState<number | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pool");
  const [search, setSearch] = useState("");
  const { campaign, pool } = view;
  const me = mode.kind === "player" ? view.characters.find((c) => c.id === mode.characterId) : undefined;
  // Petty cash above its hold joins the split; a shortfall is kept back.
  const toSplit = pool.sellable + pool.pettyCashIn;
  const perShare = pool.totalShares ? Math.floor(toSplit / pool.totalShares) : 0;

  const tabs: [Tab, string, number?][] = [
    ["loot", "Loot", view.loot.length],
    ["pettyCash", "Petty cash", view.pettyCash.length],
    ["sessions", "Sessions", view.sessions.length],
    ["characters", "Characters", view.characters.length],
    ["splits", "Splits", view.splits.length],
  ];

  return (
    <div className="mx-auto max-w-7xl min-w-min">
      <section className="relative mb-3 rounded-box bg-neutral text-neutral-content shadow">
        {campaign.backgroundImage && (
          <div className="absolute inset-0 overflow-hidden rounded-box">
            <img src={`/uploads/${campaign.backgroundImage}`} alt="" className="h-full w-full object-cover" />
          </div>
        )}
        <div className="relative flex flex-col gap-3 rounded-box bg-linear-to-r from-neutral/90 via-neutral/70 to-neutral/30 p-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            {me && <p className="text-sm opacity-80">Playing {me.name}</p>}
            <h1 className="text-2xl font-bold sm:text-3xl">{campaign.name}</h1>
            <p className="text-sm opacity-80">
              <Icon icon={faCalendarDays} /> Started {campaign.startDate}
            </p>
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      </section>

      <div className="stats mb-3 w-full grid-flow-row grid-cols-2 bg-base-100 shadow md:grid-cols-3 lg:grid-flow-col lg:grid-cols-none">
        <Stat
          title="Pool to split"
          value={<Money amount={toSplit} campaign={campaign} />}
          desc={
            pool.pettyCashIn > 0
              ? "Available and claimed, plus spare petty cash"
              : pool.pettyCashIn < 0
                ? "Available and claimed, less the petty cash top-up"
                : "Available and claimed"
          }
        />
        <Stat
          title="Per share"
          value={<Money amount={perShare} campaign={campaign} />}
          desc={`${pool.totalShares} ${pool.totalShares === 1 ? "share" : "shares"} in total`}
        />
        <Stat title="Claimed" value={<Money amount={pool.claimed} campaign={campaign} />} desc="Deducted from claimants" />
        <Stat title="Party fund" value={<Money amount={pool.party} campaign={campaign} />} desc="Kept, not sold" />
        <Stat
          title="Petty cash"
          value={<Money amount={campaign.pettyCash} campaign={campaign} />}
          desc={
            campaign.pettyCashHold > 0
              ? `Holding ${formatMoney(campaign.pettyCashHold, campaign.currencyDecimals, campaign.currencyLabel)} for shared costs`
              : "Paid out in the next split"
          }
        />
        {me && (
          <Stat
            title="Your payout now"
            value={<Money amount={me.net} campaign={campaign} />}
            desc={`Share ${me.shares} × per share, less claims${me.debt > 0 ? " and debt" : ""}`}
          />
        )}
        {me && me.debt > 0 && (
          <Stat
            title="Your debt"
            value={<Money amount={me.debt} campaign={campaign} />}
            desc="Taken off your next payouts"
          />
        )}
      </div>

      <div>
        <div role="tablist" className="tabs tabs-lift tabs-sm sm:tabs-md">
          {tabs.map(([key, label, count]) => (
            <button
              key={key}
              id={`board-tab-${key}`}
              type="button"
              role="tab"
              aria-selected={tab === key}
              aria-controls="board-panel"
              className={`tab gap-2 ${tab === key ? "tab-active" : ""}`}
              onClick={() => setTab(key)}
            >
              {label}
              <span className="badge badge-sm badge-ghost hidden sm:inline-flex">{count}</span>
            </button>
          ))}
          {/* An empty tab carries the baseline on to the right-hand edge. */}
          <div className="tab" aria-hidden="true" />
        </div>
        <div
          id="board-panel"
          role="tabpanel"
          aria-labelledby={`board-tab-${tab}`}
          className="rounded-b-box border border-t-0 border-base-300 bg-base-100 p-3 shadow"
        >
          {tab === "loot" && (
            <LootTable
              view={view}
              mode={mode}
              sessionFilter={sessionFilter}
              onSessionFilter={setSessionFilter}
              statusFilter={statusFilter}
              onStatusFilter={setStatusFilter}
              search={search}
              onSearch={setSearch}
            />
          )}
          {tab === "characters" && <CharacterTable view={view} mode={mode} />}
          {tab === "sessions" && (
            <SessionTable
              view={view}
              mode={mode}
              onShowLoot={(id) => {
                setSessionFilter(id);
                setStatusFilter("all");
                setSearch("");
                setTab("loot");
              }}
            />
          )}
          {tab === "splits" && <SplitHistory view={view} mode={mode} />}
          {tab === "pettyCash" && <PettyCashLedger view={view} mode={mode} />}
        </div>
      </div>
    </div>
  );
}

function Stat({ title, value, desc }: { title: string; value: ReactNode; desc: string }) {
  return (
    <div className="stat place-items-center px-4 py-2 text-center">
      <div className="stat-title">{title}</div>
      <div className="stat-value text-2xl">{value}</div>
      <div className="stat-desc whitespace-normal">{desc}</div>
    </div>
  );
}
