type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const configured = (process.env.LOG_LEVEL ?? "info").toLowerCase() as Level;
const threshold = ORDER[configured] ?? ORDER.info;
const json = process.env.NODE_ENV === "production";

type Fields = Record<string, unknown>;

function serialize(fields: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = v instanceof Error ? { message: v.message, stack: v.stack } : v;
  }
  return out;
}

function write(level: Level, msg: string, fields: Fields = {}) {
  if (ORDER[level] < threshold) return;
  const time = new Date().toISOString();
  const data = serialize(fields);
  const stream = level === "error" || level === "warn" ? console.error : console.log;
  if (json) {
    stream(JSON.stringify({ time, level, msg, ...data }));
    return;
  }
  const extras = Object.entries(data)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
  stream(`${time} ${level.toUpperCase().padEnd(5)} ${msg}${extras ? " " + extras : ""}`);
}

/**
 * Application logger. Never pass passwords, tokens or join codes in
 * `fields`.
 */
export const logger = {
  debug: (msg: string, fields?: Fields) => write("debug", msg, fields),
  info: (msg: string, fields?: Fields) => write("info", msg, fields),
  warn: (msg: string, fields?: Fields) => write("warn", msg, fields),
  error: (msg: string, fields?: Fields) => write("error", msg, fields),
};
