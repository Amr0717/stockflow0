import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

describe("supabase/setup.sql", () => {
  it("contains every migration, in order (run npm run build:setup-sql if this fails)", () => {
    const setup = readFileSync(path.join(root, "supabase/setup.sql"), "utf8").replace(/\r\n/g, "\n");
    const dir = path.join(root, "supabase/migrations");
    let from = 0;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      const body = readFileSync(path.join(dir, file), "utf8").replace(/\r\n/g, "\n").trimEnd();
      const at = setup.indexOf(body, from);
      expect(at, file).toBeGreaterThanOrEqual(from);
      from = at + body.length;
    }
  });
});
