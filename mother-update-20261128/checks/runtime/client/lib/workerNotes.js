// 특이사항 원문 전용 저장. 질문 자료와 /api/state에는 넣지 않는다.
const { createHash } = require("node:crypto");
const MAX_BYTES = 1500000;
const MAX_RECORDS = 6000;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;
const normalizeOrg = (s) => String(s || "").normalize("NFKC").replace(/\s+/g, "");
function invalid(message, code = "INVALID_NOTES") { throw Object.assign(new Error(message), { code }); }
function text(value, label, max, blank = false) {
  if (typeof value !== "string" || value.length > max || (!blank && !value.trim())) invalid(label + " 형식이 올바르지 않습니다");
  return value;
}
function id(value) { if (typeof value !== "string" || !ID.test(value)) invalid("자료 번호가 올바르지 않습니다"); return value; }
function validateMonth(month) { if (typeof month !== "string" || !MONTH.test(month)) invalid("월은 YYYY-MM 형식이어야 합니다"); return month; }
function koreanMonth(now) { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(now); }
// expiresAt is also used by other scheduling modules; retain that separate contract.
function expiresAt(month) { const [y, m] = month.split("-").map(Number); return Math.floor((Date.UTC(y, m - 1 + 12, 1) - 9 * 3600000) / 1000); }
function validDate(date, month) {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && date.startsWith(month + "-")
    && !Number.isNaN(Date.parse(date)) && new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date;
}
function validateImport(input, orgName, now = Date.now()) {
  if (!input || input.schemaVersion !== 1 || !Array.isArray(input.records) || input.records.length > MAX_RECORDS) invalid("자료 파일 형식 또는 기록 수가 올바르지 않습니다");
  const month = validateMonth(input.month);
  if (month > koreanMonth(now)) invalid("미래 월의 자료는 가져올 수 없습니다");
  if (!normalizeOrg(orgName) || normalizeOrg(input.orgName) !== normalizeOrg(orgName)) invalid("자료의 기관과 로그인한 기관이 다릅니다", "ORG_MISMATCH");
  if (typeof input.collectedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.collectedAt) || !Number.isFinite(Date.parse(input.collectedAt)) || Date.parse(input.collectedAt) > now + 300000) invalid("가져온 시각이 올바르지 않습니다");
  const seen = new Set();
  const workers = new Map();
  const recipients = new Map();
  const records = input.records.map((r) => {
    if (!r || typeof r !== "object" || !validDate(r.date, month)) invalid("기록 날짜가 선택한 월과 다르거나 올바르지 않습니다");
    const row = {
      id: id(r.id), date: r.date, time: text(r.time || "", "제공 시각", 20, true),
      workerId: id(r.workerId), workerName: text(r.workerName, "요양보호사 이름", 80),
      recipientId: id(r.recipientId), recipientName: text(r.recipientName, "어르신 이름", 80),
      identityVerified: r.identityVerified === true, note: text(r.note, "특이사항", 8000, true),
    };
    if (seen.has(row.id)) invalid("중복된 기록 번호가 있습니다");
    seen.add(row.id);
    if (recipients.has(row.recipientId) && recipients.get(row.recipientId) !== row.recipientName) invalid("어르신 식별정보가 서로 다릅니다");
    recipients.set(row.recipientId, row.recipientName);
    const previous = workers.get(row.workerId);
    if (previous && (previous.workerName !== row.workerName || previous.identityVerified !== row.identityVerified || (!row.identityVerified && previous.recipientId !== row.recipientId))) invalid("작성자 식별정보가 서로 다릅니다");
    workers.set(row.workerId, row);
    return row;
  });
  records.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
  const result = { schemaVersion: 1, month, orgName: text(orgName, "기관명", 120), collectedAt: input.collectedAt, records };
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_BYTES) invalid("자료 파일이 너무 큽니다");
  return result;
}
function snapshotDigest(snapshot) {
  const records = snapshot.records.map(r => ({ id:r.id, date:r.date, time:r.time, workerId:r.workerId, workerName:r.workerName,
    recipientId:r.recipientId, recipientName:r.recipientName, identityVerified:r.identityVerified === true, note:r.note }))
    .sort((a,b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
  return createHash('sha256').update(JSON.stringify({ schemaVersion:snapshot.schemaVersion, month:snapshot.month,
    orgName:snapshot.orgName, collectedAt:snapshot.collectedAt, records }), 'utf8').digest('hex');
}
function summary(snapshot) {
  const map = new Map();
  const recipients = new Map();
  for (const r of snapshot.records) {
    if (!map.has(r.workerId)) map.set(r.workerId, { id: r.workerId, name: r.workerName, identityVerified: r.identityVerified, recipientNames: new Set(), count: 0, noteCount: 0 });
    const w = map.get(r.workerId); w.recipientNames.add(r.recipientName); w.count++; if (r.note.trim()) w.noteCount++;
    if (!recipients.has(r.recipientId)) recipients.set(r.recipientId, { id: r.recipientId, name: r.recipientName, count: 0 });
    recipients.get(r.recipientId).count++;
  }
  const workers = [...map.values()].map(w => ({ ...w, recipientNames: [...w.recipientNames].sort((a, b) => a.localeCompare(b, "ko")) })).sort((a, b) => a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id));
  return { month: snapshot.month, version: snapshot.version || 0, collectedAt: snapshot.collectedAt, updatedAt: snapshot.updatedAt || null,
    count: snapshot.records.length, contentHash: snapshotDigest(snapshot), noteCount: snapshot.records.filter(r => r.note.trim()).length,
    recipientCount: recipients.size, workers, recipients: [...recipients.values()].sort((a,b)=>a.name.localeCompare(b.name,'ko')||a.id.localeCompare(b.id)) };
}

function fromRfid(rfid, { month, orgName, now = Date.now(), collectedAt = new Date(now).toISOString(), workerMap = [] }) {
  validateMonth(month);
  if (!rfid || rfid.ok !== true || !Array.isArray(rfid.records)) invalid("정상 수집된 RFID 자료가 필요합니다");
  const [year, number] = month.split("-").map(Number);
  const last = String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, "0");
  if (rfid.period?.from !== month + "-01" || rfid.period?.to !== month + "-" + last) invalid("선택한 월 전체를 수집한 자료가 필요합니다");
  if (!Array.isArray(workerMap)) invalid("작성자 대응표는 목록이어야 합니다");
  const hash = value => createHash("sha256").update(value).digest("hex").slice(0, 32);
  const records = rfid.records.map((r, i) => {
    const workerName = r.RECU_SFF_NM || r.CHE_NM;
    const recipientName = r.PRS_NM;
    const recipient = r.LTC_MGMT_NO;
    if (!workerName || !recipientName || !recipient) invalid("이름 또는 어르신 식별정보가 없는 기록이 있습니다");
    if (String(r.LTCP_CLSFC_CD) !== "001" || !["Y", "N"].includes(r.FMLY_YN)) invalid("방문요양 요양보호사 자료만 가져올 수 있습니다");
    const matches = workerMap.filter(w => w.name === workerName && (!w.recipient || w.recipient === recipient));
    if (matches.length > 1 || (matches[0] && !matches[0].id)) invalid("작성자 대응표를 확인해 주세요");
    const verified = !!matches.length;
    const workerId = (verified ? "w_" : "u_") + hash(verified ? String(matches[0].id) : JSON.stringify([workerName, recipient]));
    return { id: "r_" + hash(JSON.stringify([month, i, recipient, workerId, r.LTCP_OFFR_DT, r.LTCP_OFFR_FR_TM])),
      date: r.LTCP_OFFR_DT, time: String(r.LTCP_OFFR_FR_TM || ""), recipientId: "p_" + hash(String(recipient)),
      recipientName, workerId, workerName, identityVerified: verified, note: r.PCLR_COMT_CONTN == null ? "" : String(r.PCLR_COMT_CONTN) };
  });
  return validateImport({ schemaVersion: 1, month, orgName, collectedAt, records }, orgName, now);
}
module.exports={MAX_BYTES,MAX_RECORDS,normalizeOrg,validateImport,validateMonth,snapshotDigest,summary,expiresAt,koreanMonth,fromRfid};
