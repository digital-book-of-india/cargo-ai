import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "stream";
import { ObjectStorage, type ObjectStoreClient, type ObjectStoreCommands } from "./objectStorage";

// A tiny in-memory stand-in for the AWS SDK: commands record their name and input, the client acts on them.
class Cmd {
  constructor(public input: Record<string, any>) {}
}
const commands = {
  PutObjectCommand: class Put extends Cmd {},
  GetObjectCommand: class Get extends Cmd {},
  HeadObjectCommand: class Head extends Cmd {},
  DeleteObjectCommand: class Del extends Cmd {},
} as unknown as ObjectStoreCommands;

function fakeClient(files: Map<string, Buffer>, failWith?: Error): ObjectStoreClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async send(command: any) {
      const kind = command.constructor.name;
      calls.push(`${kind}:${command.input.Key}`);
      if (failWith) throw failWith;
      const key = command.input.Key as string;
      if (kind === "Put") {
        files.set(key, command.input.Body);
        return {};
      }
      if (kind === "Del") {
        files.delete(key);
        return {};
      }
      const data = files.get(key);
      if (!data) throw Object.assign(new Error("missing"), { name: kind === "Head" ? "NotFound" : "NoSuchKey", $metadata: { httpStatusCode: 404 } });
      if (kind === "Head") return { ContentLength: data.length };
      return { Body: Readable.from([data]), ContentLength: data.length };
    },
  };
}

describe("object storage evidence adapter", () => {
  it("stores, streams, checks and removes a file under the prefix", async () => {
    const files = new Map<string, Buffer>();
    const storage = new ObjectStorage(fakeClient(files), commands, { bucket: "b", prefix: "/evidence/" });

    await storage.put("co/site/2026/10/a.jpg", Buffer.from("hello"));
    assert.deepEqual([...files.keys()], ["evidence/co/site/2026/10/a.jpg"]);
    assert.equal(await storage.exists("co/site/2026/10/a.jpg"), true);

    const file = await storage.stream("co/site/2026/10/a.jpg");
    assert.equal(file?.size, 5);
    const chunks: Buffer[] = [];
    for await (const c of file!.stream) chunks.push(Buffer.from(c));
    assert.equal(Buffer.concat(chunks).toString(), "hello");

    assert.equal(await storage.remove("co/site/2026/10/a.jpg"), true);
    assert.equal(await storage.exists("co/site/2026/10/a.jpg"), false);
    assert.equal(await storage.remove("co/site/2026/10/a.jpg"), false, "removing a missing file says so");
    assert.equal(await storage.stream("co/site/2026/10/a.jpg"), null);
  });

  it("refuses keys that try to leave the folder", async () => {
    const files = new Map<string, Buffer>();
    const client = fakeClient(files);
    const storage = new ObjectStorage(client, commands, { bucket: "b" });
    for (const bad of ["../x", "a/../../x", "/abs", "a\\b", "a\0b", ""]) {
      await assert.rejects(() => storage.put(bad, Buffer.from("x")), /Invalid evidence key/);
      assert.equal(await storage.exists(bad), false);
      assert.equal(await storage.stream(bad), null);
      assert.equal(await storage.remove(bad), false);
    }
    assert.equal(client.calls.length, 0, "nothing reached the bucket");
  });

  it("does not hide an outage as a missing file", async () => {
    const down = Object.assign(new Error("credentials rejected"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
    const storage = new ObjectStorage(fakeClient(new Map(), down), commands, { bucket: "b" });
    await assert.rejects(() => storage.exists("a/b.jpg"), /credentials rejected/);
    await assert.rejects(() => storage.stream("a/b.jpg"), /credentials rejected/);
  });
});
