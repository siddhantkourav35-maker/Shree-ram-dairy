import * as P from "./print.js";
let C;
export function init(ctx) {
  C = ctx; const v = C.$("[data-view=more]"), adm = C.role.admin;
  v.innerHTML = `<div class="panel"><h2>और Features</h2><div class="grid2">
    <div class="panel tilt stat" data-go="bookings"><span>📅</span><b>बुकिंग</b><small>Advance orders</small></div>
    ${adm ? `<div class="panel tilt stat" data-go="staff"><span>👷</span><b>Staff</b><small>Salary • Attendance</small></div>` : ""}
    <div class="panel tilt stat" id="mPrn"><span>🖨️</span><b id="prnTxt">Printer</b><small>Bluetooth connect</small></div>
    ${adm ? `<div class="panel tilt stat" id="mBak"><span>💾</span><b>Backup</b><small>JSON download</small></div>
    <div class="panel tilt stat" id="mRate"><span>💰</span><b>Rates</b><small>Product prices</small></div>` : ""}</div></div>`;
  const upd = () => C.$("#prnTxt").textContent = P.printerName() || "Printer";
  C.$("#mPrn").onclick = C.safe(async () => { C.toast("Printer चुनें…"); const n = await P.connectPrinter(); upd(); C.toast(n + " connected ✅"); });
  if (!adm) return;
  C.$("#mBak").onclick = C.safe(async () => { const d = await C.A.backupAll(), a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: "application/json" })); a.download = `srd-backup-${C.A.today()}.json`; a.click(); localStorage.srd_backup = Date.now(); C.toast("Backup download हुआ ✅"); });
  C.$("#mRate").onclick = rates;
  if (Date.now() - (+localStorage.srd_backup || 0) > 7 * 864e5) setTimeout(() => C.toast("⚠️ 7 दिन से backup नहीं लिया — और → Backup"), 2500);
}
function rates() {
  const row = p => `<div class="row rr"><input value="${C.esc(p?.name || "")}" placeholder="Product"><input type="number" value="${p?.rate ?? ""}" placeholder="₹"></div>`;
  C.sheet(`<h2>Product Rates</h2><div id="rr">${C.products().map(row).join("")}</div><div class="actions"><button class="btn soft" id="rAdd">➕ Item</button><button class="btn" id="rSave">Save</button><button class="btn ghost" id="xS">बंद</button></div>`);
  C.$("#rAdd").onclick = () => C.$("#rr").insertAdjacentHTML("beforeend", row()); C.$("#xS").onclick = C.closeSheet;
  C.$("#rSave").onclick = C.safe(async () => { const l = [...document.querySelectorAll(".rr")].map(r => ({ name: r.children[0].value.trim(), rate: +r.children[1].value })).filter(x => x.name && x.rate >= 0); if (!l.length) throw Error("कम से कम एक product"); await C.A.saveProducts(l); C.toast("Rates save ✅"); C.closeSheet(); });
}
