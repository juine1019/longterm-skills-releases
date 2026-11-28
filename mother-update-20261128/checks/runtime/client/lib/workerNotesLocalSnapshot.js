// 로컬 특이사항 보관소 스냅샷(공통 runtime/worker-notes-store.cjs 형식)을 검증하고
// 업무데스크 원문 가져오기 파일과 보기용 행으로 바꾼다. 원문은 다듬거나 합치지 않는다.
const { createHash } = require("node:crypto");
const { fromRfid, normalizeOrg } = require("./workerNotes");
const KIND = "longterm-worker-notes-month";
const MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;
const HEADER_KEYS = ["FNM", "LTC_MGMT_NO", "RECU_SFF_NM", "LTCP_CLSFC_CD", "LTCP_FR_DT", "LTCP_OFFR_YYYYMM", "RFID_ADM_NO", "TAG_ID", "READER_NO", "LTCP_FR_DTHMS", "LTCP_TO_DTHMS", "USE_YN", "DEL_YN"];
const DETAIL_KEYS = ["LTC_MGMT_NO", "LTCP_FR_DT", "RFID_ADM_NO", "TAG_ID", "LTCP_FR_DTHMS", "LTCP_TO_DTHMS", "PCLR_COMT_CONTN", "FMLY_YN", "DEL_YN"];
function invalid(message, code = "INVALID_LOCAL_SNAPSHOT") { throw Object.assign(new Error(message), { code }); }
const iso = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
function lastDay(month) { const [y, m] = month.split("-").map(Number); return month + "-" + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0"); }
function validateLocalSnapshot(s) {
  if (!s || s.schemaVersion !== 1 || s.kind !== KIND || s.fieldsVersion !== 1 || typeof s.month !== "string" || !MONTH.test(s.month)) invalid("로컬 특이사항 스냅샷 형식이 아닙니다");
  if (typeof s.organization?.id !== "string" || !s.organization.id || typeof s.organization.name !== "string") invalid("스냅샷 기관 정보가 없습니다");
  if (s.scope?.from !== s.month + "-01" || s.scope?.to !== lastDay(s.month) || s.scope?.serviceCode !== "001") invalid("월 전체 방문요양 범위의 스냅샷이 아닙니다");
  if (!iso(s.collectedAt) || !Array.isArray(s.records)) invalid("원래 수집시각 또는 기록 목록이 없습니다");
  const ym = s.month.replace("-", "");
  for (const r of s.records) {
    if (!r || HEADER_KEYS.some((k) => typeof r.header?.[k] !== "string") || DETAIL_KEYS.some((k) => typeof r.detail?.[k] !== "string") || typeof r.sourceId !== "string") invalid("원천 필드가 빠진 기록이 있습니다");
    if (r.header.LTCP_OFFR_YYYYMM !== ym || !r.header.LTCP_FR_DT.startsWith(ym) || r.header.LTCP_CLSFC_CD !== "001") invalid("다른 달이나 다른 급여 기록이 섞여 있습니다");
  }
  if (createHash("sha256").update(JSON.stringify(s.records)).digest("hex") !== s.recordsHash) invalid("원문 기록 해시가 맞지 않습니다", "SNAPSHOT_HASH_MISMATCH");
  return s;
}
function recordStatus(r) {
  if (r.header.DEL_YN === "Y" || r.detail.DEL_YN === "Y") return "삭제";
  if (r.header.USE_YN !== "Y") return "미사용";
  return r.detail.PCLR_COMT_CONTN.trim() ? "원문 있음" : "원문 공란";
}
const day = (v) => v.slice(0, 4) + "-" + v.slice(4, 6) + "-" + v.slice(6, 8);
// 롱텀 일시(예: 2026-10-05 09:05:00)에서 시:분만 꺼낸다. 형식이 다르면 비워 둔다.
function clock(value) { const d = String(value || "").replace(/\D/g, ""); return d.length >= 12 ? d.slice(8, 10) + ":" + d.slice(10, 12) : ""; }
function rows(snapshot) {
  validateLocalSnapshot(snapshot);
  return snapshot.records.map((r) => ({ date: day(r.header.LTCP_FR_DT), recipientName: r.header.FNM, workerName: r.header.RECU_SFF_NM,
    start: clock(r.detail.LTCP_FR_DTHMS || r.header.LTCP_FR_DTHMS), end: clock(r.detail.LTCP_TO_DTHMS || r.header.LTCP_TO_DTHMS), note: r.detail.PCLR_COMT_CONTN, status: recordStatus(r), sourceId: r.sourceId }));
}
// 기존 fromRfid 입력 모양. 삭제·미사용 기록은 6-1 근거 판정과 같이 넣지 않는다. 순서는 원래 목록 순서다.
function toRfid(snapshot) {
  validateLocalSnapshot(snapshot);
  const records = snapshot.records.filter((r) => ["원문 있음", "원문 공란"].includes(recordStatus(r))).map((r) => ({
    PRS_NM: r.header.FNM, LTC_MGMT_NO: r.header.LTC_MGMT_NO, LTCP_OFFR_DT: day(r.header.LTCP_FR_DT), LTCP_OFFR_FR_TM: clock(r.detail.LTCP_FR_DTHMS || r.header.LTCP_FR_DTHMS),
    RECU_SFF_NM: r.header.RECU_SFF_NM, PCLR_COMT_CONTN: r.detail.PCLR_COMT_CONTN, FMLY_YN: r.detail.FMLY_YN, LTCP_CLSFC_CD: r.header.LTCP_CLSFC_CD }));
  return { ok: true, period: { from: snapshot.scope.from, to: snapshot.scope.to }, records };
}
function toImport(snapshot, { orgName, workerMap = [], now = Date.now() }) {
  validateLocalSnapshot(snapshot);
  if (!normalizeOrg(orgName) || normalizeOrg(orgName) !== normalizeOrg(snapshot.organization.name)) invalid("스냅샷 기관과 지정한 기관이 다릅니다", "ORG_MISMATCH");
  return fromRfid(toRfid(snapshot), { month: snapshot.month, orgName, now, collectedAt: snapshot.collectedAt, workerMap });
}
module.exports = { validateLocalSnapshot, recordStatus, rows, toRfid, toImport };
