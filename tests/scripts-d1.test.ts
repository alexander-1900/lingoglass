// scripts/lib/d1.mjs — the wrangler argument shapes. Headless: runWrangler is
// never actually executed, we only inspect the command line it would build.
//
// This exists because of a real bug: r2Put/r2Get spelled the object path
// `{bucket}:{key}`, which wrangler 4.x no longer accepts — it split on the colon
// and reported "The bucket name \"lingoglasse-media:covers\" is invalid". The
// covers import failed on its first upload with a message that pointed at the
// bucket, not at the argument shape. Locking the shape down here means the next
// wrangler change fails a test instead of a production import.

import { afterEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("node:child_process", () => ({
  // d1.mjs builds ONE shell string and runs it through execSync.
  execSync: (command: string) => {
    calls.push(command);
    return "[]";
  },
}));

const { readBucketName, readDatabaseId, readDbName, r2Get, r2Put, sqlQuote } = await import(
  "../scripts/lib/d1.mjs"
);

/** The command line of the most recent runWrangler call. */
const last = () => calls[calls.length - 1] ?? "";

afterEach(() => {
  calls.length = 0;
});

describe("R2 object paths", () => {
  it("uses {bucket}/{key} — a colon makes wrangler reject the bucket name", () => {
    r2Put("lingoglasse-media", "covers/es/a1/06-x/abc.jpg", "C:/tmp/a.jpg", "--remote");
    expect(last()).toContain('"lingoglasse-media/covers/es/a1/06-x/abc.jpg"');
    // The whole point: wrangler splits on ':' and reads it as the bucket name.
    expect(last()).not.toContain("lingoglasse-media:");
  });

  it("downloads with the same {bucket}/{key} spelling", () => {
    r2Get("lingoglasse-media", "covers/ja/n5/01-neko/def.png", "C:/tmp/b.png", "--remote");
    expect(last()).toContain('"lingoglasse-media/covers/ja/n5/01-neko/def.png"');
  });

  it("forwards the scope so a --remote caller never silently hits local R2", () => {
    r2Put("lingoglasse-media", "covers/es/a1/06-x/abc.jpg", "C:/tmp/a.jpg", "--remote");
    expect(last()).toContain('"--remote"');
  });
});

describe("wrangler.jsonc readers", () => {
  const root = process.cwd();

  it("reads the bucket, database name and database id out of the JSONC", () => {
    expect(readBucketName(root)).toBe("lingoglasse-media");
    expect(readDbName(root, null)).toBe("lingoglasse-db");
    // The REST API wants the UUID, and readDatabaseId is what hands it over.
    expect(readDatabaseId(root)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("lets an explicit --db override win over wrangler.jsonc", () => {
    expect(readDbName(root, "some-other-db")).toBe("some-other-db");
  });
});

describe("sqlQuote", () => {
  it("doubles single quotes and rejects NUL bytes", () => {
    expect(sqlQuote("O'Brien")).toBe("'O''Brien'");
    expect(() => sqlQuote("a\0b")).toThrow(/NUL/);
  });
});
