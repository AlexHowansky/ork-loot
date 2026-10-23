import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { join, relative } from "node:path";

/** Enforces the CLAUDE.md UI rules over the client source. */
const root = join(import.meta.dir, "..");
const files = [...new Glob("src/client/**/*.{ts,tsx,css,html}").scanSync(root)];

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const rules: [string, RegExp][] = [
  ["palette colour shade", new RegExp(`\\b[a-z]+-(?:${PALETTE})-\\d{2,3}\\b`)],
  ["fixed black/white colour", /\b(?:bg|text|border|ring|fill|stroke)-(?:black|white)\b/],
  ["hand-written dark-mode variant", /\bdark:[a-z[!-]/],
  ["browser dialog", /\b(?:window\.)?(?:confirm|alert|prompt)\s*\(/],
  ["hex colour", /#[0-9a-fA-F]{3,8}\b(?![\w-])/],
  ["scrolling panel", /\boverflow-(?:[xy]-)?(?:auto|scroll)\b/],
];

describe("UI rules", () => {
  test("client files were found", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const [name, pattern] of rules) {
    test(`no ${name}`, async () => {
      const hits: string[] = [];
      for (const file of files) {
        const lines = (await Bun.file(join(root, file)).text()).split("\n");
        lines.forEach((line, i) => {
          if (pattern.test(line)) hits.push(`${relative(root, join(root, file))}:${i + 1}: ${line.trim()}`);
        });
      }
      expect(hits).toEqual([]);
    });
  }
});
