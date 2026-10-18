import * as P from "./print.js";
let C, B = {}, editing = null, filt = "open", timer = null;
const ST = ["Pending", "Ready", "Delivered", "Cancelled"], LBL = { Pending: "बाकी", Ready: "तैयार", Delivered: "दे दिया", Cancelled: "रद्द" };
const wa = b => `https://wa.me/91${String(b.mobile || "").replace(/\D/g, "").slice(-10)}?text=${encodeURIComponent(`Shree Ram Dairy\nBooking ${b.no}\n${b.product} x${b.qty}\nडिलीवरी: ${b.date} ${b.time || ""}\nकुल ₹${b.qty * b.rate}, Advance ₹${b.advance || 0}, बाकी ₹${b.qty * b.rate - (b.advance || 0)}`)}`;

export function init(ctx) {
  C = ctx; const v = C.$("[data-view=bookings]");
  if (!v.dataset.ready) {
    v.dataset.ready = 1;
    v.innerHTML = `<div class="panel"><h2 id="bkTitle">📅 Advance Booking</h2>
    <div class="row"><input id="bkName" placeholder="नाम"><input id="bkMob" inputmode="tel" placeholder="मोबाइल"></div>
    <div class="row"><select id="bkProd"></select><input id="bkQty" type="number" step=".25" value="1" placeholder="Qty"><input id="bkRate" type="number" placeholder="Rate"></div>
    <div class="row"><input id="bkDate" type="date"><input id="bkTime" type="time"><input id="bkAdv" type="number" placeholder="Advance ₹"></div>
    <input id="bkNote" placeholder="Note (optional)"><div class="total">बाकी रकम <b id="bkBal">₹0</b></div>
    <div class="actions"><button class="btn" id="bkSave">✅ बुकिंग सेव करें</button><button class="btn soft" id="bkNotif">🔔 Reminders</button><button class="btn ghost" id="bkReset">Reset</button></div></div>
    <div class="panel"><div class="chips" id="bkFilt"><button data-f="open">चालू</button><button data-f="Delivered">Delivered</button><button data-f="Cancelled">रद्द</button><button data-f="all">सब</button></div><div id="bkList" class="list"></div></div>`;
    const calc = () => C.$("#bkBal").textContent = C.inr(C.$("#bkQty").value * C.$("#bkRate").value - (+C.$("#bkAdv").value || 0));
    v.addEventListener("input", calc);
    C.$("#bkProd").onchange = () => { const p = C.products()[C.$("#bkProd").value]; if (p) C.$("#bkRate").value = p.rate; calc(); };
    C.$("#bkSave").onclick = C.safe(save); C.$("#bkReset").onclick = reset;
    C.$("#bkNotif").onclick = C.safe(async () => { if (!("Notification" in window)) throw Error("Notifications support नहीं है"); const r = await Notification.requestPermission(); if (r !== "granted") throw Error("Permission नहीं मिली"); C.toast("Reminders चालू ✅ (app खुला होने पर)"); check(); });
    C.$("#bkFilt").onclick = e => { const b = e.target.closest("[data-f]"); if (b) { filt = b.dataset.f; render(); } };
    C.$("#bkList").onclick = C.safe(async e => {
      const b = e.target.closest("[data-a]"); if (!b) return; const bk = B[b.dataset.n], a = b.dataset.a;
      if (a === "st") await C.A.setBookingStatus(bk.no, ST[(ST.indexOf(bk.status) + 1) % 4]);
      if (a === "edit") fill(bk);
      if (a === "print") await P.print(P.bookingLines(bk));
      if (a === "pdf") await P.pdf(P.bookingLines(bk), bk.no);
      if (a === "del" && confirm(bk.no + " delete करें?")) await C.A.deleteBooking(bk.no);
    });
  }
  C.$("#bkDate").value ||= C.A.dayPlus(1); fillProducts();
  C.unsubs.push(C.A.watchBookings(d => { B = d; render(); check(); }));
  clearInterval(timer); timer = setInterval(check, 15 * 60 * 1000);
}
function fillProducts() { C.$("#bkProd").innerHTML = C.products().map((p, i) => `<option value="${i}">${C.esc(p.name)}</option>`).join(""); if (!C.$("#bkRate").value) C.$("#bkRate").value = C.products()[0]?.rate || ""; }
function reset() { editing = null; C.$("#bkTitle").textContent = "📅 Advance Booking"; ["Name", "Mob", "Adv", "Note", "Time"].forEach(k => C.$("#bk" + k).value = ""); C.$("#bkQty").value = 1; C.$("#bkDate").value = C.A.dayPlus(1); C.$("#bkBal").textContent = "₹0"; }
function fill(b) { editing = b.no; C.go("bookings"); C.$("#bkTitle").textContent = "✏️ Edit " + b.no; fillProducts();
  const i = C.products().findIndex(p => p.name === b.product); if (i >= 0) C.$("#bkProd").value = i;
  Object.entries({ Name: b.name, Mob: b.mobile, Qty: b.qty, Rate: b.rate, Date: b.date, Time: b.time, Adv: b.advance, Note: b.note }).forEach(([k, x]) => C.$("#bk" + k).value = x ?? ""); C.$("#bkQty").dispatchEvent(new Event("input", { bubbles: true })); scrollTo({ top: 0 }); }
async function save() {
  const p = C.products()[C.$("#bkProd").value], d = { name: C.$("#bkName").value.trim(), mobile: C.$("#bkMob").value.trim(), product: p?.name || "", qty: +C.$("#bkQty").value, rate: +C.$("#bkRate").value, advance: +C.$("#bkAdv").value || 0, date: C.$("#bkDate").value, time: C.$("#bkTime").value, note: C.$("#bkNote").value.trim() };
  if (!d.name || !d.date || !(d.qty > 0) || !(d.rate > 0)) throw Error("नाम, तारीख, मात्रा और rate भरें");
  const b = await C.A.saveBooking(d, editing); C.toast("Booking " + b.no + " सेव ✅"); reset();
  if (confirm("Slip print करें?")) await P.print(P.bookingLines({ ...B[b.no], ...b }));
}
function render() {
  const l = Object.values(B).filter(b => filt === "all" || (filt === "open" ? ["Pending", "Ready"].includes(b.status) : b.status === filt)).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  C.$("#bkFilt").querySelectorAll("button").forEach(x => x.style.outline = x.dataset.f === filt ? "2px solid var(--g)" : "");
  C.$("#bkList").innerHTML = l.map(b => `<div style="display:block;cursor:default"><div style="display:flex;justify-content:space-between;gap:8px"><span><b>${C.esc(b.name)}</b> <small class="muted">${C.esc(b.no)}</small><br><small>${C.esc(b.product)} x${b.qty} • ${C.esc(b.date)} ${C.esc(b.time || "")}</small></span>
    <span style="text-align:right"><b>${C.inr(b.qty * b.rate - (b.advance || 0))}</b><br><span class="pill ${b.status === "Cancelled" ? "low" : ""}" data-a="st" data-n="${C.esc(b.no)}" style="cursor:pointer">${LBL[b.status] || b.status} ⟳</span></span></div>
    <div class="actions"><button class="btn soft" data-a="edit" data-n="${C.esc(b.no)}">✏️</button><button class="btn soft" data-a="print" data-n="${C.esc(b.no)}">🖨️</button><button class="btn soft" data-a="pdf" data-n="${C.esc(b.no)}">PDF</button><a class="btn soft" style="text-decoration:none;text-align:center" target="_blank" rel="noopener" href="${wa(b)}">WhatsApp</a>${C.role.admin ? `<button class="btn soft" data-a="del" data-n="${C.esc(b.no)}">🗑️</button>` : ""}</div></div>`).join("") || "<p class='muted'>कोई booking नहीं</p>";
}
// Local reminders: fire while the app is open (installed PWA / open tab). True background push needs FCM + a server (paid plan).
function check() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const t = C.A.today(), tm = C.A.dayPlus(1), half = new Date().getHours() < 12 ? "am" : "pm";
  Object.values(B).filter(b => ["Pending", "Ready"].includes(b.status) && (b.date === t || b.date === tm)).forEach(b => {
    const k = `srd_n_${b.no}_${b.date}_${half}`; if (localStorage[k]) return; localStorage[k] = 1;
    const title = (b.date === t ? "आज" : "कल") + " की booking: " + b.name, body = `${b.product} x${b.qty} • ${b.time || ""} • बाकी ${C.inr(b.qty * b.rate - (b.advance || 0))}`;
    navigator.serviceWorker?.ready.then(r => r.showNotification(title, { body, tag: b.no, icon: "/icon.svg" })).catch(() => new Notification(title, { body }));
  });
}
