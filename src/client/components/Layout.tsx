import { useState } from "react";
import { Link, Outlet, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../api.ts";
import { useMe } from "../queries.ts";
import { applyTheme, storedTheme, type ThemeChoice } from "../theme.ts";
import { useToast } from "./Toast.tsx";
import { Menu } from "./Menu.tsx";
import {
  Icon,
  faArrowRightFromBracket,
  faCircleHalfStroke,
  faDragon,
  faKey,
  faMoon,
  faSun,
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

export function Layout() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

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
          {me && me.characters.length > 0 && (
            <Menu
              buttonClass="btn btn-ghost btn-sm"
              menuClass="w-64"
              label={
                <>
                  <Icon icon={faUser} /> <span className="hidden sm:inline">Characters</span>
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
              <span className="hidden sm:inline">Sign out {me.gm.username}</span>
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

