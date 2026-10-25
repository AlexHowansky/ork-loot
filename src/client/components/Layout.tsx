import { useState } from "react";
import { Link, Outlet, useMatch, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../api.ts";
import { useMe, usePlay } from "../queries.ts";
import { applyTheme, storedTheme, type ThemeChoice } from "../theme.ts";
import { useToast } from "./Toast.tsx";
import { Menu } from "./Menu.tsx";
import {
  Icon,
  faArrowRightFromBracket,
  faCircleHalfStroke,
  faDragon,
  faEye,
  faKey,
  faMoon,
  faSun,
  faTriangleExclamation,
  faUser,
} from "./Icon.tsx";

const NEXT_THEME: Record<ThemeChoice, ThemeChoice> = { auto: "light", light: "dark", dark: "auto" };
const THEME_ICON = { auto: faCircleHalfStroke, light: faSun, dark: faMoon };
const THEME_LABEL = { auto: "Theme: system", light: "Theme: light", dark: "Theme: dark" };

function ThemeButton() {
  const [theme, setTheme] = useState(storedTheme);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm btn-square tooltip tooltip-bottom"
      data-tip={THEME_LABEL[theme]}
      aria-label={THEME_LABEL[theme]}
      onClick={() => {
        const next = NEXT_THEME[theme];
        applyTheme(next);
        setTheme(next);
      }}
    >
      <Icon icon={THEME_ICON[theme]} />
    </button>
  );
}

/**
 * Warns a player whose projected payout is negative in a campaign without
 * debt, since the GM can't run a split until it's positive again. It reads
 * the play view the page itself has already loaded.
 */
function DebtWarning({ characterId }: { characterId: string }) {
  const { data: view } = usePlay(characterId);
  const me = view?.characters.find((c) => c.id === view.me.id);
  if (!view || view.campaign.allowDebt || !me || me.net >= 0) return null;
  const message =
    "Debt is not allowed in this campaign, so the GM will be unable to " +
    "perform a loot split until your payout is positive.";
  return (
    <span className="tooltip tooltip-bottom tooltip-error">
      <span className="tooltip-content w-64 text-left">{message}</span>
      <button type="button" className="btn btn-ghost btn-sm btn-square text-error" aria-label={message}>
        <Icon icon={faTriangleExclamation} />
      </button>
    </span>
  );
}

export function Layout() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const playing = useMatch("/play/:id")?.params.id;

  async function logout() {
    try {
      await api.post("/api/auth/logout");
      qc.clear();
      navigate("/");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  return (
    <div className="min-h-screen bg-base-200">
      <header className="navbar bg-base-100 shadow-sm min-h-12 px-3 py-1">
        <div className="navbar-start">
          <Link to="/" className="btn btn-ghost btn-sm text-lg font-bold">
            <Icon icon={faDragon} className="text-primary" /> Phat Loot
          </Link>
        </div>
        <div className="navbar-end gap-1">
          {playing && <DebtWarning characterId={playing} />}
          {me && me.characters.length + me.observers.length > 0 && (
            <Menu
              buttonClass="btn btn-ghost btn-sm"
              menuClass="w-64"
              label={
                <>
                  <Icon icon={faUser} />{" "}
                  <span className="hidden sm:inline">{me.characters.length > 0 ? "Characters" : "Campaigns"}</span>
                </>
              }
            >
              {me.characters.map((c) => (
                <li key={c.id}>
                  <Link to={`/play/${c.id}`}>
                    <span className="font-medium">{c.name}</span>
                    <span className="text-base-content/60 text-xs">{c.campaignName}</span>
                  </Link>
                </li>
              ))}
              {me.observers.map((o) => (
                <li key={o.id}>
                  <Link to={`/watch/${o.id}`}>
                    <span className="font-medium">
                      <Icon icon={faEye} /> {o.campaignName}
                    </span>
                    <span className="text-base-content/60 text-xs">Observing</span>
                  </Link>
                </li>
              ))}
              <li>
                <Link to="/join">
                  <Icon icon={faKey} /> Enter another code
                </Link>
              </li>
            </Menu>
          )}
          <ThemeButton />
          {me?.gm ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
              <Icon icon={faArrowRightFromBracket} />
              <span className="hidden sm:inline">Sign out {me.gm.email}</span>
            </button>
          ) : (
            <Link to="/login" className="btn btn-ghost btn-sm">
              GM sign in
            </Link>
          )}
        </div>
      </header>
      <main className="p-3 sm:p-4">
        <Outlet />
      </main>
    </div>
  );
}

export function Loading() {
  return (
    <div className="flex justify-center p-10">
      <span className="loading loading-spinner loading-lg" aria-label="Loading" />
    </div>
  );
}

export function LoadError({ error }: { error: unknown }) {
  return (
    <div role="alert" className="alert alert-error alert-soft mx-auto max-w-lg">
      <span>{errorMessage(error)}</span>
    </div>
  );
}

