// Uploads the built installer + update feed from dist/ to the backend, which serves them at
// <backend>/downloads/connector/. Needs THEAFT_BACKEND_URL and CONNECTOR_PUBLISH_KEY in the
// environment (the key must match CONNECTOR_PUBLISH_KEY on the backend).
const fs = require("fs");
const path = require("path");

const backendUrl = (process.env.THEAFT_BACKEND_URL || "").replace(/\/+$/, "");
const key = process.env.CONNECTOR_PUBLISH_KEY || "";
if (!backendUrl || !key) {
  console.error("Set THEAFT_BACKEND_URL and CONNECTOR_PUBLISH_KEY before publishing.");
  process.exit(1);
}

const distDir = path.join(__dirname, "..", "dist");
// Only what latest.yml references (installer + its blockmap) plus latest.yml itself - dist/
// also holds builder internals (e.g. __uninstaller-nsis-*.exe) that must not be uploaded.
const ymlPath = path.join(distDir, "latest.yml");
if (!fs.existsSync(ymlPath)) {
  console.error("dist/latest.yml is missing - run `npm run dist` first.");
  process.exit(1);
}
const installer = /^path:s*(.+)$/m.exec(fs.readFileSync(ymlPath, "utf8"))?.[1]?.trim();
if (!installer || !fs.existsSync(path.join(distDir, installer))) {
  console.error("Installer named in latest.yml not found in dist/.");
  process.exit(1);
}
const files = [installer, installer + ".blockmap", "latest.yml"].filter((f) => fs.existsSync(path.join(distDir, f)));

(async () => {
  // latest.yml goes last so clients never see a feed pointing at an installer not yet uploaded.
  const ordered = [...files.filter((f) => f !== "latest.yml"), "latest.yml"];
  for (const name of ordered) {
    const full = path.join(distDir, name);
    const res = await fetch(`${backendUrl}/downloads/connector/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "x-publish-key": key, "Content-Type": "application/octet-stream", "Content-Length": String(fs.statSync(full).size) },
      body: fs.createReadStream(full),
      duplex: "half",
    });
    if (!res.ok) {
      console.error(`Upload of ${name} failed: HTTP ${res.status} ${await res.text()}`);
      process.exit(1);
    }
    console.log(`uploaded ${name}`);
  }
  console.log(`Download: ${backendUrl}/downloads/connector/latest`);
})();
