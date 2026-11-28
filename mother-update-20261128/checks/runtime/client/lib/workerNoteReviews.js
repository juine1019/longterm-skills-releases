const { createHash } = require('node:crypto');
const notes = require('./workerNotes');
const MAX_BYTES = 1500000;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const STATUS = ['suggestion','confirm','clear','unavailable'];
const bad = (message, code = 'INVALID_REVIEWS') => { throw Object.assign(new Error(message), { code }); };
const parsed = v => typeof v === 'string' ? JSON.parse(v) : v;
function key(orgId, month) { notes.validateMonth(month); if (!orgId) bad('기관 정보가 필요합니다'); return `workernotereviews:${orgId}:m:${month}`; }
function cleanEntries(entries, recordIds) {
  if (!Array.isArray(entries) || !entries.length || entries.length > notes.MAX_RECORDS) bad('의견 목록을 확인해 주세요');
  const seen = new Set();
  return entries.map(e => {
    if (!e || !ID.test(e.recordId) || typeof e.recordId !== 'string' || seen.has(e.recordId) || (recordIds && !recordIds.has(e.recordId))) bad('원문 기록 번호가 없거나 중복됐습니다');
    seen.add(e.recordId);
    if (e.concise !== undefined && typeof e.concise !== 'boolean') bad('의견 표시 방식을 확인해 주세요');
    if (!STATUS.includes(e.status) || typeof e.opinion !== 'string' || (!e.opinion.trim() && !(e.concise === true && e.status === 'clear' && e.opinion === '')) || e.opinion.length > 1600) bad('의견 상태와 내용을 확인해 주세요');
    if (!['checked','unavailable'].includes(e.planCheck) || typeof e.planBasis !== 'string' || e.planBasis.length > 400 || (e.planCheck === 'checked' && !e.planBasis.trim())) bad('급여계획 대조 근거를 확인해 주세요');
    return { recordId:e.recordId, status:e.status, opinion:e.opinion, planCheck:e.planCheck, planBasis:e.planBasis, ...(e.concise === true ? {concise:true} : {}) };
  });
}
function reviewHash(s) {
  const entries = cleanEntries(s.entries).sort((a,b) => a.recordId.localeCompare(b.recordId));
  return createHash('sha256').update(JSON.stringify({ orgName:s.orgName, month:s.month, sourceVersion:s.sourceVersion, sourceContentHash:s.sourceContentHash, entries })).digest('hex');
}


module.exports={MAX_BYTES,STATUS,cleanEntries,reviewHash};
