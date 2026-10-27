// Fails when a tracked file looks like it holds a real secret.
//   node scripts/check-secrets.js              scan every tracked text file (used by CI and `npm run check:secrets`)
//   node scripts/check-secrets.js file1 file2  scan only these files (used to test the scanner itself)
// It checks the working tree, not git history. History needs its own cleanup (see docs/security-and-privacy.md).
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const MAX_BYTES = 1024 * 1024;
const SKIP = [/(^|\/)package-lock\.json$/, /\.(png|jpe?g|gif|ico|woff2?|ttf|pdf|zip|gz|lock)$/i];

// A value is harmless when it is clearly a placeholder, a variable reference or a local address.
const PLACEHOLDER = /^(<[^>]*>|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\*+|x{3,}|\.{3}|change-?me.*|your-.*|example.*|password|secret|token|test.*|dev.*|local.*)$/i;

const rules = [
  {
    name: "database or broker URL with a password",
    // scheme://user:password@host
    regex: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqps?):\/\/([^:\s/'"`<>]+):([^@\s'"`<>]+)@/g,
    isSecret: (m) => !PLACEHOLDER.test(m[2]),
  },
  {
    name: "secret-looking variable with a long random value",
    // NAME_SECRET=value, NAME_TOKEN: value, NAME_KEY="value" (env files, yaml, docs)
    regex: /^[ \t]*(?:export[ \t]+)?[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|ENCRYPTION_KEY|PRIVATE_KEY)[A-Z0-9_]*[ \t]*[=:][ \t]*["']?([A-Za-z0-9+/_\-=.]{24,})["']?[ \t]*$/gm,
    isSecret: (m) => !PLACEHOLDER.test(m[1]) && /[0-9]/.test(m[1]) && /[a-f]/i.test(m[1]),
  },
  { name: "private key block", regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g, isSecret: () => true },
  { name: "AWS access key id", regex: /\bAKIA[0-9A-Z]{16}\b/g, isSecret: () => true },
];

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
  return out.split("\0").filter(Boolean);
}

function scan(file) {
  const rel = file.replace(/\\/g, "/");
  if (SKIP.some((re) => re.test(rel))) return [];
  const full = path.isAbsolute(file) ? file : path.join(root, file);
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    return [];
  }
  if (!stat.isFile() || stat.size > MAX_BYTES) return [];
  const buf = fs.readFileSync(full);
  if (buf.includes(0)) return []; // binary
  const text = buf.toString("utf8");
  const hits = [];
  for (const rule of rules) {
    rule.regex.lastIndex = 0;
    let m;
    while ((m = rule.regex.exec(text))) {
      if (!rule.isSecret(m)) continue;
      const line = text.slice(0, m.index).split("\n").length;
      hits.push({ file: rel, line, rule: rule.name });
    }
  }
  return hits;
}

const args = process.argv.slice(2);
const files = args.length ? args : trackedFiles();
const hits = files.flatMap(scan);

if (hits.length) {
  console.error("Possible secrets found (values are not printed):");
  for (const h of hits) console.error(`  ${h.file}:${h.line}  ${h.rule}`);
  console.error("\nRemove the value, rotate it, and use a placeholder. See docs/security-and-privacy.md.");
  process.exit(1);
}
console.log(`No secrets found in ${files.length} file(s).`);
