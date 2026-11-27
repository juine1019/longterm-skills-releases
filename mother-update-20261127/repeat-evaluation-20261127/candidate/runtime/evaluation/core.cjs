'use strict';
const crypto=require('node:crypto');
function canonical(x){if(x===null||typeof x!=='object')return JSON.stringify(x);if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';}
const hash=x=>crypto.createHash('sha256').update(canonical(x)).digest('hex');
const fail=message=>{throw Error(message);};
const must=(v,message)=>{if(!v)fail(message);};
const date=s=>typeof s==='string'&&/^20\d\d-\d\d-\d\d$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
function observationPeriod(spec){must(date(spec?.evaluationDate)&&date(spec.period?.from)&&date(spec.period?.to)&&spec.period.from<=spec.period.to&&spec.evaluationDate>=spec.period.from,'EVALUATION_PERIOD');const end=spec.period.to<spec.evaluationDate?spec.period.to:spec.evaluationDate;if(spec.evidenceObservedTo!==undefined){must(date(spec.evidenceObservedTo)&&spec.evidenceObservedTo>=spec.period.from&&spec.evidenceObservedTo<=end,'EVALUATION_PERIOD');return{from:spec.period.from,to:spec.evidenceObservedTo};}return{from:spec.period.from,to:end};}
const identityKeys=['orgId','workerId','workerName','recipientId','recognitionNo','recognitionSeq','planId','serviceCode'];
function identity(context){must(context&&typeof context==='object','CONTEXT_REQUIRED');for(const k of identityKeys)must(typeof context[k]==='string'&&context[k].trim()&&context[k].length<=200,'CONTEXT_FIELD_REQUIRED:'+k);return Object.fromEntries(identityKeys.map(k=>[k,context[k]]));}
function sameContext(a,b){return canonical(identity(a))===canonical(identity(b));}
function validateSpec(spec,schema,bundle,policy,{deskDraft=false}={}){
 const issues=[];try{
  must(spec?.schemaVersion===1&&schema?.schemaVersion===1&&bundle?.schemaVersion===1,'SCHEMA_VERSION');
  must(['create','update'].includes(spec.operation),'OPERATION');identity(spec.context);must(sameContext(spec.context,bundle.context),'EVIDENCE_CONTEXT_MISMATCH');
  must(spec.operation==='update'?typeof spec.evaluationId==='string'&&spec.evaluationId:spec.evaluationId==null,'EVALUATION_ID');
  const observed=observationPeriod(spec);
  must(canonical(spec.period)===canonical(bundle.period),'EVIDENCE_PERIOD');
  must(policy?.adopted===true&&typeof policy.version==='string'&&policy.version&&policy.evaluationKind===spec.evaluationKind,'INSTITUTION_POLICY_NOT_ADOPTED');
  must(schema.formId===spec.formId&&schema.fingerprint===spec.schemaFingerprint&&typeof schema.fingerprint==='string'&&schema.fingerprint===hash(schema.structure),'OBSERVED_FORM_CHANGED');
  must(['npsb800-20l-v1','npsb800-20l-v2'].includes(schema.structure?.nativeVersion)&&Array.isArray(schema.structure.goalKeys)&&Array.isArray(schema.structure.stateKeys),'UNSUPPORTED_FORM');
  must(schema.labelsReviewedFrom===schema.fingerprint&&schema.structure.stateKeys.every(key=>typeof schema.reviewLabels?.[key]==='string'&&schema.reviewLabels[key].trim()),'VISIBLE_STATE_LABELS_REQUIRE_REVIEW');
  must(bundle.reads&&['evaluations','plans','visits','workerNotes'].every(key=>bundle.reads[key])&&Object.values(bundle.reads).every(r=>['complete','empty'].includes(r.status)&&Array.isArray(r.records)&&!!r.collectedAt),'INCOMPLETE_EVIDENCE_READ');
  for(const read of Object.values(bundle.reads))must((read.status==='empty')===(read.records.length===0),'EVIDENCE_STATUS_RECORD_MISMATCH');
  let evaluationRecords=bundle.reads.evaluations.records;
  if(spec.requireFreshEvaluations===true){
   const fresh=bundle.currentEvaluations;must(fresh&&['complete','empty'].includes(fresh.status)&&Array.isArray(fresh.records)&&((fresh.status==='empty')===(fresh.records.length===0))&&typeof fresh.collectedAt==='string'&&Number.isFinite(Date.parse(fresh.collectedAt)),'FRESH_EVALUATIONS_REQUIRED');
   const query=fresh.query;must(canonical(fresh.historyRange)===canonical({from:'2000-01-01',to:'2099-12-31'}),'FRESH_EVALUATIONS_HISTORY_INCOMPLETE');
   must(query&&sameContext(query.context,spec.context)&&canonical(query.period)===canonical(spec.period)&&(!query.observationPeriod||canonical(query.observationPeriod)===canonical(spec.period)),'FRESH_EVALUATIONS_SCOPE_MISMATCH');
   const ids=new Set();for(const e of fresh.records){const b=e.content?.basic;must(typeof e.id==='string'&&!ids.has(e.id)&&e.kind==='evaluation'&&e.contentHash===hash(e.content)&&sameContext(e.context,spec.context)&&b?.POF_PLNPP_MGMT_NO===spec.context.planId&&typeof b.POF_VLT_CHASU==='string'&&/^[1-9]\d{0,2}$/.test(b.POF_VLT_CHASU)&&date(e.date)&&e.date>=fresh.historyRange.from&&e.date<=fresh.historyRange.to&&String(b.WRT_DT||'').replaceAll('-','')===e.date.replaceAll('-',''),'FRESH_EVALUATIONS_INVALID');ids.add(e.id);}
   evaluationRecords=fresh.records;
  }
  // Service periods may overlap or differ across repeated evaluations.
  // The saved evaluation date and next-round checks prevent duplicate writes;
  // overlap of the plan's service period alone is not a duplicate criterion.
  if(spec.operation==='create'&&!deskDraft){
   const day=v=>String(v||'').replaceAll('-',''),iso=v=>day(v).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
   for(const saved of evaluationRecords){
    const row=saved.content?.basic||saved.content?.header||{};
    if(row.POF_PLNPP_MGMT_NO!==spec.context.planId)continue;
    const from=day(row.ADPT_FR_DT),to=day(row.ADPT_TO_DT),savedDate=day(row.WRT_DT);
    must(date(iso(from))&&date(iso(to))&&from<=to,'SAVED_EVALUATION_PERIOD_UNCONFIRMED');
    must(date(iso(savedDate)),'SAVED_EVALUATION_DATE_UNCONFIRMED');
    must(savedDate!==day(spec.evaluationDate),'EVALUATION_ALREADY_SAVED_ON_DATE');
   }
  }
  for(const read of Object.values(bundle.reads))must(read.query&&sameContext(read.query.context,spec.context)&&canonical(read.query.period)===canonical(spec.period)&&(read.query.observationPeriod?canonical(read.query.observationPeriod)===canonical(observed):canonical(observed)===canonical(spec.period)),'EVIDENCE_QUERY_SCOPE_MISMATCH');
  const expectedMonths=[];let month=observed.from.slice(0,7);while(month<=observed.to.slice(0,7)){must(expectedMonths.length<120,'EVIDENCE_PERIOD_TOO_LARGE');expectedMonths.push(month.replace('-',''));const [year,value]=month.split('-').map(Number);month=value===12?String(year+1)+'-01':String(year)+'-'+String(value+1).padStart(2,'0');}
  for(const key of ['visits','workerNotes']){const coverage=bundle.reads[key].coverage;must(Array.isArray(coverage)&&canonical(coverage.map(x=>x.month).sort())===canonical(expectedMonths)&&coverage.every(x=>['complete','empty'].includes(x.status)),'EVIDENCE_MONTH_COVERAGE_UNCONFIRMED:'+key);}
  const notes=bundle.reads.workerNotes;must(notes.service==='ltRfid'&&notes.coverageScope==='RFID-transmissions-and-their-specific-content','LT_ONLY_WORKER_NOTE_SOURCE_REQUIRED');
  for(const e of notes.records){must(e.source?.service==='ltRfid'&&e.source.endpoint==='/f/c/624/selectRfidDetail.do','LT_ONLY_WORKER_NOTE_SOURCE_REQUIRED');if(e.kind==='worker-note')must(e.source.eligible===true&&e.content?.header?.USE_YN==='Y'&&e.content.header.DEL_YN==='N'&&e.content?.detail?.DEL_YN==='N'&&typeof e.content.detail.PCLR_COMT_CONTN==='string'&&e.content.detail.PCLR_COMT_CONTN.trim(),'ACTUAL_RFID_NARRATIVE_REQUIRED');}
  must(bundle.reads.plans?.records.some(p=>p.planId===spec.context.planId&&p.from===spec.period.from&&date(p.to)&&p.to>=spec.period.to),'PLAN_PERIOD_NOT_VERIFIED');
  const evidence=new Map();for(const read of Object.values(bundle.reads))for(const e of read.records){must(typeof e.id==='string'&&!evidence.has(e.id)&&e.contentHash===hash(e.content),'EVIDENCE_ID_OR_HASH');must(e.context&&sameContext(e.context,spec.context),'EVIDENCE_RECORD_CONTEXT');if(e.date)must(date(e.date)&&e.date>=observed.from&&e.date<=observed.to,'EVIDENCE_RECORD_PERIOD');evidence.set(e.id,e);}
  const checkText=(item,max,allowEmpty=false)=>{must(typeof item.text==='string'&&item.text.length<=max&&(allowEmpty||item.text.trim()),'TEXT_LIMIT_OR_EMPTY');must(Array.isArray(item.evidenceIds)&&new Set(item.evidenceIds).size===item.evidenceIds.length,'EVIDENCE_LINKS_REQUIRED');for(const id of item.evidenceIds){const e=evidence.get(id);must(e&&['visit','worker-note','user-confirmed'].includes(e.kind),'ACTUAL_PROVISION_EVIDENCE_REQUIRED');}if(item.text.trim())must(item.evidenceIds.length>0&&item.evidenceState==='verified','UNSUPPORTED_NARRATIVE');};
  must(Array.isArray(spec.goals)&&new Set(spec.goals.map(g=>g.key)).size===spec.goals.length&&canonical(spec.goals.map(g=>g.key).sort())===canonical([...schema.structure.goalKeys].sort()),'EXACT_GOAL_SCOPE');
  for(const g of spec.goals){must(typeof g.provided==='boolean','PROVIDED_DECISION_REQUIRED');checkText(g,Math.min(200,schema.structure.goalTextMax||200));must(g.achievementRate==null,'UNSUPPORTED_ACHIEVEMENT_RATE');}
  must(Array.isArray(spec.observations)&&new Set(spec.observations.map(o=>o.key)).size===spec.observations.length&&canonical(spec.observations.map(o=>o.key).sort())===canonical([...schema.structure.stateKeys].sort()),'EXACT_STATE_SCOPE');
  for(const o of spec.observations){must(typeof o.selected==='boolean','STATE_SELECTION_REQUIRED');checkText(o,Math.min(500,schema.structure.stateTextMax?.[o.key]||500),true);if(o.selected)must(o.evidenceState==='verified'&&o.evidenceIds.length,'STATE_SELECTION_EVIDENCE_REQUIRED');}
  checkText(spec.summary,Math.min(500,schema.structure.summaryMax||500));
  if(schema.structure.nativeVersion==='npsb800-20l-v2')validateV2(spec,schema,bundle,checkText,evaluationRecords);
  if(spec.operation==='update'){must(bundle.existing?.evaluationId===spec.evaluationId&&bundle.existing.evaluationDate===spec.evaluationDate,'SAVED_EVALUATION_DATE_OR_ID_CHANGED');}
 }catch(e){issues.push(e.message);}return{ok:issues.length===0,issues,specHash:hash(spec),schemaHash:hash(schema),bundleHash:hash(bundle),policyHash:hash(policy)};
}
// Form v2 adds an evaluation round, a separate overall comment (총평) and reason inputs; the site refuses to save
// without a state choice plus written basis per area, a need confirmation and a future plan.
function validateV2(spec,schema,bundle,checkText,records=bundle.reads.evaluations.records){
  const round=spec.evaluationRound;must(typeof round==='string'&&/^[1-9]\d{0,2}$/.test(round),'EVALUATION_ROUND_INVALID');
  const rounds=records.map(e=>Number(e.content?.basic?.POF_VLT_CHASU)).filter(Number.isInteger);
  if(spec.operation==='create')must(Number(round)===Math.max(0,records.length,...rounds)+1,'EVALUATION_ROUND_MISMATCH');
  else{const saved=records.find(e=>e.evaluationId===spec.evaluationId);must(saved&&Number(saved.content?.basic?.POF_VLT_CHASU)===Number(round),'EVALUATION_ROUND_MISMATCH');}
  must(spec.overallComment&&typeof spec.overallComment==='object','OVERALL_COMMENT_REQUIRED');checkText(spec.overallComment,Math.min(2000,schema.structure.overallMax||2000));
  const by=new Map(spec.observations.map(o=>[o.key,o])),groups=[...new Set(schema.structure.stateKeys.filter(k=>/^X\d{4}$/.test(k)).map(k=>k.slice(0,4)))];
  for(const g of groups){const chosen=['1','2','3'].filter(n=>by.get(g+n)?.selected===true);must(chosen.length===1,'STATE_AREA_CHOICE:'+g);must(typeof by.get(g+'4')?.text==='string'&&by.get(g+'4').text.trim(),'STATE_AREA_BASIS:'+g);}
  must(['Z1101','Z1102','Z1103'].some(k=>by.get(k)?.selected===true),'NEED_CONFIRMATION_REQUIRED');
  must(['Z1201','Z1202','Z1203','Z1204','Z1205','Z1206','Z1207','Z1209'].some(k=>by.get(k)?.selected===true),'FUTURE_PLAN_REQUIRED');
  for(const key of schema.structure.reasonKeys||[]){const o=by.get(key);must(o,'REASON_CONTROL_SCOPE:'+key);if(o.selected===true)must(o.text.trim(),'REASON_REQUIRED:'+key);else must(o.text==='','REASON_WITHOUT_SELECTION:'+key);}
}
function validateInstruction(instruction,spec,proof){must(instruction?.specHash===proof.specHash&&instruction.bundleHash===proof.bundleHash&&instruction.policyHash===proof.policyHash&&instruction.organizationId===spec.context.orgId&&typeof instruction.message==='string'&&instruction.message.trim()&&typeof instruction.source==='string'&&instruction.source.trim()&&typeof instruction.saveAllowed==='boolean','ACTUAL_USER_INSTRUCTION_REQUIRED');return true;}
function comparable(spec){return{context:identity(spec.context),evaluationDate:spec.evaluationDate,period:spec.period,evaluationKind:spec.evaluationKind,goals:spec.goals.map(({key,provided,text})=>({key,provided,text})).sort((a,b)=>a.key.localeCompare(b.key)),observations:spec.observations.map(({key,selected,text})=>({key,selected,text})).sort((a,b)=>a.key.localeCompare(b.key)),summary:spec.summary.text,...(spec.evaluationRound!==undefined?{evaluationRound:String(spec.evaluationRound)}:{}),...(spec.overallComment?{overallComment:spec.overallComment.text}:{})};}
module.exports={canonical,hash,must,date,observationPeriod,identity,sameContext,validateSpec,validateInstruction,comparable};
