// File store helpers: bytes go to Cloud Storage; the metadata row goes to SQL (RecordFile) so files can be listed/linked.
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import { app } from "./api.js";
import { mutate } from "./dc.js";
import { render } from "./print.js";
const storage = getStorage(app);

// Shrink phone photos before upload (saves storage + bandwidth): max 800px, JPEG 80%
export async function compressImage(file, max = 800, q = 0.8) {
  const img = new Image(), url = URL.createObjectURL(file); img.src = url; await img.decode(); URL.revokeObjectURL(url);
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, "image/jpeg", q));
}
export async function upload(path, blob, { kind, customerId = null, billId = null } = {}) {
  await uploadBytes(ref(storage, path), blob, { contentType: blob.type });
  await mutate("RecordFile", { storagePath: path, kind, contentType: blob.type, sizeBytes: blob.size, customerId, billId });
  return getDownloadURL(ref(storage, path));
}
export const url = path => getDownloadURL(ref(storage, path));
export const remove = path => deleteObject(ref(storage, path));

// Ready-made uploads (path convention matches storage.rules)
export const uploadCustomerPhoto = async (code, customerId, file) => upload(`customers/${code}/photo.jpg`, await compressImage(file), { kind: "customer_photo", customerId });
export async function uploadBillPdf(billNo, billId, lines) {                 // lines = P.billLines(bill)
  const c = await render(lines), mm = 58, h = c.height / c.width * mm, d = new window.jspdf.jsPDF({ unit: "mm", format: [mm, h] });
  d.addImage(c.toDataURL("image/png"), "PNG", 0, 0, mm, h);
  return upload(`bills/${billNo}.pdf`, d.output("blob"), { kind: "bill_pdf", billId });
}
export const uploadBackup = (json, day) => upload(`backups/${day}.json`, new Blob([JSON.stringify(json)], { type: "application/json" }), { kind: "backup" });
