const fs = require("fs");
const { safeStorage } = require("electron");
const { STORE_FILE } = require("./config");

// Persists the paired connector's identity. The connector token is the only secret here;
// it's encrypted with the OS keychain (DPAPI on Windows) via safeStorage when available.
function load() {
  const file = STORE_FILE();
  if (!fs.existsSync(file)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw.connectorTokenEnc) return null;

    const encBuffer = Buffer.from(raw.connectorTokenEnc, "base64");
    const connectorToken = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(encBuffer)
      : encBuffer.toString("utf8");

    return { ...raw, connectorToken, connectorTokenEnc: undefined };
  } catch (err) {
    console.error("Failed to read connector store:", err);
    return null;
  }
}

function save({ connectorId, connectorToken, shopId, shopName }) {
  const encBuffer = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(connectorToken)
    : Buffer.from(connectorToken, "utf8");

  const payload = {
    connectorId,
    shopId,
    shopName,
    connectorTokenEnc: encBuffer.toString("base64"),
    pairedAt: new Date().toISOString(),
  };

  fs.writeFileSync(STORE_FILE(), JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

function clear() {
  const file = STORE_FILE();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

module.exports = { load, save, clear };
