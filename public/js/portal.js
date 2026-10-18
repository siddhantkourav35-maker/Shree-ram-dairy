import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getDatabase, ref, get, set, push, onValue } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import cfg from "./firebase-config.js";

const app = initializeApp(cfg);
const auth = getAuth(app);
const db = getDatabase(app);

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = n => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
const Lt = n => +Number(n || 0).toFixed(2) + " L";

function toast(t, err) {
  const e = document.createElement("div");
  e.className = "toast" + (err ? " err" : "");
  e.textContent = t;
  $("#toasts").append(e);
  setTimeout(() => e.remove(), 3200);
}

// Global Customer State
let currentToken = null;
let currentCust = null;
let orderCart = {};
let unsubPortal = null;

const PRODUCTS = [
  { id: "p1", name: "शुद्ध ताजा दूध (Milk)", icon: "🥛", unit: "1 L", rate: 70 },
  { id: "p2", name: "ताजा मीठा दही (Curd)", icon: "🥣", unit: "500g", rate: 40 },
  { id: "p3", name: "मलाई पनीर (Paneer)", icon: "🧀", unit: "250g", rate: 100 },
  { id: "p4", name: "देसी दानेदार घी (Ghee)", icon: "🧈", unit: "500g", rate: 350 },
  { id: "p5", name: "ताजा मसाला छाछ (Chhach)", icon: "🥤", unit: "1 L", rate: 20 }
];

/* ---------- THEME TOGGLE ---------- */
if (localStorage.theme) document.documentElement.dataset.theme = localStorage.theme;
$("#cThemeBtn").onclick = () => {
  const d = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = d;
  localStorage.theme = d;
};

/* ---------- MODAL SHEET HELPERS ---------- */
function openSheet(html) {
  $("#cSheet").innerHTML = html;
  $("#cSheet").hidden = $("#cBackdrop").hidden = false;
  $("#cSheet").style.display = "block";
  $("#cBackdrop").style.display = "block";
}
function closeSheet() {
  $("#cSheet").hidden = $("#cBackdrop").hidden = true;
  $("#cSheet").style.display = "none";
  $("#cBackdrop").style.display = "none";
}
$("#cBackdrop").onclick = closeSheet;

/* ---------- LOGIN TAB SWITCHING ---------- */
$("#tabId").onclick = () => switchLoginTab("id");
$("#tabEmail").onclick = () => switchLoginTab("email");
$("#tabDemo").onclick = () => switchLoginTab("demo");

function switchLoginTab(tab) {
  $("#tabId").classList.toggle("active", tab === "id");
  $("#tabEmail").classList.toggle("active", tab === "email");
  $("#tabDemo").classList.toggle("active", tab === "demo");
  $("#formById").style.display = tab === "id" ? "block" : "none";
  $("#formByEmail").style.display = tab === "email" ? "block" : "none";
  $("#demoAccounts").style.display = tab === "demo" ? "block" : "none";
}

const safeKey = s => String(s || "").trim().replace(/[.#$/\[\]]/g, "_");

async function findCustomerToken(query) {
  const clean = String(query || "").trim();
  if (!clean) return null;

  // 1. Try uppercase sanitized (handles ID like SRD-001 or email)
  const safeUpper = safeKey(clean.toUpperCase());
  if (safeUpper) {
    try {
      const snap = await get(ref(db, "customer_lookup/" + safeUpper));
      if (snap.val()) return snap.val();
    } catch (e) {}
  }

  // 2. Try lowercase sanitized (for email ramesh@shreeramdairy_com)
  const safeLower = safeKey(clean.toLowerCase());
  if (safeLower) {
    try {
      const snap = await get(ref(db, "customer_lookup/" + safeLower));
      if (snap.val()) return snap.val();
    } catch (e) {}
  }

  // 3. Try pure digits (for phone 9826123456 or last 10 digits)
  const digits = clean.replace(/\D/g, "");
  if (digits) {
    try {
      const snap = await get(ref(db, "customer_lookup/" + digits));
      if (snap.val()) return snap.val();
      if (digits.length > 10) {
        const snap10 = await get(ref(db, "customer_lookup/" + digits.slice(-10)));
        if (snap10.val()) return snap10.val();
      }
    } catch (e) {}
  }

  // 4. Try padded ID (if user typed "1" or "001")
  const num = parseInt(digits, 10);
  if (!isNaN(num) && num > 0 && num < 1000) {
    try {
      const snapPadded = await get(ref(db, "customer_lookup/SRD-" + String(num).padStart(3, "0")));
      if (snapPadded.val()) return snapPadded.val();
    } catch (e) {}
  }

  return null;
}

/* ---------- LOGIN HANDLERS ---------- */
// 1. By ID, Mobile, or Email
$("#formById").onsubmit = async e => {
  e.preventDefault();
  const input = $("#custIdOrMob").value.trim();
  const pin = $("#custPin").value.trim();
  if (!input) return toast("Customer ID, मोबाइल या ईमेल डालें", 1);

  try {
    toast("जाँच हो रही है…");
    const token = await findCustomerToken(input);
    if (!token) throw new Error("ग्राहक नहीं मिला। सही ID (उदा. SRD-001) या मोबाइल डालें।");

    // PIN check (1234 or Password@123)
    if (pin && pin !== "1234" && pin !== "Password@123") {
      throw new Error("गलत PIN। डिफ़ॉल्ट PIN 1234 डालें।");
    }

    loginWithToken(token);
  } catch (err) {
    toast(err.message, 1);
  }
};

// 2. By Firebase Auth Email/Password
$("#formByEmail").onsubmit = async e => {
  e.preventDefault();
  const email = $("#cEmail").value.trim();
  const pass = $("#cPass").value;
  try {
    toast("लॉगिन हो रहा है…");
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    let token = null;

    try {
      const snap = await get(ref(db, "customer_lookup/" + cred.user.uid));
      token = snap.val();
    } catch (e) {}

    if (!token) {
      token = await findCustomerToken(email);
    }

    if (token) {
      loginWithToken(token);
    } else {
      throw new Error("यह खाता किसी ग्राहक से लिंक नहीं है।");
    }
  } catch (err) {
    toast(err.message, 1);
  }
};

// 3. Demo 1-Click Buttons
$$(".demo-btn").forEach(btn => {
  btn.onclick = () => {
    loginWithToken(btn.dataset.c);
  };
});

// Logout
$("#cLogoutBtn").onclick = () => {
  if (unsubPortal) unsubPortal();
  currentToken = null;
  currentCust = null;
  localStorage.removeItem("srd_customer_token");
  signOut(auth).catch(() => {});
  $("#cApp").style.display = "none";
  $("#cLogin").style.display = "grid";
  toast("लॉगआउट हो गया ✅");
};

/* ---------- ATTACH REALTIME CUSTOMER PORTAL ---------- */
function loginWithToken(token) {
  currentToken = token;
  localStorage.setItem("srd_customer_token", token);

  toast("स्वागत है! लोड हो रहा है…");
  $("#cLogin").style.display = "none";
  $("#cApp").style.display = "block";

  if (unsubPortal) unsubPortal();

  // Realtime subscription to customer data
  unsubPortal = onValue(ref(db, "portal/" + token), snap => {
    const data = snap.val();
    if (!data) {
      toast("ग्राहक डेटा नहीं मिला", 1);
      return;
    }
    currentCust = data;
    renderCustomerApp(data);
  });
}

/* ---------- RENDER CUSTOMER PORTAL ---------- */
function renderCustomerApp(c) {
  const isMonthly = c.type === "monthly";

  // Topbar
  $("#cWho").textContent = `${c.name} (${c.id || "SRD"})`;

  // Hero Card
  $("#heroBadge").textContent = isMonthly ? "Monthly खाता (महीने का बिल)" : "Prepaid दूध कार्ड";
  $("#heroBadge").className = "badge " + (isMonthly ? "monthly" : (c.litres <= 2 ? "low" : "prepaid"));
  $("#cName").textContent = c.name;
  $("#cIdMobile").textContent = `${c.id || "-"} • 📞 ${c.mobile || "-"}`;

  if (isMonthly) {
    $("#heroLabel").textContent = "इस महीने का बकाया बिल";
    $("#heroValue").textContent = inr(c.due || 0);
    $("#heroSubValue").textContent = `दैनिक कोटा: ${c.dailyQuota || 1.5} L/दिन`;
    $("#heroDaily").textContent = `भाव: ₹${c.rate || 70}/L`;
  } else {
    $("#heroLabel").textContent = "उपलब्ध बाकी दूध (Remaining)";
    $("#heroValue").textContent = Lt(c.litres || 0);
    $("#heroSubValue").textContent = `खाता बैलेंस: ${inr(c.balance || 0)}`;
    const daysLeft = c.dailyQuota ? Math.floor((c.litres || 0) / c.dailyQuota) : 0;
    $("#heroDaily").textContent = daysLeft > 0 ? `~${daysLeft} दिन चलेगा (${c.dailyQuota || 1.5}L/दिन)` : "दूध समाप्त!";
  }

  // Today's Delivery Status Card
  const todayDel = (c.deliveries || [])[0];
  if (todayDel && (todayDel.date.includes("आज") || todayDel.date.includes(new Date().getDate().toString()))) {
    $("#todayStatusTitle").textContent = `आज का दूध प्राप्त हुआ (${todayDel.litres} L) ✅`;
    $("#todayStatusDesc").textContent = `${todayDel.time} पर डिलीवर किया गया • ${todayDel.notes || "ताजा दूध"}`;
    $("#todayStatusBadge").textContent = "Delivered";
    $("#todayStatusBadge").className = "badge success";
  } else {
    $("#todayStatusTitle").textContent = "आज का दूध: डिलीवरी में है 🚚";
    $("#todayStatusDesc").textContent = `दैनिक कोटा: ${c.dailyQuota || 1.5} L • अनुमानित समय: 07:00 AM`;
    $("#todayStatusBadge").textContent = "Scheduled";
    $("#todayStatusBadge").className = "badge prepaid";
  }

  // WhatsApp quick button
  const waMsg = encodeURIComponent(`नमस्ते श्री राम डेयरी, मैं ग्राहक ${c.name} (ID: ${c.id}). मुझे दूध आपूर्ति के बारे में बात करनी है।`);
  $("#btnQuickWa").href = `https://wa.me/919826123456?text=${waMsg}`;

  // Recent delivery list (preview on Home)
  const delList = c.deliveries || [];
  $("#recentDeliveryList").innerHTML = delList.slice(0, 3).map(d => `
    <div class="delivery-item">
      <div class="d-icon">🥛</div>
      <div class="d-info">
        <b>${esc(d.date)} • ${d.litres} L</b>
        <small>${esc(d.time)} • ${esc(d.notes || "दैनिक वितरण")}</small>
      </div>
      <span class="badge success">सफल</span>
    </div>
  `).join("") || "<p class='muted'>अभी कोई वितरण दर्ज नहीं</p>";

  // Full Diary Delivery List
  $("#fullDeliveryList").innerHTML = delList.map(d => `
    <div class="delivery-item">
      <div class="d-icon">🥛</div>
      <div class="d-info">
        <b>${esc(d.date)} — ${d.litres} Litre</b>
        <small>${esc(d.time)} • वितरित द्वारा: ${esc(d.by || "डेयरी स्टाफ")}</small>
      </div>
      <span class="badge success">प्राप्त हुआ</span>
    </div>
  `).join("") || "<p class='muted'>कोई वितरण इतिहास उपलब्ध नहीं</p>";

  const totalLitres = delList.reduce((s, d) => s + (Number(d.litres) || 0), 0);
  $("#diaryTotalL").textContent = Lt(totalLitres);
  $("#diaryDays").textContent = delList.length + " दिन";

  // Bills & Payment Tab
  if (isMonthly) {
    $("#billStatLabel").textContent = "कुल बकाया राशि (Payable Amount)";
    $("#billStatValue").textContent = inr(c.due || 0);
    $("#billStatDesc").textContent = (c.due || 0) > 0 ? "कृपया महीने के बिल का भुगतान करें।" : "कोई बकाया नहीं है। खाता चुकता है।";
  } else {
    $("#billStatLabel").textContent = "उपलब्ध बैलेंस (Prepaid Balance)";
    $("#billStatValue").textContent = inr(c.balance || 0);
    $("#billStatDesc").textContent = `शेष दूध: ${Lt(c.litres || 0)} (${inr(c.rate || 70)}/L)`;
  }

  // Statement list
  $("#statementList").innerHTML = `
    <div style="display:flex;justify-content:space-between;padding:12px 4px;border-bottom:1px solid var(--edge)">
      <span>दैनिक दूध कोटा</span>
      <b>${c.dailyQuota || 1.5} L/दिन</b>
    </div>
    <div style="display:flex;justify-content:space-between;padding:12px 4px;border-bottom:1px solid var(--edge)">
      <span>दूध का भाव</span>
      <b>₹${c.rate || 70}/Litre</b>
    </div>
    <div style="display:flex;justify-content:space-between;padding:12px 4px;border-bottom:1px solid var(--edge)">
      <span>खाता प्रकार</span>
      <b>${isMonthly ? "Monthly (मासिक बिल)" : "Prepaid (प्रीपेड)"}</b>
    </div>
    <div style="display:flex;justify-content:space-between;padding:12px 4px">
      <span>खाता शुरू तिथि</span>
      <b>${c.joined || "01 Oct 2026"}</b>
    </div>
  `;

  // Digital Pass Setup
  $("#passName").textContent = c.name;
  $("#passBadge").textContent = isMonthly ? "Monthly Member" : "Prepaid Card";
  $("#passBadge").className = "badge " + (isMonthly ? "monthly" : "prepaid");
  $("#passMeta").textContent = `ID: ${c.id || "-"} • 📞 ${c.mobile || "-"}`;

  const qrBox = $("#passQr");
  qrBox.innerHTML = "";
  if (window.QRCode) {
    new QRCode(qrBox, {
      text: c.id || c.token,
      width: 170,
      height: 170,
      colorDark: "#0b7a5b",
      colorLight: "#ffffff"
    });
  }

  renderProductCatalog();
}

/* ---------- PRODUCT CATALOG & CART ---------- */
function renderProductCatalog() {
  $("#productGrid").innerHTML = PRODUCTS.map(p => {
    const qty = orderCart[p.id]?.qty || 0;
    return `
      <div class="prod-card">
        <div>
          <div class="icon">${p.icon}</div>
          <h4>${esc(p.name)}</h4>
          <small class="muted">${p.unit}</small>
          <div class="price">${inr(p.rate)}</div>
        </div>
        <div style="display:flex;justify-content:center;align-items:center;gap:6px">
          ${qty > 0 ? `
            <button class="btn soft" style="padding:6px 12px;border-radius:10px" onclick="window.updateCart('${p.id}', -1)">−</button>
            <b>${qty}</b>
            <button class="btn" style="padding:6px 12px;border-radius:10px" onclick="window.updateCart('${p.id}', 1)">+</button>
          ` : `
            <button class="btn soft" style="width:100%;padding:8px" onclick="window.updateCart('${p.id}', 1)">+ जोड़ें</button>
          `}
        </div>
      </div>
    `;
  }).join("");

  // Update Cart Box
  const items = Object.values(orderCart).filter(i => i.qty > 0);
  const total = items.reduce((s, i) => s + (i.rate * i.qty), 0);

  if (items.length > 0) {
    $("#orderCartBox").style.display = "block";
    $("#orderCartItems").innerHTML = items.map(i => `
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(0,0,0,.08)">
        <span>${esc(i.name)} × ${i.qty}</span>
        <b>${inr(i.rate * i.qty)}</b>
      </div>
    `).join("");
    $("#orderCartTotal").textContent = inr(total);
  } else {
    $("#orderCartBox").style.display = "none";
  }
}

window.updateCart = (pid, delta) => {
  const p = PRODUCTS.find(x => x.id === pid);
  if (!p) return;
  if (!orderCart[pid]) orderCart[pid] = { ...p, qty: 0 };
  orderCart[pid].qty += delta;
  if (orderCart[pid].qty <= 0) delete orderCart[pid];
  renderProductCatalog();
};

// Order submission
$("#btnSubmitOrder").onclick = async () => {
  const items = Object.values(orderCart).filter(i => i.qty > 0);
  if (!items.length) return toast("कृपया कम से कम एक आइटम चुनें", 1);
  if (!currentCust) return;

  const total = items.reduce((s, i) => s + (i.rate * i.qty), 0);
  const note = $("#orderNote").value.trim();

  try {
    toast("ऑर्डर भेजा जा रहा है…");
    const orderData = {
      customerId: currentCust.id,
      customerName: currentCust.name,
      customerMobile: currentCust.mobile,
      items,
      total,
      note,
      status: "New",
      at: Date.now(),
      day: new Date().toISOString().slice(0, 10)
    };
    await push(ref(db, "customer_orders"), orderData);

    orderCart = {};
    $("#orderNote").value = "";
    renderProductCatalog();

    openSheet(`
      <div style="text-align:center;padding:16px 8px">
        <div style="font-size:52px">🎉</div>
        <h2 style="font-family:'Rozha One',serif;margin:8px 0">ऑर्डर सफलतापूर्वक दर्ज हुआ!</h2>
        <p class="muted">श्री राम डेयरी को आपका ऑर्डर मिल गया है। यह आपकी अगली डिलीवरी के साथ पहुंचेगा।</p>
        <div style="background:var(--g2);border-radius:16px;padding:12px;margin:16px 0;text-align:left">
          ${items.map(i => `<div style="display:flex;justify-content:space-between"><span>${esc(i.name)} × ${i.qty}</span><b>${inr(i.rate * i.qty)}</b></div>`).join("")}
          <hr style="border:0;border-top:1px dashed var(--g);margin:8px 0">
          <div style="display:flex;justify-content:space-between"><b>कुल योग:</b><b style="color:var(--g)">${inr(total)}</b></div>
        </div>
        <button class="btn" style="width:100%" id="xOk">ठीक है</button>
      </div>
    `);
    $("#xOk").onclick = closeSheet;
  } catch (err) {
    toast(err.message, 1);
  }
};

/* ---------- QUICK ACTION MODALS ---------- */
// 1. Order Modal Shortcut
$("#btnQuickOrder").onclick = () => switchTab("viewOrder");

// 2. Vacation / Pause Milk Modal
$("#btnQuickPause").onclick = () => {
  if (!currentCust) return;
  openSheet(`
    <h2>⏸️ छुट्टी / दूध रोकें</h2>
    <small class="muted">यदि आप बाहर जा रहे हैं, तो डिलीवरी बंद करने की तारीख चुनें</small>
    <div style="margin-top:14px">
      <label style="font-size:13px;color:var(--mut)">कब से बंद करें:</label>
      <input id="pFrom" type="date" value="${new Date().toISOString().slice(0, 10)}">
      <label style="font-size:13px;color:var(--mut)">कब तक बंद रखें:</label>
      <input id="pTo" type="date">
      <input id="pReason" placeholder="कारण (उदा. शादी/छुट्टी पर बाहर जा रहे हैं)">
    </div>
    <div class="actions" style="margin-top:14px">
      <button class="btn" id="btnConfirmPause">अनुरोध भेजें ➔</button>
      <button class="btn ghost" id="xP">रद्द करें</button>
    </div>
  `);
  $("#xP").onclick = closeSheet;
  $("#btnConfirmPause").onclick = async () => {
    const from = $("#pFrom").value;
    const to = $("#pTo").value;
    if (!from || !to) return toast("तारीख चुनें", 1);
    try {
      await push(ref(db, "customer_requests"), {
        customerId: currentCust.id,
        customerName: currentCust.name,
        type: "PauseDelivery",
        from,
        to,
        reason: $("#pReason").value.trim(),
        at: Date.now()
      });
      closeSheet();
      toast("छुट्टी का अनुरोध दर्ज हो गया ✅");
    } catch (e) {
      toast(e.message, 1);
    }
  };
};

// 3. UPI Pay Modal
function openUpiModal() {
  if (!currentCust) return;
  const payAmt = currentCust.type === "monthly" ? (currentCust.due || 500) : 500;
  openSheet(`
    <h2>💳 ऑनलाइन भुगतान (UPI Pay)</h2>
    <small class="muted">Google Pay, PhonePe, Paytm या BHIM द्वारा सीधे भुगतान करें</small>
    <div style="margin-top:14px">
      <label style="font-size:13px;color:var(--mut)">भुगतान राशि (₹):</label>
      <input id="payInput" type="number" value="${payAmt}" min="10">
    </div>
    <div class="qrbox" id="upiQr" style="margin:14px auto"></div>
    <small class="muted" style="display:block;text-align:center">UPI ID: <b>shreeramdairy@upi</b></small>
    <div class="actions" style="margin-top:14px">
      <a class="btn" id="btnUpiApp" style="text-decoration:none;text-align:center" href="upi://pay?pa=shreeramdairy@upi&pn=Shree%20Ram%20Dairy&am=${payAmt}&cu=INR">UPI App से भुगतान करें ➔</a>
      <button class="btn ghost" id="xU">बंद करें</button>
    </div>
  `);
  const renderUpi = amt => {
    const box = $("#upiQr");
    box.innerHTML = "";
    const upiLink = `upi://pay?pa=shreeramdairy@upi&pn=Shree%20Ram%20Dairy&am=${amt}&cu=INR`;
    if (window.QRCode) new QRCode(box, { text: upiLink, width: 170, height: 170 });
    $("#btnUpiApp").href = upiLink;
  };
  renderUpi(payAmt);
  $("#payInput").oninput = e => renderUpi(+e.target.value || 100);
  $("#xU").onclick = closeSheet;
}

$("#btnQuickPay").onclick = openUpiModal;
$("#btnOpenUpiModal").onclick = openUpiModal;

// 4. Show Digital Pass
$("#btnShowPass").onclick = () => switchTab("viewPass");
$("#linkAllDeliveries").onclick = () => switchTab("viewDiary");

/* ---------- TAB NAVIGATION ---------- */
$$(".dock button").forEach(btn => {
  btn.onclick = () => switchTab(btn.dataset.tab);
});

function switchTab(tabId) {
  $$(".dock button").forEach(b => b.classList.toggle("on", b.dataset.tab === tabId));
  $$(".view").forEach(v => {
    v.style.display = v.id === tabId ? "block" : "none";
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- AUTO-LOGIN CHECK ON LOAD ---------- */
const urlToken = new URLSearchParams(location.search).get("t");
const storedToken = localStorage.getItem("srd_customer_token");

if (urlToken) {
  loginWithToken(urlToken);
} else if (storedToken) {
  loginWithToken(storedToken);
}
