## Phat Loot

You are a web development expert. You are designing a new web application. This
document explains the requirements that must be adhered to.

## Architecture & Design

* The app is authored in TypeScript and runs on Bun, using its built-ins where
  they fit: bun:sqlite (through Drizzle) and bun:test.

* The frontend is a React SPA bundled by Bun.serve HTML imports. It talks to
  a JSON API under `/api`. Input is validated with zod schemas shared by the
  client and server (`src/shared`).

* Use a SQL abstraction layer for local storage. For now, we'll use SQLite in
  test and prod, but we might switch to another database later. Migrations
  live in `drizzle/` and are applied on startup.

* Money is stored as integers in the campaign's minor unit, never as floats.

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
  amount of content in it; it is made wider first. Modals are never full width:
  they are only as wide as their content needs.

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

* When I ask for a new feature or a change to a feature, update this document
  accordingly. Make sure no line exceeds 80 characters when editing.

## Terms

We define the following terms:

### GM

An authenticated app user with elevated permissions.

### Character

A virtual character in a game world. A character belongs to one campaign.

### Player

An app user invited by a code. The code ties the user to one character.

### Campaign

A campaign belongs to one GM and has zero or more sessions. Campaigns have
names, start dates, optional background images, and zero or more characters.

### Session

A single instance of game play, typically a few hours long. A session belongs to
a campaign and has a date.

### Loot Pool

The pile of loot thus far accumulated for a campaign. Items will be frequently
added (acquired through gameplay) and removed (claimed by a player or sold.)

### Loot Split

The pile of loot is sold and the proceeds are split amongst the characters.

## Features

We are building an app to track loot in table-top role playing games. We'll
allow the GM to establish what loot has become available, and we'll allow the
players to claim or sell the loot. The app will track the value of the loot,
the size of the share that each player gets when selling based on what items
they have claimed from the pool.

* GMs are created by a CLI tool. GMs login with a userid and password. 

* GMs can view, create, edit, and delete their own campaigns.

* Each campaign sets its currency: a label (e.g. "gp") and 0 to 3 decimal
  places. The decimal places are locked once the campaign has any loot.

* A campaign's background image is uploaded to local disk (PNG, JPEG or WebP,
  up to 5 MB, checked by content rather than by the type the browser claims).

* GMs can add zero or more characters to a campaign. Each character has a name
  (required, unique within the campaign regardless of case) and a number of
  shares (required, a whole number of at least 1, default 1.) Characters
  get a default join code which can be given to players. Once used, the code is
  invalidated. If the player misplaces the code, the GM can create a new one.
  Whoever redeems the new code takes the character over.

* A character who has taken part in a loot split can't be deleted, so split
  history stays intact. Deleting any other character returns their claims to
  the pool.

* Players can provide a code to take ownership of one character in one campaign.
  This session does not expire. One browser can hold several characters, with
  a picker to switch between them, and can choose to forget a character.

* Players see the whole campaign: every loot item, every character's shares
  and projected payout, and the split history. Join codes are GM-only.

* The GM can view, create, edit, and delete sessions in their campaigns.

* The GM can view, create, edit, and delete loot in a session. Each loot entry
  includes session (required), name (required, not unique), description
  (optional), link (optional, http or https only), quantity (required,
  default 1), value (optional), market percentage (default 50% because we
  only get half value when we sell) and status.

* When a loot item has a link, its name in the loot table links to it, in a
  new tab, for the GM and players alike.

* Statuses are as follows:
    * active: In the loot pool and available to be claimed. Will be sold
              during a loot split. The default for new items.
    * party: In the loot pool and reserved as party fund. Will not be sold
             during a loot split.
    * sold: Sold, no longer in the loot pool. Kept for historical purposes.
    * left: Dropped, left behind, or never picked up. Informational only.
    * claimed: Still in the loot pool but claimed by a character. This item's
               value will be deducted from the claiming player's split.
    * bought: Purchased by a character, no longer in the loot pool.

* Each loot row should calculate a subtotal of quantity times value, further
  adjusted for market percentage.

* For each campaign, keep a running total of the value of the loot pool. Keep
  track of each character's share of the value.

* Allow players to claim pieces of active loot for their character. Claimed
  pieces reduce the character's share accordingly. Once a piece has been
  claimed, it can not be claimed by another character. If a line has more than
  one quantity, ask the player how many they want to claim, and then split as
  appropriate.

* Players can release their own claims back to the pool. A released part of
  a stack merges back into the matching active row from the same session.

* Players can only set status to claimed. This also associates their character
  with the item.

* Only the GM can set statuses besides claimed.

* The GM can, at any time, perform a loot split. This represents selling off
  loot acquired since the last loot split. When a loot split happens:
    * Add the value of all active items plus all claimed items.
    * Allocate this total across all characters, accounting for the number of
      shares each has.
    * Subtract the value of each player's claimed items from their share.
    * Report each player's split value. This is how much they earn from the
      sale. It can be negative when their claims are worth more than their
      share.
    * Update each claimed item to bought. Update each active item to sold.

* Claimed items are valued at their market-adjusted subtotal, the same figure
  that goes into the total. Shares are rounded to whole minor units, and any
  leftover units go to the largest remainders so the payouts add up to the
  total exactly.

* The GM sees a preview of the split before running it. Every split is kept
  in a history showing each character's share, claims and payout.

## Development

* `bun run dev` starts the server with hot reload on port 3000. Browser HMR
  is off (it breaks daisyUI CSS), so refresh the page after client changes.
* `bun run gm create|passwd <username>` and `bun run gm list` manage GMs.
* `bun test` runs the unit, API and UI-rule tests; `bun run typecheck` runs
  tsc.
* `bun run db:generate` writes a migration after a schema change.
* `DB_PATH`, `UPLOAD_DIR`, `PORT`, `LOG_LEVEL` and `NODE_ENV` configure the
  server. Data defaults to `data/`, which is not committed.

## Conclusion

Ask me about design decisions or for any additional details you may need. If I
provide answers, update this document accordingly.
