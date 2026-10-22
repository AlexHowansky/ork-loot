/**
 * GM account management.
 *
 *   bun run gm create <username>
 *   bun run gm passwd <username>
 *   bun run gm list
 */
import { join } from "node:path";
import { asc, eq } from "drizzle-orm";
import { openDb } from "../server/db/client.ts";
import { gm, login } from "../server/db/schema.ts";
import { hashPassword } from "../server/lib/auth.ts";

const root = join(import.meta.dir, "../..");
const db = openDb(process.env.DB_PATH ?? join(root, "data/app.db"));

const MIN_PASSWORD = 10;

/** Input received beyond the current line, kept for the next prompt. */
let pending = "";

/**
 * Reads a line from the terminal without echoing it. Uses data listeners
 * rather than `for await`, because leaving that loop early destroys stdin
 * and breaks any later prompt.
 */
function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  const tty = stdin.isTTY;
  process.stdout.write(question);
  return new Promise((resolve) => {
    let input = "";
    const finish = () => {
      stdin.off("data", onData);
      stdin.off("end", finish);
      if (tty) stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
      resolve(input);
    };
    const consume = (text: string) => {
      for (let i = 0; i < text.length; i++) {
        const ch = text[i]!;
        if (ch === "\r" || ch === "\n") {
          // Treat \r\n as one line ending.
          const rest = text.slice(text[i + 1] === "\n" && ch === "\r" ? i + 2 : i + 1);
          pending = rest;
          finish();
          return true;
        }
        if (ch === "\u0003") {
          if (tty) stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") input = input.slice(0, -1);
        else input += ch;
      }
      return false;
    };
    const onData = (chunk: Buffer | string) => {
      consume(String(chunk));
    };
    const buffered = pending;
    pending = "";
    if (consume(buffered)) return;
    if (tty) stdin.setRawMode(true);
    stdin.on("data", onData);
    stdin.once("end", finish);
    stdin.resume();
  });
}

async function askPassword(): Promise<string> {
  const pw = process.env.GM_PASSWORD ?? (await promptHidden("Password: "));
  if (pw.length < MIN_PASSWORD) {
    fail(`Passwords must be at least ${MIN_PASSWORD} characters.`);
  }
  if (!process.env.GM_PASSWORD) {
    const again = await promptHidden("Repeat password: ");
    if (again !== pw) fail("The passwords didn't match.");
  }
  return pw;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const [command, username] = process.argv.slice(2);

switch (command) {
  case "create": {
    if (!username) fail("Usage: bun run gm create <username>");
    if (db.select().from(gm).where(eq(gm.username, username)).get()) {
      fail(`A GM called “${username}” already exists.`);
    }
    const passwordHash = await hashPassword(await askPassword());
    db.insert(gm).values({ username, passwordHash }).run();
    console.log(`Created GM “${username}”.`);
    break;
  }
  case "passwd": {
    if (!username) fail("Usage: bun run gm passwd <username>");
    const row = db.select().from(gm).where(eq(gm.username, username)).get();
    if (!row) fail(`There's no GM called “${username}”.`);
    const passwordHash = await hashPassword(await askPassword());
    db.update(gm).set({ passwordHash }).where(eq(gm.id, row.id)).run();
    // Sign out everywhere so the old password stops working immediately.
    db.delete(login).where(eq(login.gmId, row.id)).run();
    console.log(`Changed the password for “${username}”.`);
    break;
  }
  case "list": {
    const rows = db.select().from(gm).orderBy(asc(gm.username)).all();
    if (rows.length === 0) console.log("No GMs yet.");
    for (const r of rows) console.log(r.username);
    break;
  }
  default:
    fail("Usage: bun run gm create|passwd <username>, or bun run gm list");
}
