# Phat Loot

A web app for tracking loot in tabletop role-playing games. The GM records
the loot the party finds, session by session. Players claim the pieces they
want, and when the party sells off the rest, the app splits the proceeds by
shares, taking each character's claims out of what they're owed.

## Features

* GM accounts, with campaigns, sessions, characters and loot.
* Players join with a one-time code that ties them to one character. No
  account or password is needed, and one browser can hold several characters.
* Players claim available loot, including part of a stack, and can release their
  claims. The GM can claim or release on a character's behalf.
* Split preview and history. Each character's share, claims and payout are
  shown, and any remainder that doesn't divide evenly goes to petty cash.
* Each campaign has its own currency label and decimal places. Amounts are
  stored as integers, so there are no rounding errors.
* Optional campaign background images.

The full specification is in [SPEC.md](SPEC.md), and the architecture and
conventions are in [CLAUDE.md](CLAUDE.md).

## Stack

[Bun](https://bun.sh), TypeScript, React, TanStack Query, React Router,
Drizzle ORM on SQLite, zod, Tailwind CSS with daisyUI, and Font Awesome.

## Getting started

You'll need [Bun](https://bun.sh) installed.

```sh
bun install
bun run gm create <email>      # create a GM account
bun run dev                    # http://localhost:3000
```

Database migrations are applied automatically on startup. Browser hot module
reloading is off, so refresh the page after changing client code.

## Scripts

| Command                         | Purpose                                  |
| ------------------------------- | ---------------------------------------- |
| `bun run dev`                   | Start the server with hot reload         |
| `bun run start`                 | Start the server in production mode      |
| `bun run gm create <email>`     | Create a GM account                      |
| `bun run gm passwd <email>`     | Change a GM's password                   |
| `bun run gm list`               | List GM accounts                         |
| `bun test`                      | Run the unit, API and UI-rule tests      |
| `bun run typecheck`             | Type-check with tsc                      |
| `bun run db:generate`           | Generate a migration after a schema change |

The `gm` commands prompt for a password. Set `GM_PASSWORD` to supply it
without a prompt.

## Configuration

The server reads these environment variables:

| Variable         | Default          | Purpose                                    |
| ---------------- | ---------------- | ------------------------------------------ |
| `PORT`           | `3000`           | HTTP port                                  |
| `DB_PATH`        | `data/app.db`    | SQLite database file                       |
| `UPLOAD_DIR`     | `data/uploads`   | Where campaign images are stored           |
| `LOG_LEVEL`      | `info`           | Logging verbosity                          |
| `NODE_ENV`       |                  | `production` turns on secure cookies and JSON logs |
| `SECURE_COOKIES` |                  | Set to `1` for secure cookies outside production |

The `data/` directory is not committed.

## Project layout

```
src/client/   React SPA (pages, components, API client)
src/server/   Bun.serve app, routes, domain logic, database
src/shared/   zod schemas, types and money helpers shared by both sides
src/cli/      GM account management
drizzle/      SQL migrations
test/         bun:test suites
```

## License

[MIT](LICENSE)
