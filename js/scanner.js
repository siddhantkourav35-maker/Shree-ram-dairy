// iOS-safe QR scanner: own getUserMedia pipeline (playsinline/muted), BarcodeDetector when present,
// jsQR everywhere else, plus a "scan from photo" fallback that works even when live camera is blocked.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function jsqr() { for (let i = 0; i < 50 && !window.jsQR; i++) await wait(100); if (!window.jsQR) throw Error("QR library load नहीं हुई — internet जाँचें और page refresh करें"); return window.jsQR; }
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function explain(e) {
  if (!isSecureContext) return "Camera के लिए HTTPS (https://…) ज़रूरी है।";
  if (e.name === "NotAllowedError" || e.name === "SecurityError")
    return IOS ? "Camera बंद है। iPhone: Settings → Safari → Camera → Allow। Home-screen app में न चले तो Safari में खोलें, या नीचे 'फोटो से scan' चुनें।" : "Camera permission दें (address bar के 🔒 से) और फिर कोशिश करें।";
  if (e.name === "NotFoundError" || e.name === "OverconstrainedError") return "इस device में camera नहीं मिला।";
  if (e.name === "NotReadableError") return "Camera दूसरे app/tab में चालू है — उसे बंद करें।";
  return e.message || "Camera शुरू नहीं हो सका।";
}

export class Scanner {
  constructor(video, { onResult, onStatus = () => {} }) { Object.assign(this, { v: video, onResult, onStatus, facing: "environment", stream: null, run: false, canTorch: false, torchOn: false }); this.cv = document.createElement("canvas"); this.cx = this.cv.getContext("2d", { willReadFrequently: true }); document.addEventListener("visibilitychange", this._vis = () => document.hidden && this.stop()); }
  async start() {
    await this.stop();
    if (!navigator.mediaDevices?.getUserMedia) throw Error(isSecureContext ? "इस browser में camera support नहीं है।" : "Camera के लिए HTTPS ज़रूरी है।");
    const gum = (v) => navigator.mediaDevices.getUserMedia({ video: v, audio: false });
    try { this.stream = await gum({ facingMode: { ideal: this.facing }, width: { ideal: 1280 }, height: { ideal: 720 } }); }
    catch (e) { if (e.name === "OverconstrainedError" || e.name === "NotFoundError") { try { this.stream = await gum(true); } catch (x) { throw Error(explain(x)); } } else throw Error(explain(e)); }
    const v = this.v; v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", ""); v.muted = true; v.autoplay = true; v.srcObject = this.stream;
    try { await v.play(); } catch (e) { throw Error(explain(e)); }
    for (let i = 0; i < 40 && !v.videoWidth; i++) await wait(50);
    const t = this.stream.getVideoTracks()[0]; this.canTorch = !!t?.getCapabilities?.().torch; this.torchOn = false;
    this.det = null; if ("BarcodeDetector" in window) { try { this.det = new BarcodeDetector({ formats: ["qr_code"] }); } catch {} }
    if (!this.det) await jsqr();
    this.run = true; this.onStatus("QR को frame के बीच में रखें"); this._loop(0);
  }
  _loop = async (last) => {
    if (!this.run) return; const now = performance.now(), v = this.v;
    if (now - last > 110 && v.readyState >= 2 && v.videoWidth) {
      try {
        let code = null;
        if (this.det) { const r = await this.det.detect(v); code = r[0]?.rawValue; }
        else { const k = Math.min(1, 800 / v.videoWidth), w = Math.round(v.videoWidth * k), h = Math.round(v.videoHeight * k); this.cv.width = w; this.cv.height = h; this.cx.drawImage(v, 0, 0, w, h); code = window.jsQR(this.cx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" })?.data; }
        if (code && this.run) { this.run = false; navigator.vibrate?.(60); return this.onResult(code); }
      } catch {}
      last = now;
    }
    requestAnimationFrame(() => this._loop(last));
  };
  async flip() { this.facing = this.facing === "environment" ? "user" : "environment"; await this.start(); }
  async torch() { const t = this.stream?.getVideoTracks()[0]; if (!this.canTorch) return; this.torchOn = !this.torchOn; await t.applyConstraints({ advanced: [{ torch: this.torchOn }] }).catch(() => {}); }
  async stop() { this.run = false; this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null; if (this.v) this.v.srcObject = null; }
  destroy() { document.removeEventListener("visibilitychange", this._vis); return this.stop(); }
}

// Decode a QR from a photo (input type=file capture) — the most reliable path on iPhone home-screen apps
export async function decodeFile(file) {
  const q = await jsqr(), img = new Image(), url = URL.createObjectURL(file); img.src = url;
  try { await img.decode(); } catch { await new Promise((r, j) => { img.onload = r; img.onerror = j; }); }
  URL.revokeObjectURL(url);
  for (const max of [1024, 1600, 640]) {
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
    const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h);
    const r = q(x.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "attemptBoth" }); if (r?.data) return r.data;
  }
  return null;
}
