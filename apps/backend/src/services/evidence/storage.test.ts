import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { LocalDiskStorage } from "./storage";
import { buildObjectKey, keyBelongsToCompany, matchesContentType } from "./service";

describe("local evidence storage", () => {
  it("creates a missing folder, stores a file, streams it back and removes it", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "cargo-ai-storage-"));
    const dir = path.join(base, "does", "not", "exist", "yet");
    try {
      const storage = new LocalDiskStorage(dir);
      assert.equal(fs.existsSync(dir), false);

      await storage.ensureDirectory();
      assert.equal(fs.existsSync(dir), true, "the folder is created when it is missing");

      await storage.put("company/site/2026/10/a.jpg", Buffer.from("hello"));
      assert.equal(await storage.exists("company/site/2026/10/a.jpg"), true);
      const file = await storage.stream("company/site/2026/10/a.jpg");
      assert.equal(file?.size, 5);
      const chunks: Buffer[] = [];
      for await (const chunk of file!.stream) chunks.push(Buffer.from(chunk));
      assert.equal(Buffer.concat(chunks).toString(), "hello");

      assert.equal(await storage.remove("company/site/2026/10/a.jpg"), true);
      assert.equal(await storage.exists("company/site/2026/10/a.jpg"), false);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("creates parent folders on its own when a file is stored first", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "cargo-ai-storage-"));
    try {
      const storage = new LocalDiskStorage(path.join(base, "fresh"));
      await storage.put("c/s/2026/10/b.png", Buffer.from("x"));
      assert.equal(await storage.exists("c/s/2026/10/b.png"), true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("refuses keys that would leave the evidence folder", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "cargo-ai-storage-"));
    try {
      const storage = new LocalDiskStorage(path.join(base, "root"));
      await assert.rejects(() => storage.put("../escape.jpg", Buffer.from("x")));
      assert.equal(await storage.exists("../escape.jpg"), false);
      assert.equal(await storage.stream("../../etc/passwd"), null);
      assert.equal(await storage.remove("../escape.jpg"), false);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("a relative folder resolves inside the backend, not the current directory", () => {
    const storage = new LocalDiskStorage("uploads");
    assert.ok(storage.directory.endsWith(path.join("apps", "backend", "uploads")), storage.directory);
  });
});

describe("evidence keys and content checks", () => {
  it("builds company-first keys with the right extension", () => {
    const key = buildObjectKey("c1", "s1", "image/jpeg", new Date("2026-10-05T00:00:00Z"));
    assert.match(key, /^c1\/s1\/2026\/10\/[0-9a-f-]{36}\.jpg$/);
  });

  it("only accepts keys of the same company and rejects traversal", () => {
    assert.equal(keyBelongsToCompany("c1", "c1/s1/2026/10/x.jpg"), true);
    assert.equal(keyBelongsToCompany("c1", "c2/s1/2026/10/x.jpg"), false);
    assert.equal(keyBelongsToCompany("c1", "c1/../c2/x.jpg"), false);
    assert.equal(keyBelongsToCompany("c1", "/c1/x.jpg"), false);
    assert.equal(keyBelongsToCompany("c1", ""), false);
    // with a site: the key must be inside that site's folder
    assert.equal(keyBelongsToCompany("c1", "c1/s1/2026/10/x.jpg", "s1"), true);
    assert.equal(keyBelongsToCompany("c1", "c1/s2/2026/10/x.jpg", "s1"), false, "a file of another site");
    assert.equal(keyBelongsToCompany("c1", "c1/s10/2026/10/x.jpg", "s1"), false, "a site id that only starts the same");
  });

  it("checks that the file content matches the claimed type", () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8)]);
    assert.equal(matchesContentType("image/jpeg", jpeg), true);
    assert.equal(matchesContentType("image/jpeg", Buffer.from("plain text")), false);
    assert.equal(matchesContentType("image/png", jpeg), false);
  });
});
