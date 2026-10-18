import * as P from "./print.js";
let C, PR = {}, rec = {}, sid = "", cur = {};
const daysIn = m => new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate();
function calc() {
  const sal = Number(rec.meta?.salary ?? PR[sid]?.salary ?? 0), pd = sal / daysIn(C.$("#stMonth").value), es = Object.entries(rec.entries || {});
  const n = t => es.filter(([, e]) => e.type === t).length, sum = t => es.filter(([, e]) => e.type === t).reduce((s, [, e]) => s + e.amount, 0);
  const ab = n("absent"), half = n("half"), adv = sum("advance"), prod = sum("product"), ded = pd * (ab + half / 2);
  return { sal, pd, ab, half, adv, prod, ded, net: sal - ded - adv - prod, es };
}
export function init(ctx) {
  C = ctx; if (!C.role.admin) return; const v = C.$("[data-view=staff]");
  if (!v.dataset.ready) {
    v.dataset.ready = 1; const m = C.A.today().slice(0, 7);
    v.innerHTML = `<div class="panel"><h2>👷 Staff Ledger</h2><div class="row"><select id="stSel"></select><input id="stMonth" type="month" value="${m}"></div>
    <div id="stNew" hidden><input id="nsName" placeholder="Staff का नाम"><input id="nsMob" inputmode="tel" placeholder="मोबाइल"><div class="row"><input id="nsSal" type="number" placeholder="मासिक salary ₹"><input id="nsStart" type="date"></div><button class="btn" id="nsSave">Staff जोड़ें</button></div></div>
    <div class="panel" id="stBody"></div>`;
    C.$("#stSel").onchange = () => { C.$("#stNew").hidden = C.$("#stSel").value !== "+"; load(); }; C.$("#stMonth").onchange = load;
    C.$("#nsSave").onclick = C.safe(async () => { const name = C.$("#nsName").value.trim(), salary = +C.$("#nsSal").value; if (!name || !(salary > 0)) throw Error("नाम और salary भरें"); const id = C.A.newStaffId(); await C.A.saveStaff(id, { name, mobile: C.$("#nsMob").value.trim(), salary, startDate: C.$("#nsStart").value, createdAt: Date.now() }); sid = id; C.toast("Staff जुड़ गया ✅"); C.$("#nsName").value = C.$("#nsSal").value = ""; });
    v.addEventListener("click", C.safe(async e => {
      const b = e.target.closest("[data-sa]"); if (!b || !sid) return; const a = b.dataset.sa, m = C.$("#stMonth").value, day = C.$("#stDay").value || C.A.today();
      const add = async (e2) => { await C.A.addStaffEntry(sid, m, e2, PR[sid].salary); await load(); };
      if (a === "absent" || a === "half") await add({ type: a, day });
      if (a === "adv") { const x = +C.$("#stAdv").value; if (!(x > 0)) throw Error("राशि डालें"); await add({ type: "advance", day, amount: x, note: C.$("#stAdvN").value }); }
      if (a === "prod") { const p = C.products()[C.$("#stProd").value], q = +C.$("#stQty").value; if (!p || !(q > 0)) throw Error("Product/Qty चुनें"); await add({ type: "product", day, amount: p.rate * q, note: `${p.name} x${q}` }); }
      if (a === "del" && confirm("Entry हटाएं?")) { await C.A.delStaffEntry(sid, m, b.dataset.id); await load(); }
      const lines = () => P.salaryLines(PR[sid].name, m, calc());
      if (a === "png") await P.png(lines(), `salary-${PR[sid].name}-${m}`); if (a === "pdf") await P.pdf(lines(), `salary-${PR[sid].name}-${m}`); if (a === "print") await P.print(lines());
      if (a === "csv") csv();
    }));
  }
  C.unsubs.push(C.A.watch("staffProfiles", d => { PR = d; const o = Object.entries(PR).map(([k, p]) => `<option value="${k}">${C.esc(p.name)}</option>`).join(""); C.$("#stSel").innerHTML = o + `<option value="+">➕ नया Staff</option>`; if (!sid || !PR[sid]) sid = Object.keys(PR)[0] || "+"; C.$("#stSel").value = sid; C.$("#stNew").hidden = sid !== "+"; load(); }));
}
async function load() {
  sid = C.$("#stSel").value; const body = C.$("#stBody");
  if (!sid || sid === "+" || !PR[sid]) { body.innerHTML = "<p class='muted'>Staff चुनें या नया जोड़ें</p>"; return; }
  rec = await C.A.staffMonth(sid, C.$("#stMonth").value); cur = calc(); const s = cur, today = C.A.today();
  body.innerHTML = `<h3>${C.esc(PR[sid].name)} <small class="muted">salary ${C.inr(s.sal)} • ${C.inr(s.pd)}/दिन</small></h3>
  <div class="grid2"><div class="panel stat"><b>${s.ab}+${s.half}/2</b><small>Absent + आधा दिन</small></div><div class="panel stat"><b>${C.inr(s.adv + s.prod)}</b><small>Advance + दूध/सामान</small></div></div>
  <div class="panel hero"><small class="muted">Net देय</small><div class="big">${C.inr(s.net)}</div></div>
  <input id="stDay" type="date" value="${today}"><div class="actions"><button class="btn soft" data-sa="absent">गैरहाज़िर</button><button class="btn soft" data-sa="half">आधा दिन</button></div>
  <div class="row"><input id="stAdv" type="number" placeholder="Advance ₹"><input id="stAdvN" placeholder="Note"><button class="btn" data-sa="adv">+ Advance</button></div>
  <div class="row"><select id="stProd">${C.products().map((p, i) => `<option value="${i}">${C.esc(p.name)}</option>`).join("")}</select><input id="stQty" type="number" step=".25" value="1"><button class="btn" data-sa="prod">+ सामान</button></div>
  <div class="list">${s.es.sort((a, b) => b[1].day.localeCompare(a[1].day)).map(([id, e]) => `<div style="cursor:default"><span>${{ absent: "गैरहाज़िर", half: "आधा दिन", advance: "Advance", product: "सामान" }[e.type]}<br><small class="muted">${C.esc(e.day)} ${C.esc(e.note || "")}</small></span><span>${e.amount ? C.inr(e.amount) : ""} <button class="icon" data-sa="del" data-id="${id}">🗑️</button></span></div>`).join("") || "<p class='muted'>इस महीने कोई entry नहीं</p>"}</div>
  <div class="actions"><button class="btn soft" data-sa="print">🖨️ Slip</button><button class="btn soft" data-sa="pdf">PDF</button><button class="btn soft" data-sa="png">PNG</button><button class="btn soft" data-sa="csv">CSV</button></div>`;
}
function csv() {
  const rows = [["date", "type", "amount", "note"], ...cur.es.map(([, e]) => [e.day, e.type, e.amount || "", e.note || ""]), [], ["Net", Math.round(cur.net)]];
  const t = "\ufeff" + rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`).join(",")).join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([t], { type: "text/csv" })); a.download = `staff-${PR[sid].name}-${C.$("#stMonth").value}.csv`; a.click();
}
