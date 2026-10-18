import * as A from "./api.js";
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = n => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
const Lt = n => +Number(n || 0).toFixed(2) + " L";
const S = { customers: {}, stock: {}, settings: {}, bills: {}, expenses: {} };
let role = {}, cart = [], unsubs = [], scanner = null, lastBill = null;
const products = () => Object.values(S.settings.products || A.DEFAULT_PRODUCTS);
const rate = () => Number(products()[0]?.rate) || 70;

function toast(t, err) { const e = document.createElement("div"); e.className = "toast" + (err ? " err" : ""); e.textContent = t; $("#toasts").append(e); setTimeout(() => e.remove(), 3200); }
const safe = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message || String(e), 1); } };

/* ---------- spatial: pointer parallax + card tilt ---------- */
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
if (!calm) {
  addEventListener("pointermove", e => {
    document.documentElement.style.setProperty("--px", (e.clientX / innerWidth - .5).toFixed(3));
    document.documentElement.style.setProperty("--py", (e.clientY / innerHeight - .5).toFixed(3));
    const t = e.target.closest?.(".tilt"); $$(".tilt").forEach(x => { if (x !== t) { x.style.setProperty("--rx", "0deg"); x.style.setProperty("--ry", "0deg"); } });
    if (t) { const r = t.getBoundingClientRect(); t.style.setProperty("--ry", ((e.clientX - r.left) / r.width - .5) * 8 + "deg"); t.style.setProperty("--rx", (.5 - (e.clientY - r.top) / r.height) * 8 + "deg"); }
  });
  addEventListener("deviceorientation", e => { if (e.gamma == null) return; document.documentElement.style.setProperty("--px", Math.max(-.5, Math.min(.5, e.gamma / 60))); document.documentElement.style.setProperty("--py", Math.max(-.5, Math.min(.5, (e.beta - 45) / 90))); });
}
if (localStorage.theme) document.documentElement.dataset.theme = localStorage.theme;
$("#themeBtn").onclick = () => { const d = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = d; localStorage.theme = d; };
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

/* ---------- auth ---------- */
$("#loginForm").onsubmit = safe(async e => { e.preventDefault(); await A.login($("#email").value.trim(), $("#password").value); });
$("#forgot").onclick = safe(async () => { const m = $("#email").value.trim(); if (!m) throw Error("पहले Email डालें"); await A.resetPassword(m); toast("Reset link भेज दिया ✅"); });
$("#logoutBtn").onclick = async () => {
  try {
    await A.logout();
    toast("लॉगआउट हो गया ✅");
  } catch (e) {
    toast(e.message || "Logout failed", 1);
  }
};
A.onAuth(async u => {
  unsubs.forEach(f => f()); unsubs = [];
  if (!u) {
    $("#login").hidden = false;
    $("#login").style.display = "grid";
    $("#app").hidden = true;
    $("#app").style.display = "none";
    return;
  }
  role = await A.loadRole(u.uid);
  if (!role.staff) {
    toast("यह खाता staff में नहीं है। Owner से संपर्क करें।", 1);
    return A.logout();
  }
  $("#login").hidden = true;
  $("#login").style.display = "none";
  $("#app").hidden = false;
  $("#app").style.display = "block";
  $("#who").textContent = u.email + (role.admin ? " • Owner" : "");
  $$(".admin-only").forEach(e => e.hidden = !role.admin);
  const on = (k, f) => unsubs.push(A.watch(k, v => { S[k] = v; f(); }));
  on("customers", () => { renderHome(); renderCustomers(); });
  on("stock", renderStock);
  on("settings", renderChips);
  unsubs.push(A.watchBills(v => { S.bills = v; renderHome(); renderBills(); renderMoney(); }));
  if (role.admin) unsubs.push(A.watchExpenses(v => { S.expenses = v; renderMoney(); }));
  renderChips();
  renderMore();
});

/* ---------- navigation ---------- */
function go(v) { $$(".view").forEach(x => x.hidden = x.dataset.view !== v); $$(".dock button").forEach(b => b.classList.toggle("on", b.dataset.go === v)); scrollTo({ top: 0 }); }
document.addEventListener("click", e => { const g = e.target.closest("[data-go]"); if (g) go(g.dataset.go); });
function sheet(html) {
  $("#sheet").innerHTML = html;
  $("#sheet").hidden = $("#backdrop").hidden = false;
  $("#sheet").style.display = "block";
  $("#backdrop").style.display = "block";
}
async function closeSheet() {
  await stopScan();
  $("#sheet").hidden = $("#backdrop").hidden = true;
  $("#sheet").style.display = "none";
  $("#backdrop").style.display = "none";
}
$("#backdrop").onclick = closeSheet;

/* ---------- home & cards ---------- */
function renderHome() {
  const cs = Object.values(S.customers), bs = Object.values(S.bills).filter(b => b.day === A.today());
  const pre = cs.filter(c => c.type === "prepaid");
  $("#hSales").textContent = inr(bs.reduce((s, b) => s + b.total, 0));
  $("#hBills").textContent = bs.length + " bills (क्लिक कर देखें ➔)";
  $("#hCust").textContent = cs.length;
  $("#hLitres").textContent = Lt(pre.reduce((s, c) => s + (c.litres || 0), 0));
  const low = pre.filter(c => (c.litres || 0) <= 2).sort((a, b) => a.litres - b.litres);
  $("#hLow").textContent = low.length;
  $("#hDue").textContent = inr(cs.filter(c => c.type === "monthly").reduce((s, c) => s + (c.due || 0), 0));
  $("#lowList").innerHTML = low.length ? "<h3>रिचार्ज याद दिलाएं</h3><div class='list'>" + low.slice(0, 6).map(c => `<div class="clickable" data-open="${esc(c.id)}"><span><b>${esc(c.name)}</b></span><span class="pill low">${Lt(c.litres)} ➔</span></div>`).join("") + "</div>" : "";
}

// Clickable Stat Cards details
if ($("#cardPrepaid")) $("#cardPrepaid").onclick = () => {
  const pre = Object.values(S.customers).filter(c => c.type === "prepaid").sort((a, b) => (b.litres || 0) - (a.litres || 0));
  sheet(`<h2>🥛 Prepaid ग्राहक सूची (${pre.length})</h2><small class="muted">कुल बाकी दूध: ${Lt(pre.reduce((s, c) => s + (c.litres || 0), 0))}</small>
  <div class="list" style="margin-top:14px">${pre.map(c => `<div class="clickable" data-open="${esc(c.id)}"><span><b>${esc(c.name)}</b><br><small class="muted">${esc(c.id)} • 📞 ${esc(c.mobile || "-")}</small></span><span class="pill ${c.litres <= 2 ? "low" : ""}">${Lt(c.litres)} ➔</span></div>`).join("") || "<p class='muted'>कोई prepaid ग्राहक नहीं</p>"}</div>
  <button class="btn ghost" id="xS">बंद करें</button>`);
  $("#xS").onclick = closeSheet;
};

if ($("#cardLow")) $("#cardLow").onclick = () => {
  const low = Object.values(S.customers).filter(c => c.type === "prepaid" && (c.litres || 0) <= 2).sort((a, b) => a.litres - b.litres);
  sheet(`<h2>⚠️ कम Balance वाले ग्राहक (${low.length})</h2><small class="muted">इन ग्राहकों का 2L या कम दूध बाकी है</small>
  <div class="list" style="margin-top:14px">${low.map(c => `<div class="clickable" data-open="${esc(c.id)}"><span><b>${esc(c.name)}</b><br><small class="muted">${esc(c.id)} • 📞 ${esc(c.mobile || "-")}</small></span><span class="pill low">${Lt(c.litres)} ➔</span></div>`).join("") || "<p class='muted'>कोई कम balance ग्राहक नहीं</p>"}</div>
  <button class="btn ghost" id="xS">बंद करें</button>`);
  $("#xS").onclick = closeSheet;
};

if ($("#cardDue")) $("#cardDue").onclick = () => {
  const mon = Object.values(S.customers).filter(c => c.type === "monthly").sort((a, b) => (b.due || 0) - (a.due || 0));
  const totalDue = mon.reduce((s, c) => s + (c.due || 0), 0);
  sheet(`<h2>🧾 Monthly बकाया सूची (${mon.length})</h2><small class="muted">कुल बकाया: <b>${inr(totalDue)}</b></small>
  <div class="list" style="margin-top:14px">${mon.map(c => `<div class="clickable" data-open="${esc(c.id)}"><span><b>${esc(c.name)}</b><br><small class="muted">${esc(c.id)} • 📞 ${esc(c.mobile || "-")}</small></span><b style="color:var(--warn)">${inr(c.due)} ➔</b></div>`).join("") || "<p class='muted'>कोई बकाया नहीं</p>"}</div>
  <button class="btn ghost" id="xS">बंद करें</button>`);
  $("#xS").onclick = closeSheet;
};

document.addEventListener("click", e => { const o = e.target.closest("[data-open]"); if (o) openCustomer(o.dataset.open); });

/* ---------- customers ---------- */
function renderCustomers() {
  const q = $("#search").value.trim().toLowerCase();
  const list = Object.values(S.customers).filter(c => !q || [c.name, c.mobile, c.id].some(x => String(x || "").toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name));
  $("#custList").innerHTML = list.slice(0, 80).map(c => `<div data-open="${esc(c.id)}"><span><b>${esc(c.name)}</b><br><small class="muted">${esc(c.id)} • ${esc(c.mobile || "-")}</small></span>
    <span class="pill ${c.type === "prepaid" && c.litres <= 2 ? "low" : ""}">${c.type === "prepaid" ? Lt(c.litres) : "बकाया " + inr(c.due)}</span></div>`).join("") || "<p class='muted'>कोई ग्राहक नहीं</p>";
}
$("#search").oninput = renderCustomers;
const nextId = () => "SRD-" + String(Math.max(0, ...Object.keys(S.customers).map(k => parseInt(k.split("-")[1]) || 0)) + 1).padStart(3, "0");

async function openCustomer(id) {
  const c = S.customers[id] || await A.resolveCustomer(id); if (!c) return toast("ग्राहक नहीं मिला: " + id, 1);
  const url = location.origin + "/portal.html?t=" + c.token, h = await A.history(c.id);
  const monthly = c.type === "monthly";
  sheet(`<h2>${esc(c.name)}</h2><small class="muted">${esc(c.id)} • ${esc(c.mobile || "-")} • ${monthly ? "Monthly" : "Prepaid"}</small>
  <div class="muted" style="margin-top:12px">${monthly ? "बकाया" : "बाकी दूध"}</div><div class="bal">${monthly ? inr(c.due) : Lt(c.litres)}</div>${monthly ? "" : `<small class="muted">Value ${inr(c.balance)}</small>`}
  <h3 style="margin-top:14px">आज दूध दें</h3><div class="actions">${[.5, 1, 1.5, 2].map(l => `<button class="btn soft" data-give="${l}">${l} L</button>`).join("")}</div>
  <div class="row"><input id="gL" type="number" step=".25" placeholder="Litres"><button class="btn" id="gBtn">दें</button></div>
  <h3>${monthly ? "भुगतान मिला" : "Recharge"}</h3><div class="row"><input id="rV" type="number" placeholder="${monthly ? "₹ राशि" : "Litres"}"><button class="btn" id="rBtn">${monthly ? "Payment" : "+ Recharge"}</button></div>
  <h3>History</h3><div class="list">${h.map(x => `<div style="cursor:default"><span>${{ milk: "दूध दिया", recharge: "Recharge", payment: "Payment" }[x.kind] || x.kind}<br><small class="muted">${new Date(x.at).toLocaleString("en-IN")}</small></span><b>${x.kind === "payment" ? inr(x.amount) : Lt(x.litres)}</b></div>`).join("") || "<p class='muted'>कोई history नहीं</p>"}</div>
  <h3>ग्राहक QR Card</h3><div class="qrbox" id="qr"></div><small class="muted">ग्राहक यह QR scan करके अपना balance देख सकता है।</small>
  <div class="actions"><a class="btn soft" style="text-decoration:none;text-align:center" href="https://wa.me/91${esc(c.mobile)}?text=${encodeURIComponent(`${c.name}, आपका ${monthly ? "बकाया " + inr(c.due) : "दूध balance " + Lt(c.litres)} है। देखें: ${url}`)}" target="_blank" rel="noopener">WhatsApp</a>
  ${role.admin ? `<button class="btn danger" id="delC">Delete</button>` : ""}<button class="btn ghost" id="xS">बंद करें</button></div>`);
  if (window.QRCode) new QRCode($("#qr"), { text: url, width: 170, height: 170 });
  const act = safe(async (kind, litres, amount) => { await A.adjust(c.id, { kind, litres, amount }); toast("हो गया ✅"); openCustomer(c.id); });
  $$("[data-give]").forEach(b => b.onclick = () => act("milk", +b.dataset.give, +b.dataset.give * rate()));
  $("#gBtn").onclick = () => act("milk", +$("#gL").value, +$("#gL").value * rate());
  $("#rBtn").onclick = () => monthly ? act("payment", 0, +$("#rV").value) : act("recharge", +$("#rV").value, +$("#rV").value * rate());
  $("#xS").onclick = closeSheet;
  if ($("#delC")) $("#delC").onclick = safe(async () => { if (confirm(c.name + " delete करें?")) { await A.deleteCustomer(c); closeSheet(); toast("Delete हो गया"); } });
}

function newCustomer() {
  sheet(`<h2>नया ग्राहक</h2><input id="nId" value="${nextId()}"><input id="nName" placeholder="नाम"><input id="nMob" inputmode="tel" placeholder="मोबाइल">
  <select id="nType"><option value="prepaid">Prepaid (पहले पैसे)</option><option value="monthly">Monthly (महीने के अंत में)</option></select>
  <input id="nL" type="number" step=".5" placeholder="शुरुआती Litres (prepaid)"><div class="actions"><button class="btn" id="nSave">बनाएं</button><button class="btn ghost" id="xS">रद्द</button></div>`);
  $("#xS").onclick = closeSheet;
  $("#nSave").onclick = safe(async () => { const c = await A.createCustomer({ id: $("#nId").value.trim().toUpperCase(), name: $("#nName").value.trim(), mobile: $("#nMob").value.trim(), type: $("#nType").value, litres: +$("#nL").value || 0, rate: rate() }); toast("ग्राहक बन गया ✅"); openCustomer(c.id); });
}
$("#qNew").onclick = newCustomer;

/* ---------- QR scan ---------- */
async function stopScan() { if (scanner) { try { await scanner.stop(); scanner.clear(); } catch {} scanner = null; } }
$("#qScan").onclick = () => {
  sheet(`<h2>QR Scan</h2><div id="reader"></div><div class="row"><input id="manual" placeholder="या Customer ID लिखें"><button class="btn" id="mGo">खोलें</button></div><button class="btn ghost" id="xS">बंद करें</button>`);
  $("#xS").onclick = closeSheet; $("#mGo").onclick = () => openCustomer($("#manual").value.trim().toUpperCase());
  if (!window.Html5Qrcode) return toast("Scanner load नहीं हुआ", 1);
  scanner = new Html5Qrcode("reader");
  scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 230 }, async txt => { await stopScan(); const c = await A.resolveCustomer(txt); c ? openCustomer(c.id) : (toast("ग्राहक नहीं मिला", 1), closeSheet()); }, () => {}).catch(() => toast("Camera permission दें", 1));
};

/* ---------- billing ---------- */
function renderChips() { $("#chips").innerHTML = products().map((p, i) => `<button data-add="${i}">${esc(p.name)} · ${inr(p.rate)}</button>`).join(""); }
document.addEventListener("click", e => { const b = e.target.closest("[data-add]"); if (!b) return; const p = products()[+b.dataset.add]; const x = cart.find(i => i.name === p.name); x ? x.qty++ : cart.push({ name: p.name, rate: +p.rate, qty: 1 }); renderCart(); });
function renderCart() {
  $("#cart").innerHTML = cart.map((i, n) => `<div class="cartrow"><span>${esc(i.name)}</span><input data-q="${n}" type="number" step=".25" min="0" value="${i.qty}"><b>${inr(i.rate * i.qty)}</b><button class="icon" data-rm="${n}">✕</button></div>`).join("") || "<p class='muted'>ऊपर से item चुनें</p>";
  $("#bTotal").textContent = inr(cart.reduce((s, i) => s + i.rate * i.qty, 0));
}
$("#cart").addEventListener("input", e => { if (e.target.dataset.q != null) { cart[+e.target.dataset.q].qty = +e.target.value || 0; $("#bTotal").textContent = inr(cart.reduce((s, i) => s + i.rate * i.qty, 0)); } });
$("#cart").addEventListener("click", e => { const r = e.target.closest("[data-rm]"); if (r) { cart.splice(+r.dataset.rm, 1); renderCart(); } });
$("#bClear").onclick = () => { cart = []; renderCart(); };
const receipt = b => `<div style="text-align:center"><b>SHREE RAM DAIRY</b><br>Gadarwara</div><hr>${esc(b.no)} • ${esc(b.day)}<hr>${b.items.map(i => `<div class="r"><span>${esc(i.name)} x${i.qty}</span><span>${Math.round(i.rate * i.qty)}</span></div>`).join("")}<hr><div class="r"><b>TOTAL</b><b>${Math.round(b.total)}</b></div><div>${esc(b.mode)}</div><hr><div style="text-align:center">धन्यवाद 🙏</div>`;
const saveBill = safe(async (print) => { const b = await A.saveBill({ items: cart.filter(i => i.qty > 0), mobile: $("#bMobile").value.trim(), mode: $("#bMode").value }); lastBill = b; cart = []; renderCart(); toast("Bill " + b.no + " save ✅"); if (print) { $("#print-area").innerHTML = receipt(b); setTimeout(() => print && window.print(), 80); } return b; });
$("#bSave").onclick = () => saveBill(true);
$("#bWa").onclick = safe(async () => { const m = $("#bMobile").value.replace(/\D/g, ""); const b = await saveBill(false); if (!b) return; window.open(`https://wa.me/${m ? "91" + m.slice(-10) : ""}?text=${encodeURIComponent(`Shree Ram Dairy\nBill ${b.no}\n${b.items.map(i => `${i.name} x${i.qty} = ₹${i.rate * i.qty}`).join("\n")}\nकुल: ₹${b.total}`)}`, "_blank", "noopener"); });
function renderBills() {
  const l = Object.values(S.bills).sort((a, b) => b.at - a.at).slice(0, 15);
  $("#billList").innerHTML = l.map(b => `<div class="clickable" data-bill="${esc(b.no)}"><span><b>${esc(b.no)}</b> <small class="muted">${esc(b.day)} • ${esc(b.mode)}</small></span><b>${inr(b.total)} ➔</b></div>`).join("") || "<p class='muted'>अभी कोई bill नहीं</p>";
}
document.addEventListener("click", e => {
  const r = e.target.closest("[data-bill]");
  if (r) {
    const b = S.bills[r.dataset.bill];
    if (b) showBillModal(b);
  }
});

function showBillModal(b) {
  sheet(`<h2>Bill #${esc(b.no)}</h2><small class="muted">तारीख: ${esc(b.day)} • माध्यम: <b>${esc(b.mode)}</b></small>
  ${b.mobile ? `<div class="muted" style="margin-top:4px">ग्राहक मोबाइल: 📞 ${esc(b.mobile)}</div>` : ""}
  <div class="list" style="margin-top:14px">
    ${(b.items || []).map(i => `<div style="cursor:default"><span>${esc(i.name)} x ${i.qty}</span><b>${inr(i.rate * i.qty)}</b></div>`).join("")}
  </div>
  <div class="total" style="margin-top:10px">कुल योग <b>${inr(b.total)}</b></div>
  <div class="actions" style="margin-top:14px">
    <button class="btn" id="bPrn">🖨️ Print Receipt</button>
    ${b.mobile ? `<a class="btn soft" style="text-decoration:none;text-align:center" href="https://wa.me/91${b.mobile.replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(`Shree Ram Dairy\nBill ${b.no}\n${b.items.map(i => `${i.name} x${i.qty} = ₹${i.rate * i.qty}`).join('\n')}\nकुल: ₹${b.total}`)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
    <button class="btn ghost" id="xS">बंद करें</button>
  </div>`);
  $("#bPrn").onclick = () => { $("#print-area").innerHTML = receipt(b); window.print(); };
  $("#xS").onclick = closeSheet;
}
renderCart();

/* ---------- stock ---------- */
function renderStock() {
  $("#stockList").innerHTML = Object.values(S.stock).map(s => `<div class="clickable" data-edit="${esc(s.name)}|${s.qty}|${s.min}"><span><b>${esc(s.name)}</b></span><span class="pill ${s.qty <= s.min ? "low" : ""}">${s.qty}${s.qty <= s.min ? " • कम!" : ""} ➔</span></div>`).join("") || "<p class='muted'>Stock खाली है</p>";
}
document.addEventListener("click", e => { const d = e.target.closest("[data-edit]"); if (d) { const [n, q, m] = d.dataset.edit.split("|"); $("#sName").value = n; $("#sQty").value = q; $("#sMin").value = m; toast("Item चुना गया: " + n); } });
$("#sSave").onclick = safe(async () => { const n = $("#sName").value.trim(); if (!n) throw Error("Item नाम डालें"); await A.setStock(n, +$("#sQty").value || 0, +$("#sMin").value || 0); toast("Stock save ✅"); });

function renderMore() {
  const v = $("[data-view=more]");
  if (!v) return;
  v.innerHTML = `<div class="panel"><h2>और विकल्प (More)</h2>
    <div class="grid2">
      <div class="panel tilt stat clickable" id="mRates"><span>🥛</span><b>भाव सूची</b><small>Product Rates</small></div>
      <div class="panel tilt stat clickable" data-go="stock"><span>📦</span><b>Stock</b><small>इन्वेंट्री देखें</small></div>
      <div class="panel tilt stat clickable" data-go="money"><span>📊</span><b>मुनाफ़ा</b><small>खर्च व हिसाब</small></div>
      ${role.admin ? `<div class="panel tilt stat clickable" id="mBak"><span>💾</span><b>Backup</b><small>JSON Download</small></div>` : ""}
    </div>
  </div>`;
  if ($("#mRates")) $("#mRates").onclick = () => {
    sheet(`<h2>दूध व उत्पाद भाव</h2><small class="muted">श्री राम डेयरी - वर्तमान दर सूची</small>
    <div class="list" style="margin-top:14px">
      ${products().map(p => `<div style="cursor:default"><span><b>${esc(p.name)}</b></span><b style="color:var(--g)">${inr(p.rate)}</b></div>`).join("")}
    </div>
    <button class="btn ghost" id="xS">बंद करें</button>`);
    $("#xS").onclick = closeSheet;
  };
  if ($("#mBak")) $("#mBak").onclick = () => {
    const data = JSON.stringify(S, null, 2);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    a.download = `srd-backup-${A.today()}.json`;
    a.click();
    toast("Backup डाउनलोड हो गया ✅");
  };
}

/* ---------- money & reports ---------- */
function renderMoney() {
  const m = A.today().slice(0, 7), sales = Object.values(S.bills).filter(b => b.day.startsWith(m)).reduce((s, b) => s + b.total, 0);
  const ex = Object.entries(S.expenses).filter(([, e]) => e.day.startsWith(m));
  const spent = ex.reduce((s, [, e]) => s + e.amount, 0);
  $("#mProfit").textContent = role.admin ? inr(sales - spent) : inr(sales); $("#mSplit").textContent = role.admin ? `बिक्री ${inr(sales)} − खर्च ${inr(spent)}` : "इस महीने की बिक्री";
  $("#expList").innerHTML = ex.sort((a, b) => b[1].at - a[1].at).map(([id, e]) => `<div data-delexp="${id}"><span>${esc(e.title)}<br><small class="muted">${esc(e.day)}</small></span><b>${inr(e.amount)}</b></div>`).join("");
}
document.addEventListener("click", safe(async e => { const d = e.target.closest("[data-delexp]"); if (d && confirm("खर्च हटाएं?")) await A.delExpense(d.dataset.delexp); }));
$("#eSave").onclick = safe(async () => { const t = $("#eTitle").value.trim(), a = +$("#eAmt").value; if (!t || !(a > 0)) throw Error("खर्च और राशि डालें"); await A.addExpense({ title: t, amount: a, day: A.today() }); $("#eTitle").value = $("#eAmt").value = ""; toast("खर्च जुड़ गया ✅"); });
document.addEventListener("click", e => {
  const b = e.target.closest("[data-csv]"); if (!b) return; const k = b.dataset.csv;
  const rows = k === "customers" ? Object.values(S.customers).map(c => [c.id, c.name, c.mobile, c.type, c.litres, c.balance, c.due])
    : k === "bills" ? Object.values(S.bills).map(x => [x.no, x.day, x.total, x.mode, x.by]) : Object.values(S.expenses).map(x => [x.day, x.title, x.amount, x.by]);
  const csv = "\ufeff" + rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`).join(",")).join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `srd-${k}-${A.today()}.csv`; a.click();
});
