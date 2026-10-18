// Receipts are drawn on a 58mm (384px) canvas, so Muktai works everywhere:
// the same image is used for Bluetooth thermal printing, system print, PNG, PDF and sharing.
const W = 384, P = 8, LH = 28;
const SERVICES = ["000018f0-0000-1000-8000-00805f9b34fb", "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455", "0000ff00-0000-1000-8000-00805f9b34fb", "0000fff0-0000-1000-8000-00805f9b34fb"];
let dev = null, chr = null;

/* ---------- line builders: {l,r,c,b,big,hr} ---------- */
const rs = n => "₹" + Math.round(n);
const head = () => [{ c: "SHREE RAM DAIRY", b: 1, big: 1 }, { c: "Gadarwara" }, { hr: 1 }];
export const billLines = b => [...head(), { l: b.no, r: b.day }, { hr: 1 },
  ...b.items.map(i => ({ l: `${i.name} x${i.qty}`, r: String(Math.round(i.rate * i.qty)) })), { hr: 1 },
  { l: "TOTAL", r: rs(b.total), b: 1, big: 1 }, { l: b.mode || "" }, { hr: 1 }, { c: "धन्यवाद 🙏" }];
export const bookingLines = b => [...head(), { c: "ADVANCE BOOKING", b: 1 }, { l: b.no, r: b.status }, { hr: 1 },
  { l: b.name }, { l: b.mobile || "" }, { l: `डिलीवरी: ${b.date} ${b.time || ""}` }, { hr: 1 },
  { l: `${b.product} x${b.qty}`, r: rs(b.qty * b.rate) }, { l: "Advance", r: rs(b.advance || 0) },
  { l: "बाकी", r: rs(b.qty * b.rate - (b.advance || 0)), b: 1, big: 1 }, ...(b.note ? [{ l: b.note }] : []), { hr: 1 }, { c: "धन्यवाद 🙏" }];
export const salaryLines = (name, month, s) => [...head(), { c: "SALARY SLIP", b: 1 }, { l: name, r: month }, { hr: 1 },
  { l: "Salary", r: rs(s.sal) }, { l: `Absent ${s.ab} + Half ${s.half}`, r: "-" + rs(s.ded) }, { l: "Advance", r: "-" + rs(s.adv) },
  { l: "Dairy products", r: "-" + rs(s.prod) }, { hr: 1 }, { l: "NET PAY", r: rs(s.net), b: 1, big: 1 }];

/* ---------- canvas renderer ---------- */
const fit = (ctx, t, max) => { t = String(t ?? ""); if (ctx.measureText(t).width <= max) return t; while (t.length > 1 && ctx.measureText(t + "…").width > max) t = t.slice(0, -1); return t + "…"; };
export async function render(lines) {
  try { await Promise.all([document.fonts.load("700 20px Mukta"), document.fonts.load("500 20px Mukta")]); } catch {}
  const c = document.createElement("canvas"); c.width = W; c.height = lines.reduce((h, l) => h + (l.hr ? 14 : l.big ? LH + 6 : LH), P * 2 + 24);
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, W, c.height); x.fillStyle = "#000"; x.textBaseline = "middle";
  let y = P;
  for (const l of lines) {
    const h = l.hr ? 14 : l.big ? LH + 6 : LH; x.font = `${l.b ? 700 : 500} ${l.big ? 24 : 20}px Mukta, sans-serif`;
    if (l.hr) { x.setLineDash([4, 3]); x.beginPath(); x.moveTo(P, y + 7); x.lineTo(W - P, y + 7); x.stroke(); }
    else if (l.c) { x.textAlign = "center"; x.fillText(fit(x, l.c, W - 2 * P), W / 2, y + h / 2); }
    else { const rw = l.r ? x.measureText(l.r).width + 10 : 0; x.textAlign = "left"; x.fillText(fit(x, l.l, W - 2 * P - rw), P, y + h / 2); if (l.r) { x.textAlign = "right"; x.fillText(l.r, W - P, y + h / 2); } }
    y += h;
  }
  return c;
}

/* ---------- ESC/POS raster (GS v 0) ---------- */
function toEscPos(c) {
  const w = c.width, h = c.height, bpr = w / 8, d = c.getContext("2d").getImageData(0, 0, w, h).data, out = [0x1b, 0x40];
  for (let y0 = 0; y0 < h; y0 += 128) {
    const rows = Math.min(128, h - y0); out.push(0x1d, 0x76, 0x30, 0, bpr & 255, bpr >> 8, rows & 255, rows >> 8);
    for (let y = 0; y < rows; y++) for (let xb = 0; xb < bpr; xb++) { let v = 0;
      for (let b = 0; b < 8; b++) { const i = ((y0 + y) * w + xb * 8 + b) * 4; if (d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11 < 140) v |= 0x80 >> b; } out.push(v); }
  }
  out.push(0x1b, 0x64, 4); return Uint8Array.from(out);
}

/* ---------- Bluetooth (Web Bluetooth: Android Chrome/Edge, desktop Chrome; NOT iPhone Safari) ---------- */
export const isConnected = () => !!(dev?.gatt?.connected && chr);
export const printerName = () => (isConnected() ? dev.name : "");
export async function connectPrinter() {
  if (!navigator.bluetooth) throw Error("इस browser में Bluetooth नहीं है — Android Chrome इस्तेमाल करें");
  dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
  dev.addEventListener("gattserverdisconnected", () => { chr = null; });
  const srv = await dev.gatt.connect();
  for (const s of await srv.getPrimaryServices()) for (const c of await s.getCharacteristics())
    if (c.properties.write || c.properties.writeWithoutResponse) { chr = c; return dev.name; }
  throw Error("इस printer में write service नहीं मिली");
}
async function sendBT(canvas) {
  if (!isConnected()) await connectPrinter();
  const data = toEscPos(canvas);
  for (let i = 0; i < data.length; i += 100) {
    const part = data.slice(i, i + 100);
    chr.properties.writeWithoutResponse ? await chr.writeValueWithoutResponse(part) : await chr.writeValue(part);
    await new Promise(r => setTimeout(r, 20));
  }
}

/* ---------- public actions ---------- */
export async function print(lines, { forceSystem = false } = {}) {
  const c = await render(lines);
  if (isConnected() && !forceSystem) return sendBT(c);
  const area = document.getElementById("print-area"); area.innerHTML = ""; const img = new Image(); img.src = c.toDataURL(); img.style.width = "58mm"; area.append(img);
  await img.decode(); window.print();
}
export const printBT = async lines => sendBT(await render(lines));
const save = (href, name) => { const a = document.createElement("a"); a.href = href; a.download = name; a.click(); };
export async function png(lines, name) { save((await render(lines)).toDataURL("image/png"), name + ".png"); }
export async function pdf(lines, name) {
  if (!window.jspdf) throw Error("PDF library load नहीं हुई, page refresh करें");
  const c = await render(lines), mm = 58, h = c.height / c.width * mm;
  const d = new window.jspdf.jsPDF({ unit: "mm", format: [mm, h] }); d.addImage(c.toDataURL("image/png"), "PNG", 0, 0, mm, h); d.save(name + ".pdf");
}
export async function share(lines, name, text = "") {
  const c = await render(lines), blob = await new Promise(r => c.toBlob(r)), f = new File([blob], name + ".png", { type: "image/png" });
  if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], text }); else save(URL.createObjectURL(blob), name + ".png");
}
