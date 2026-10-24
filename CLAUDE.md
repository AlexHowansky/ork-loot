## Phat Loot

You are a web development expert. You are designing a new web application. This
document explains the requirements that must be adhered to.

The product specification (terms and features) is in @SPEC.md.

## Architecture & Design

* The app is authored in TypeScript and runs on Bun, using its built-ins where
  they fit: bun:sqlite (through Drizzle) and bun:test.

* The frontend is a React SPA bundled by Bun.serve HTML imports. It talks to
  a JSON API under `/api`. Input is validated with zod schemas shared by the
  client and server (`src/shared`).

* Open campaign pages stay in sync through Server-Sent Events, never
  client-side polling. Every handler that changes a campaign calls
  `ctx.changed(campaignId)`; once the request succeeds, the in-process bus
  (`src/server/lib/events.ts`) tells that campaign's streams it changed.
  Events carry no campaign data, only the origin tab's `X-Client-Id`, and
  each browser refetches its own view. A handler may also pass a
  `LiveNotice` (`ctx.changed(campaignId, notice)`) naming only what every
  view already shows; other tabs show it as a toast. The bus also counts
  each player's open streams per character, which is what makes a
  character "Online"; changes to that reach only GM streams. The bus is
  in memory, so the server runs as a single process; more than one would
  need a shared bus.

* Email goes through `src/server/lib/mail.ts`: SMTP (nodemailer) when
  `SMTP_HOST` is set, otherwise the message is written to the log. SMTP is
  only ever spoken over verified TLS: implicit TLS on ports 465 and 2465,
  required STARTTLS on any other; a server that can't do it gets nothing,
  not even the login. Links in mail are built from `APP_URL`, never from
  the request's Host header. Password reset tokens travel in the URL
  fragment so they stay out of server logs and Referer headers.

* Use a SQL abstraction layer for local storage. For now, we'll use SQLite in
  test and prod, but we might switch to another database later. Migrations
  live in `drizzle/` and are applied on startup.

* Money is stored as integers in the campaign's minor unit, never as floats.

* GMs, campaigns and characters have random UUID ids, since those ids can
  appear in URLs and shouldn't be guessable by counting. Other tables keep
  integer ids; they're only reached through an owned campaign.

* Database tables should be named according to the singular form of a word, so
  prefer `user` over `users`.

* Use Tailwind for styling, with daisyUI on top of it for components and for
  colour. Every colour in the app should be one of daisyUI's semantic tokens —
  `base-100`, `base-content`, `primary`, `error` and their neighbours — resolved
  by whichever theme is active; nothing names a palette shade of its own, and
  nothing carries a hand-written dark-mode twin.

* Make good use of the screen, and avoid scrolling wherever it can be avoided. A
  page need not take the full width of the window: a panel whose content fits
  comfortably in less room may be narrower, sized by judgement to what it holds.
  But a panel that isn't full width never shows a scrollbar because of the
  amount of content in it; it is made wider first. No panel or table scrolls
  on its own: when content still doesn't fit, the panel grows and the window
  scrolls instead. Modals are never full width: they are only as wide as their
  content needs.

* Use Font Awesome v7 Free for icons.

* Confirmations and modal prompts should use the app's own dialog, using the
  active theme. `window.confirm` is never used, because the browser draws it
  in its own theme. The button that goes through with it names the action
  rather than saying "OK", so it still says what will happen when read on its
  own, and the question can be refused with Escape or the close control as
  well as with Cancel.

* Observe OWASP Top Ten guidelines.

* Observe best practices for modern web development.

* All error messages should be user-friendly.

* Implement consistent logging to aid debugging.

* Whenever dealing with file paths, always use the path relative to the project
  root, never the full path.

* Whenever making a change to the database schema, ask me if I want to make a
  migration or update the last migration. Many development changes won't ever
  make it to production so we can often skip full migrations.

* When I ask for a new feature or a change to a feature, update `SPEC.md`
  accordingly; changes to architecture or conventions go in this document.
  Make sure no line exceeds 80 characters when editing either one.

## Development

* `bun run dev` starts the server with hot reload on port 3000. Browser HMR
  is off (it breaks daisyUI CSS), so refresh the page after client changes.
* `bun run gm create|passwd <email>` and `bun run gm list` manage GMs.
* `bun test` runs the unit, API and UI-rule tests; `bun run typecheck` runs
  tsc.
* `bun run db:generate` writes a migration after a schema change.
* `DB_PATH`, `UPLOAD_DIR`, `PORT`, `LOG_LEVEL` and `NODE_ENV` configure the
  server. Data defaults to `data/`, which is not committed.
* `APP_URL` is the app's public address (default `http://localhost:PORT`).
  `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM`
  configure outgoing mail. Without `SMTP_HOST`, as in dev, password reset
  links appear in the server log.

## Conclusion

Ask me about design decisions or for any additional details you may need. If I
provide answers, update `SPEC.md` or this document accordingly.
