// 특이사항 원문의 업무 내용 동일성(형식 버전 1). 수집·저장 시각은 비교에서 뺀다.
// 기존 공개 contentHash(snapshotDigest)·version·CAS 의미는 바꾸지 않는다. 서버 코드 없음(배포본 client로 추출된다).
const { createHash } = require("node:crypto");
const { normalizeOrg, snapshotDigest } = require("./workerNotes");
const BUSINESS_HASH_VERSION = 1;
const FIELDS = ["id", "date", "time", "workerId", "workerName", "recipientId", "recipientName", "note"];
function malformed() { throw Object.assign(new Error("원문 형식을 확인하지 못했습니다"), { code: "CONTENT_MALFORMED" }); }
// 기관명·월·전체 저장 기록(업무 필드·식별자·작성자/수급자 대응·저장 구성)을 원문 그대로, 기록 ID 순으로 해시한다.
function businessContentHash(snapshot) {
  if (!snapshot || typeof snapshot.orgName !== "string" || typeof snapshot.month !== "string" || !Array.isArray(snapshot.records)) malformed();
  const records = snapshot.records.map((r) => {
    if (!r || FIELDS.some((k) => typeof r[k] !== "string") || typeof r.identityVerified !== "boolean") malformed();
    return [...FIELDS.map((k) => r[k]), r.identityVerified];
  }).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return createHash("sha256").update(JSON.stringify({ v: BUSINESS_HASH_VERSION, orgName: snapshot.orgName, month: snapshot.month, records }), "utf8").digest("hex");
}
// candidate: 로컬 등록 자료. current: 서버 현재 값 {version, contentHash, count, 그리고 확인용 month·orgName·collectedAt·records}.
// same은 서버 원문이 공개 contentHash로 완전히 검증된 경우에만 반환한다. 불완전·구 서버·손상은 unconfirmed.
function compareWorkerNotesContent({ candidate, current, scope }) {
  const binding = { version: current?.version ?? null, contentHash: current?.contentHash ?? null };
  let candidateBusinessHash = null;
  const result = (kind, extra = {}) => ({ kind, current: binding, candidateBusinessHash, ...extra });
  try { candidateBusinessHash = businessContentHash(candidate); } catch { return result("unconfirmed", { code: "CANDIDATE_MALFORMED" }); }
  if (!scope || candidate.month !== scope.month || !normalizeOrg(scope.orgName) || normalizeOrg(candidate.orgName) !== normalizeOrg(scope.orgName)) return result("unconfirmed", { code: "CONTENT_SCOPE_MISMATCH" });
  if (!current || !Number.isSafeInteger(current.version) || current.version < 0 || !Number.isSafeInteger(current.count)) return result("unconfirmed", { code: "CURRENT_INCOMPLETE" });
  if (current.version === 0) return current.contentHash === null && current.count === 0 ? result("changed") : result("unconfirmed", { code: "CURRENT_INCOMPLETE" });
  if (typeof current.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(current.contentHash)) return result("unconfirmed", { code: "CURRENT_INCOMPLETE" });
  // 기존 공개 해시가 그대로 같으면 수집 시각까지 같은 완전 동일 원문이다.
  if (current.contentHash === snapshotDigest(candidate) && current.count === candidate.records.length) return result("same", { currentBusinessHash: candidateBusinessHash });
  if (current.month !== scope.month) return result("unconfirmed", { code: "CONTENT_SCOPE_MISMATCH" });
  if (typeof current.collectedAt !== "string" || typeof current.orgName !== "string" || !Array.isArray(current.records) || current.records.length !== current.count) return result("unconfirmed", { code: "CURRENT_INCOMPLETE" });
  const stored = { schemaVersion: 1, month: current.month, orgName: current.orgName, collectedAt: current.collectedAt, records: current.records };
  let currentBusinessHash;
  try {
    if (new Set(current.records.map((r) => r?.id)).size !== current.records.length || snapshotDigest(stored) !== current.contentHash) return result("unconfirmed", { code: "CURRENT_NOT_VERIFIED" });
    currentBusinessHash = businessContentHash(stored);
  } catch { return result("unconfirmed", { code: "CURRENT_NOT_VERIFIED" }); }
  return result(currentBusinessHash === candidateBusinessHash ? "same" : "changed", { currentBusinessHash });
}
module.exports = { BUSINESS_HASH_VERSION, businessContentHash, compareWorkerNotesContent };
