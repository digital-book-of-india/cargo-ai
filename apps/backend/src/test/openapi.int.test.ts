import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import YAML from "yaml";

// Keeps docs/openapi.yaml honest: every route the server really has must be documented, and
// nothing documented may be missing from the server. (Integration suffix: it loads the whole app.)

function collect(stack: any[], prefix: string, out: Set<string>) {
  for (const layer of stack) {
    if (layer.route) {
      for (const m of Object.keys(layer.route.methods)) {
        const p = `${prefix}${layer.route.path === "/" ? "" : layer.route.path}`;
        out.add(`${m.toUpperCase()} ${p}`);
      }
    } else if (layer.name === "router" && layer.handle?.stack) {
      const re = layer.regexp.source
        .replace("^\\/", "/")
        .replace("\\/?(?=\\/|$)", "")
        .replace(/\\\//g, "/");
      collect(layer.handle.stack, prefix + re, out);
    }
  }
}

describe("OpenAPI document", () => {
  it("lists exactly the routes the server has", async () => {
    const { app } = await import("../app");
    const actual = new Set<string>();
    collect((app as any)._router.stack, "", actual);
    actual.delete("OPTIONS *");

    // the platform API and the vision API (zones, counts, monitoring, ingestion) are documented separately
    const documented = new Set<string>();
    for (const file of ["docs/openapi.yaml", "docs/vision/openapi.yaml"]) {
      const doc = YAML.parse(fs.readFileSync(path.resolve(__dirname, "../../../../", file), "utf8"));
      for (const [p, item] of Object.entries<any>(doc.paths)) {
        for (const method of ["get", "post", "put", "patch", "delete"]) {
          if (item[method]) documented.add(`${method.toUpperCase()} ${p.replace(/\{(\w+)\}/g, ":$1")}`);
        }
      }
    }
    // express shows path params by name; compare ignoring the parameter names
    const norm = (s: string) => s.replace(/:\w+/g, ":p");
    const a = new Set([...actual].map(norm));
    const d = new Set([...documented].map(norm));
    assert.deepEqual([...a].filter((x) => !d.has(x)).sort(), [], "routes missing from docs/openapi.yaml");
    assert.deepEqual([...d].filter((x) => !a.has(x)).sort(), [], "documented routes the server does not have");
  });
});
