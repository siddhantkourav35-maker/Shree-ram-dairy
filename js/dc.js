// Tiny SQL Connect client (no build step needed): calls the connector's REST endpoint with the Firebase ID token.
import { auth } from "./api.js";
import cfg from "./firebase-config.js";
const LOCATION = "asia-south1", SERVICE = "shree-ram-dairy", CONNECTOR = "dairy"; // must match dataconnect.yaml / connector.yaml
const BASE = `https://firebasedataconnect.googleapis.com/v1/projects/${cfg.projectId}/locations/${LOCATION}/services/${SERVICE}/connectors/${CONNECTOR}`;

async function call(kind, operationName, variables = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth.currentUser) headers.Authorization = "Bearer " + await auth.currentUser.getIdToken();
  const r = await fetch(`${BASE}:execute${kind}`, { method: "POST", headers, body: JSON.stringify({ operationName, variables }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors?.length) throw Error(j.errors?.[0]?.message || j.error?.message || "Database error " + r.status);
  return j.data;
}
export const query = (name, vars) => call("Query", name, vars);
export const mutate = (name, vars) => call("Mutation", name, vars);

/* Example — what the app's api.js calls become:
   const { customers } = await query("SearchCustomers", { q: "ram" });
   await mutate("DeliverMilkPrepaid", { code: "SRD-001", litres: 1, amount: 70 });   // atomic: balance + ledger, or error
   const { customers: [c] } = await query("PortalByToken", { token });               // public page (no login needed)
*/
