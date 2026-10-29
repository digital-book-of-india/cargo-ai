const codeInput = document.getElementById("code");
const connectBtn = document.getElementById("connect");
const statusEl = document.getElementById("status");

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = kind || "";
}

codeInput.addEventListener("input", () => {
  codeInput.value = codeInput.value.toUpperCase();
});

connectBtn.addEventListener("click", async () => {
  const code = codeInput.value.trim();
  if (!code) {
    setStatus("Enter the pairing code first.", "error");
    return;
  }

  connectBtn.disabled = true;
  setStatus("Connecting...");

  try {
    const result = await window.connector.pair(code);
    if (result?.ok) {
      setStatus(`Connected to ${result.shopName || "your site"}.`, "ok");
    } else {
      setStatus(result?.error || "Pairing failed.", "error");
      connectBtn.disabled = false;
    }
  } catch (err) {
    setStatus(err?.message || "Pairing failed.", "error");
    connectBtn.disabled = false;
  }
});

codeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") connectBtn.click();
});
