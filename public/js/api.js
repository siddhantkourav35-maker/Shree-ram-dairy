// ===== Backend layer: every read/write goes through here (Auth + Realtime DB, Spark/free plan) =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail }
  from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getDatabase, ref, get, set, update, push, remove, onValue, runTransaction, query,
  orderByChild, limitToLast, child } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import cfg from "./firebase-config.js";

export const app = initializeApp(cfg), auth = getAuth(app), db = getDatabase(app);
export const onAuth = cb => onAuthStateChanged(auth, cb);
export const login = (e, p) => signInWithEmailAndPassword(auth, e, p);
export const logout = () => signOut(auth);
export const resetPassword = e => sendPasswordResetEmail(auth, e);

export const DEFAULT_PRODUCTS = [
  { name: "दूध (Milk) 1L", rate: 70 }, { name: "दही (Curd) 500g", rate: 40 },
  { name: "पनीर (Paneer) 250g", rate: 100 }, { name: "घी (Ghee) 500g", rate: 350 },
  { name: "छाछ (Buttermilk) 1L", rate: 20 }
]; // Owner can override in settings/products

const round = n => Math.round(n * 100) / 100;
export const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const me = () => auth.currentUser?.email || "unknown";
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), b => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");

export const watch = (path, cb) => onValue(ref(db, path), s => cb(s.val() || {}));
export const watchBills = cb => onValue(query(ref(db, "bills"), orderByChild("day"), limitToLast(400)), s => cb(s.val() || {}));
export const watchExpenses = cb => onValue(query(ref(db, "expenses"), orderByChild("day"), limitToLast(400)), s => cb(s.val() || {}));

export async function loadRole(uid) {
  const [s, a] = await Promise.all([get(ref(db, "staff/" + uid)), get(ref(db, "admins/" + uid))]);
  return { staff: s.val() === true || a.val() === true, admin: a.val() === true };
}

// QR can hold a portal URL (?t=token), a bare token, or a customer ID
export async function resolveCustomer(text) {
  let t = String(text || "").trim(), id = null;
  try { const q = new URL(t).searchParams.get("t"); if (q) t = q; } catch {}
  if (/^[a-z2-9]{12}$/.test(t)) { const s = await get(ref(db, "tokens/" + t)); id = s.val(); }
  else id = t.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (!id) return null;
  const s = await get(ref(db, "customers/" + id));
  return s.exists() ? s.val() : null;
}

async function mirror(c) { // public, read-only snapshot for the customer portal (keyed by unguessable token)
  await set(ref(db, "portal/" + c.token), { name: c.name, type: c.type, litres: c.litres || 0,
    balance: c.balance || 0, due: c.due || 0, updatedAt: Date.now() });
}

export async function createCustomer({ id, name, mobile, type, litres, rate }) {
  if (!id || !name) throw Error("ID और नाम ज़रूरी है");
  if ((await get(ref(db, "customers/" + id))).exists()) throw Error("यह ID पहले से मौजूद है");
  const c = { id, name, mobile: mobile || "", type, token: token(), litres: type === "prepaid" ? litres : 0,
    balance: type === "prepaid" ? round(litres * rate) : 0, due: 0, createdAt: Date.now(), updatedAt: Date.now() };
  await set(ref(db, "customers/" + id), c);
  await set(ref(db, "tokens/" + c.token), id);
  await mirror(c);
  return c;
}

export const updateCustomer = (id, patch) => update(ref(db, "customers/" + id), { ...patch, updatedAt: Date.now() });
export async function deleteCustomer(c) {
  await remove(ref(db, "portal/" + c.token)); await remove(ref(db, "tokens/" + c.token)); await remove(ref(db, "customers/" + c.id));
}

// kind: milk | recharge | payment — transaction prevents negative balance / double-spend from two phones
export async function adjust(id, { kind, litres = 0, amount = 0, note = "" }) {
  if (!(amount > 0) && !(litres > 0)) throw Error("सही मात्रा डालें");
  const r = ref(db, "customers/" + id);
  const res = await runTransaction(r, c => {
    if (!c) return c;
    if (kind === "milk") {
      if (c.type === "monthly") c.due = round((c.due || 0) + amount);
      else { if ((c.litres || 0) + 1e-9 < litres || (c.balance || 0) + .009 < amount) return; // abort
        c.litres = round(c.litres - litres); c.balance = round(Math.max(0, c.balance - amount)); }
    } else if (kind === "recharge") { c.litres = round((c.litres || 0) + litres); c.balance = round((c.balance || 0) + amount); }
    else if (kind === "payment") c.due = round(Math.max(0, (c.due || 0) - amount));
    c.updatedAt = Date.now(); return c;
  });
  if (!res.committed) throw Error("Prepaid balance काफ़ी नहीं है");
  const c = res.snapshot.val();
  await set(push(ref(db, "logs/" + id)), { kind, litres, amount, note, by: me(), at: Date.now() }); // immutable audit trail
  await mirror(c);
  return c;
}

export async function history(id) {
  const s = await get(query(ref(db, "logs/" + id), orderByChild("at"), limitToLast(25)));
  const a = []; s.forEach(x => a.push(x.val())); return a.reverse();
}

export async function saveBill({ items, customerId = "", mobile = "", mode = "Cash" }) {
  if (!items.length) throw Error("Bill में कोई item नहीं है");
  const total = round(items.reduce((s, i) => s + i.rate * i.qty, 0));
  const n = await runTransaction(ref(db, "meta/billCounter"), v => (v || 0) + 1);
  const no = "B" + String(n.snapshot.val()).padStart(5, "0");
  const bill = { no, items, total, customerId, mobile, mode, day: today(), by: me(), at: Date.now() };
  await set(ref(db, "bills/" + no), bill);
  for (const i of items) { // best-effort stock deduction for tracked items
    const k = i.name.replace(/[.#$/\[\]]/g, "_");
    await runTransaction(ref(db, `stock/${k}`), s => s ? { ...s, qty: round(Math.max(0, (s.qty || 0) - i.qty)), updatedAt: Date.now() } : s);
  }
  return bill;
}
export const deleteBill = no => remove(ref(db, "bills/" + no));

export const setStock = (name, qty, min = 0) => set(ref(db, "stock/" + name.replace(/[.#$/\[\]]/g, "_")),
  { name, qty: Number(qty), min: Number(min), updatedAt: Date.now() });
export const addExpense = e => set(push(ref(db, "expenses")), { ...e, by: me(), at: Date.now() });
export const delExpense = id => remove(ref(db, "expenses/" + id));
export const saveProducts = list => set(ref(db, "settings/products"), list);
