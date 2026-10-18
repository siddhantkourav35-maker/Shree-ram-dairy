// Animated scroll: reveal-on-scroll (staggered), scroll progress bar, parallax variable, shrinking top bar, auto-hiding dock.
const root = document.documentElement, $ = (s) => document.querySelector(s);
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
const SEL = ".view > .panel, .view .grid2 > .panel, .view .actions, #stBody > *";
const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.08, rootMargin: "0px 0px -6% 0px" });
function scan(scope = document) {
  scope.querySelectorAll?.(SEL).forEach((el, i) => {
    if (el.classList.contains("rv")) return; el.classList.add("rv"); el.style.setProperty("--i", i % 6);
    calm ? el.classList.add("in") : io.observe(el);
  });
}
new MutationObserver((ms) => ms.forEach((m) => {
  if (m.type === "attributes") { const v = m.target; if (v.matches?.(".view") && !v.hidden && !calm) v.querySelectorAll(".rv").forEach((el) => { el.classList.remove("in"); io.observe(el); }); return; }
  m.addedNodes.forEach((n) => { if (n.nodeType === 1) { n.matches?.(SEL) && scan(n.parentNode); scan(n); } });
})).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
scan();

let tick = false, last = 0;
addEventListener("scroll", () => {
  if (tick) return; tick = true;
  requestAnimationFrame(() => {
    tick = false; const y = scrollY, max = root.scrollHeight - innerHeight;
    root.style.setProperty("--sy", y); root.style.setProperty("--prog", max > 0 ? Math.min(1, y / max) : 0);
    $(".topbar")?.classList.toggle("shrunk", y > 24);
    if (Math.abs(y - last) > 8) { $(".dock")?.classList.toggle("hide", y - last > 0 && y > 140 && max - y > 80); last = y; }
  });
}, { passive: true });
