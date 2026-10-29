// Builds build-resources/ for electron-builder's extraResources: an embeddable Windows
// Python with the AI worker's dependencies installed, plus the worker source. Runs before
// packaging (see package.json "predist"); the slow Python part is skipped if already built.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const PY_VERSION = "3.12.8";
// go2rtc turns each camera's RTSP into WebRTC for the live view. Pinned so builds are repeatable.
const GO2RTC_VERSION = "1.9.9";
const YOLOX_URL = "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.onnx";
const YOLOX_SHA256 = "427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7";
// YuNet face detector (MIT): tells whether a person is facing the camera.
const YUNET_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx";
const YUNET_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4";
const root = path.join(__dirname, "..");
const out = path.join(root, "build-resources");
const pyDir = path.join(out, "python");
const cacheDir = path.join(out, ".cache");
const workerDir = path.join(root, "..", "ai-worker");
const marker = path.join(pyDir, ".theaft-ready");

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: "inherit" });
}

async function preparePython() {
  if (fs.existsSync(marker)) {
    console.log("[theaft-connector] embedded Python already prepared");
    return;
  }
  fs.rmSync(pyDir, { recursive: true, force: true });
  fs.mkdirSync(pyDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  const zip = path.join(cacheDir, `python-${PY_VERSION}-embed-amd64.zip`);
  if (!fs.existsSync(zip)) {
    console.log("[theaft-connector] downloading embeddable Python " + PY_VERSION);
    await download(`https://www.python.org/ftp/python/${PY_VERSION}/python-${PY_VERSION}-embed-amd64.zip`, zip);
  }
  run(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"), ["-xf", zip, "-C", pyDir]); // bsdtar ships with Windows 10+ and reads zip

  // Embedded Python ignores site-packages until `import site` is enabled in its ._pth file.
  const pth = fs.readdirSync(pyDir).find((f) => f.endsWith("._pth"));
  const pthFile = path.join(pyDir, pth);
  // Paths in a ._pth are relative to it; embedded Python also does not add the script's folder
  // to sys.path, so list the worker source (resources/ai-worker/src) explicitly.
  const pthText = fs.readFileSync(pthFile, "utf8").replace(/^#\s*import site/m, "import site");
  fs.writeFileSync(pthFile, pthText.trimEnd() + "\r\n..\\ai-worker\\src\r\n");

  const getPip = path.join(cacheDir, "get-pip.py");
  if (!fs.existsSync(getPip)) await download("https://bootstrap.pypa.io/get-pip.py", getPip);

  const python = path.join(pyDir, "python.exe");
  run(python, [getPip, "--no-warn-script-location"]);
  run(python, ["-m", "pip", "install", "--no-warn-script-location", "-r", path.join(workerDir, "requirements.txt")]);

  fs.writeFileSync(marker, PY_VERSION);
}

async function prepareGo2rtc() {
  const dir = path.join(out, "go2rtc");
  if (fs.existsSync(path.join(dir, "go2rtc.exe"))) {
    console.log("[theaft-connector] go2rtc already prepared");
    return;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const zip = path.join(cacheDir, `go2rtc_win64-${GO2RTC_VERSION}.zip`);
  if (!fs.existsSync(zip)) {
    console.log("[theaft-connector] downloading go2rtc " + GO2RTC_VERSION);
    await download(`https://github.com/AlexxIT/go2rtc/releases/download/v${GO2RTC_VERSION}/go2rtc_win64.zip`, zip);
  }
  run(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"), ["-xf", zip, "-C", dir]);
  if (!fs.existsSync(path.join(dir, "go2rtc.exe"))) throw new Error("go2rtc.exe missing from the downloaded archive");
}

function copyWorker() {
  fs.rmSync(path.join(out, "ai-worker"), { recursive: true, force: true });
  const dest = path.join(out, "ai-worker", "src");
  fs.cpSync(path.join(workerDir, "src"), dest, {
    recursive: true,
    filter: (p) => !p.includes("__pycache__"),
  });
  console.log("[theaft-connector] copied AI worker source -> " + dest);
}

// The person detector's model (YOLOX-tiny, Apache-2.0). Downloaded once, checked against a pinned
// hash and put next to the detector. Without it the worker falls back to the much weaker HOG detector.
async function prepareModel(name, url, expectedSha256) {
  const file = path.join(cacheDir, name);
  if (!fs.existsSync(file) || sha256(file) !== expectedSha256) {
    fs.mkdirSync(cacheDir, { recursive: true });
    console.log(`[theaft-connector] downloading ${name}`);
    await download(url, file);
  }
  if (sha256(file) !== expectedSha256) {
    fs.rmSync(file, { force: true });
    throw new Error(`The downloaded ${name} does not match the expected hash.`);
  }
  const dest = path.join(out, "ai-worker", "src", "detection", "models");
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(file, path.join(dest, name));
}

preparePython()
  .then(prepareGo2rtc)
  .then(copyWorker)
  .then(() => prepareModel("yolox_tiny.onnx", YOLOX_URL, YOLOX_SHA256))
  .then(() => prepareModel("face_detection_yunet_2023mar.onnx", YUNET_URL, YUNET_SHA256))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
