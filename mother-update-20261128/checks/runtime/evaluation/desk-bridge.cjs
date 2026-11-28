'use strict';
// 6-1: 검증을 통과한 결과평가 명세(spec)·근거 묶음(bundle)을 업무데스크 「초안」(작업지시서 5.2)으로 바꾼다.
// 이 모듈은 롱텀에 접속하지 않고 업무데스크에도 쓰지 않는다. 초안 본문과 게시 요청 본문만 만든다.
// 검토완료·취소를 대신하는 코드는 두지 않는다(R11).
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const core = require('./core.cjs');
const { canonical, hash, must } = core;

const HEX = /^[a-f0-9]{64}$/;
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0); // 코드포인트 순서 (localeCompare 금지)
const trimText = (value, max) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);

// 기관별 HMAC 비밀값: 저장소 밖 로컬 파일에 한 번 만들고 계속 쓴다. 바꾸면 evaluationKey가 달라져 초안이 중복된다.
function keyFile(env = process.env) {
  return env.LONGTERM_DESK_KEYS_FILE || path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'longterm-agent', 'evaluation-desk-keys.json');
}
// create의 기본값은 false다. 다른 PC에 키 파일이 없을 때 조용히 새 비밀값을 만들면 evaluationKey가 달라져
// 같은 평가가 업무데스크에 중복 초안으로 올라간다. 처음 한 번 만들 때만 {create:true}를 명시한다.
function loadOrCreateSecret(orgId, { file = keyFile(), create = false } = {}) {
  must(typeof orgId === 'string' && orgId.trim(), 'ORG_ID_REQUIRED');
  let store = { schemaVersion: 1, orgs: {} };
  if (fs.existsSync(file)) {
    store = JSON.parse(fs.readFileSync(file, 'utf8'));
    must(store.schemaVersion === 1 && store.orgs && typeof store.orgs === 'object', 'DESK_KEY_FILE_INVALID');
  }
  const existing = store.orgs[orgId];
  if (existing !== undefined) { must(typeof existing === 'string' && HEX.test(existing), 'DESK_KEY_FILE_INVALID'); return { secret: existing, created: false, file }; }
  must(create, 'DESK_SECRET_MISSING');
  const secret = crypto.randomBytes(32).toString('hex');
  store.orgs[orgId] = secret;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(store, null, 1), { flag: 'wx' });
  fs.renameSync(temp, file);
  return { secret, created: true, file };
}
function deskKeys(secret, context) {
  must(HEX.test(secret), 'DESK_SECRET_INVALID');
  const mac = (parts) => crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(canonical(parts)).digest('hex');
  return {
    subjectKey: mac(['subject', context.orgId, context.recipientId]),
    planKey: mac(['plan', context.orgId, context.recipientId, context.planId]),
  };
}
const evaluationKey = ({ subjectKey, planKey, servicePeriod, operation, evaluationId, revision }) =>
  hash([subjectKey, planKey, servicePeriod, operation, evaluationId ?? '', revision]);

// 업무데스크 contentHash와 같은 투영. 평가일자는 검토완료 때 정해지므로 초안에서는 null이다.
function deskComparable(data) {
  return {
    subjectKey: data.subjectKey, planKey: data.planKey, servicePeriod: data.servicePeriod,
    evaluationDate: data.evaluationDate ?? null, evaluationKind: data.evaluationKind,
    goals: data.goals.map(({ key, provided, text }) => ({ key, provided, text })).sort(byKey),
    observations: data.observations.map(({ key, selected, text }) => ({ key, selected, text })).sort(byKey),
    summary: data.summary.text, overallComment: data.overallComment.text,
  };
}
const deskContentHash = (data) => hash(deskComparable(data));
const profileMatches = (expected, actual) =>
  ['sex','birthDate','grade'].every(key => expected?.[key] == null || expected[key] === actual?.[key]);

// 인용한 근거만 발췌한다. 원본 content(헤더에 인정번호가 있음)는 올리지 않는다.
function evidenceItem(record) {
  const id = record.id, kind = record.kind;
  must(typeof id === 'string' && id.startsWith(kind + ':') && HEX.test(record.contentHash), 'EVIDENCE_RECORD_INVALID');
  must(kind === 'visit' || kind === 'worker-note', 'EVIDENCE_KIND_UNSUPPORTED');
  if (kind === 'worker-note') {
    return { id, kind, date: record.date, author: trimText(record.content?.header?.RECU_SFF_NM, 120), title: '요양보호사 특이사항',
      excerpt: trimText(record.content?.detail?.PCLR_COMT_CONTN, 600), contentHash: record.contentHash };
  }
  const basic = record.content?.basic || {};
  const services = Object.keys(basic).filter((k) => /MNGMTT$/.test(k)).sort().map((k) => trimText(basic[k], 300)).filter(Boolean);
  // X1~X6, X9, Y0 and Z1 contain visit observations, summary and consultation. Do not copy row identifiers.
  const states = (Array.isArray(record.content?.states) ? record.content.states : [])
    .filter((row) => /^(?:X[1-6]|X9|Y0|Z1)$/.test(row?.DSRE_ITEM_CD_PTTN || ''))
    .map((row) => trimText(row.ETC_CONTN, 300)).filter(Boolean);
  const excerpt = [...new Set([...services, ...states])].join(' / ');
  return { id, kind, date: record.date, author: trimText(record.content?.header?.WRTR, 120), title: '업무수행일지(가정방문형)',
    excerpt: excerpt.length > 600 ? trimText(excerpt, 599) + '…' : excerpt, contentHash: record.contentHash };
}

function buildDeskDraft({ spec, schema, bundle, policy, recipientName, settings, secret, revision = 1, validate = (s, sc, b, p) => core.validateSpec(s, sc, b, p, { deskDraft: true }) }) {
  const proof = validate(spec, schema, bundle, policy);
  must(proof.ok === true, 'SPEC_NOT_VALID:' + (proof.issues || []).join(','));
  must(spec.operation === 'create', 'DESK_UPDATE_NOT_SUPPORTED_YET');
  must(typeof recipientName === 'string' && recipientName.trim(), 'RECIPIENT_NAME_REQUIRED');
  must(Number.isSafeInteger(revision) && revision > 0, 'REVISION_INVALID');
  const collectedAt = bundle.collectedAt;
  must(typeof collectedAt === 'string' && /Z$/.test(collectedAt) && Number.isFinite(Date.parse(collectedAt)), 'EVIDENCE_COLLECTED_AT_REQUIRED');
  must(spec.period.to >= collectedAt.slice(0, 10), 'SERVICE_PERIOD_ENDED'); // 서비스기간이 지났으면 검토완료를 할 수 없다
  const observedTo = core.observationPeriod(spec).to;
  const context = spec.context;
  const keys = deskKeys(secret, context);
  const servicePeriod = { from: spec.period.from, to: spec.period.to };

  const structure = schema.structure;
  const reasonKeys = new Set(structure.reasonKeys || []);
  const limits = {
    goalTextMax: structure.goalTextMax, summaryMax: structure.summaryMax, overallMax: structure.overallMax,
    stateTextMax: structure.stateTextMax || {},
    controls: structure.controls.filter((c) => c.key !== 'Z1208').map((c) => ({ key: c.key, kind: c.kind, reason: reasonKeys.has(c.key), maxLength: c.kind === 'text' || reasonKeys.has(c.key) ? c.maxLength : null })),
  };
  const labels = Object.fromEntries(limits.controls.map(({ key }) => [key, schema.reviewLabels[key]]));
  const part = (item) => ({ text: item.text, evidenceState: item.evidenceState, evidenceIds: [...item.evidenceIds] });
  const plans = (bundle.reads.plans?.records || []).filter(r => r.content?.basic?.POF_PLNPP_MGMT_NO === context.planId);
  const rows = plans.length === 1 && Array.isArray(plans[0].content.goals) ? plans[0].content.goals : [];
  const planDisplay = (key) => {
    const matches = rows.filter(row => typeof row.NSST_CONTN_GROUP_NM === 'string' && row.NSST_CONTN_GROUP_NM.trim() === key);
    if (matches.length !== 1) return {};
    const row = matches[0], display = {};
    for (const [source,target,max] of [['PAYMT_TYPE_NM','area',40],['DETAIL_GOAL_CONTN','planGoal',400]]) {
      if (typeof row[source] !== 'string') continue;
      const text = row[source].replace(/[\r\n\t]+/g,' ').trim();
      if (text && text.length <= max) display[target] = text;
    }
    return display;
  };
  const goals = spec.goals.map((g) => ({
    key: g.key, label: g.key, provided: g.provided, ...part(g), ...planDisplay(g.key),
    texts: g.provided ? { provided: g.text, notProvided: '제공여부 확인못함.' } : { provided: '', notProvided: g.text },
  }));
  const observations = spec.observations.filter((o) => o.key !== 'Z1208').map((o) => ({ key: o.key, selected: o.selected, ...part(o) }));
  const overallComment = part(spec.overallComment), summary = part(spec.summary);

  // 인용 순서대로 근거 목록을 만든다(번호는 이 순서).
  const all = new Map();
  for (const read of Object.values(bundle.reads)) for (const r of read.records) all.set(r.id, r);
  const order = [];
  for (const item of [...goals, ...observations, overallComment, summary]) for (const id of item.evidenceIds) if (!order.includes(id)) order.push(id);
  const evidence = order.map((id) => { const r = all.get(id); must(r, 'EVIDENCE_NOT_IN_BUNDLE'); return evidenceItem(r); });

  const recipientProfile = bundle.recipientProfile || {};
  const profile = Object.fromEntries(['sex','birthDate','grade']
    .filter(key => recipientProfile[key] != null)
    .map(key => [key,recipientProfile[key]]));
  const data = {
    schemaVersion: 1, orgId: undefined, evaluationKey: undefined, revision, operation: 'create', evaluationId: null,
    subjectKey: keys.subjectKey, planKey: keys.planKey,
    recipient: { name: recipientName.trim(), recognitionNo: context.recognitionNo, ...profile }, planNo: context.planId,
    worker: { name: context.workerName, jobTitle: settings?.operator?.job || '사회복지사' },
    servicePeriod, evaluationDate: null, evaluationDateSource: 'review-day',
    evaluationRound: String(spec.evaluationRound), evaluationKind: spec.evaluationKind,
    formId: schema.formId, schemaFingerprint: schema.fingerprint, nativeVersion: structure.nativeVersion,
    limits, labels, goals, observations, overallComment, summary, evidence,
    evidenceCollectedAt: collectedAt, evidenceObservedTo: observedTo, bundleHash: proof.bundleHash,
    localWorkKey: sha256(canonical(['evaluation-work', proof.specHash, proof.bundleHash, proof.schemaHash, proof.policyHash])),
  };
  data.evaluationKey = evaluationKey(data);
  delete data.orgId; // 업무데스크 기관 ID는 게시할 때 현재 로그인한 기관에서 채운다
  return { data, proof, contentHash: deskContentHash(data) };
}

// The caller must supply a complete, freshly read list of full records for the organization.
// This computes a proposal only: a publisher must still use expectedVersion and verify the result.
function planPublication(built, records) {
  must(Array.isArray(records), 'DESK_RECORDS_UNCONFIRMED');
  const data = built?.data;
  must(data && HEX.test(built.contentHash || '') && deskContentHash(data) === built.contentHash, 'DESK_DRAFT_INVALID');
  const same = records.filter(r => r?.subjectKey === data.subjectKey && r?.planKey === data.planKey && canonical(r.servicePeriod) === canonical(data.servicePeriod));
  for (const r of same) must(Number.isSafeInteger(r.revision) && r.revision > 0 && HEX.test(r.evaluationKey || '') && HEX.test(r.contentHash || ''), 'DESK_RECORD_INVALID');
  // Existing records may have been saved before the round was removed from the hash.
  // Verify their original projection without rewriting the stored record.
  for (const r of same) {
    const legacy = typeof r.evaluationRound === 'string' && /^[1-9]\d{0,2}$/.test(r.evaluationRound)
      ? hash({ ...deskComparable(r), evaluationRound: r.evaluationRound }) : null;
    must(deskContentHash(r) === r.contentHash || legacy === r.contentHash, 'DESK_RECORD_HASH_MISMATCH');
  }
  const existing = same.find(r => deskContentHash({ ...r, evaluationDate: null }) === built.contentHash);
  if (existing) {
    must(profileMatches(data.recipient,existing.recipient),'DESK_RECIPIENT_PROFILE_MISMATCH');
    return { action: 'existing', evaluationKey: existing.evaluationKey, revision: existing.revision };
  }
  const revision = Math.max(0, ...same.map(r => r.revision)) + 1;
  must(Number.isSafeInteger(revision), 'REVISION_INVALID');
  const next = { ...data, revision }; next.evaluationKey = evaluationKey(next);
  return { action: 'create', data: next, contentHash: built.contentHash };
}

// 게시 요청 본문. orgId(업무데스크 기관 ID)는 로그인한 관리자 탭의 /api/org 값만 쓴다.
function publishBody({ data, deskOrgId, requestId, expectedVersion = 0 }) {
  must(typeof deskOrgId === 'string' && deskOrgId.trim(), 'DESK_ORG_REQUIRED');
  must(typeof requestId === 'string' && /^[-\w]{8,128}$/.test(requestId), 'REQUEST_ID_INVALID');
  return { expectedOrg: deskOrgId, requestId, expectedVersion, data: { ...data, orgId: deskOrgId } };
}

// 올린 뒤 독립 GET으로 다시 읽은 레코드와 대조한다.
function verifyPublished(expected, record) {
  const issues = [];
  if (!record || typeof record !== 'object') return { ok: false, issues: ['NO_RECORD'] };
  if (record.evaluationKey !== expected.data.evaluationKey) issues.push('KEY');
  if (record.status !== 'draft') issues.push('STATUS');
  if (record.contentHash !== expected.contentHash && deskContentHash(record) !== expected.contentHash) issues.push('CONTENT_HASH');
  if (record.bundleHash !== expected.data.bundleHash) issues.push('BUNDLE_HASH');
  if ((record.evidence || []).length !== expected.data.evidence.length) issues.push('EVIDENCE_COUNT');
  if ((record.goals || []).length !== expected.data.goals.length) issues.push('GOAL_COUNT');
  if (record.evaluationDate !== null) issues.push('EVALUATION_DATE_NOT_NULL');
  if (!profileMatches(expected.data.recipient,record.recipient)) issues.push('RECIPIENT_PROFILE');
  return { ok: issues.length === 0, issues };
}

module.exports = { keyFile, loadOrCreateSecret, deskKeys, evaluationKey, deskComparable, deskContentHash, evidenceItem, buildDeskDraft, planPublication, publishBody, verifyPublished };
