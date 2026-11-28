'use strict';
// 4번 일부 대상 식별·필터(2026-11-20 Task C).
// - 요청 targets: {kind:'all'} 또는 {kind:'recipients', recipients:['인정번호|차수', …]}.
// - 안정 키는 '인정번호|차수'다(plan-source-four의 대상 키와 같음). 이름은 식별자로 쓰지 않는다.
// - 일부 선택의 각 키는 해시 결속된 대상 파일({schemaVersion:1,organizationId,sourceSha256,recipients:[{recognitionNo,recognitionSeq}]})에
//   정확히 하나 있어야 하고, 명부 원천({list:[{name,ltc,lpi,…}]}, 바이트 sha256 = sourceSha256)에서 인정번호가 정확히 한 행이어야 한다.
// - 업무데스크 수급자 ID는 원문과 같은 규칙('p_' + sha256(인정번호) 앞 32자, runtime/client/lib/workerNotes.js fromRfid)이다.
//   이 ID는 차수를 쓰지 않으므로 대상 파일에 같은 인정번호의 다른 차수가 있으면 선택을 모호(TARGET_AMBIGUOUS)로 거절한다.
// - 오류에는 코드와 입력 순번만 담는다(인정번호·이름 등 개인정보를 넣지 않는다).
const crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const exactKeys=(o,keys)=>Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const fail=(code,index)=>{throw Object.assign(Error(code),{code,...(index===undefined?{}:{index})});};
// 키 한쪽: 비어 있지 않고 '|'·앞뒤 공백·제어 문자가 없는 100자 이하 문자열
const PART=/^[^|\s\u0000-\u001f](?:[^|\u0000-\u001f]{0,98}[^|\s\u0000-\u001f])?$/;
const keyOf=(no,seq)=>String(no)+'|'+String(seq);
const isKey=k=>typeof k==='string'&&k.split('|').length===2&&k.split('|').every(p=>PART.test(p));
const deskRecipientId=recognitionNo=>'p_'+sha(String(recognitionNo)).slice(0,32);

function checkRecipientsFile(recipients,organizationId){
 if(!plain(recipients)||recipients.schemaVersion!==1||typeof recipients.organizationId!=='string'||!/^[0-9a-f]{64}$/.test(recipients.sourceSha256||'')||!Array.isArray(recipients.recipients)
  ||recipients.recipients.some(r=>!plain(r)||typeof r.recognitionNo!=='string'||!PART.test(r.recognitionNo)||typeof r.recognitionSeq!=='string'||!PART.test(r.recognitionSeq)))fail('TARGETS_INVALID');
 if(typeof organizationId!=='string'||!organizationId||recipients.organizationId!==organizationId)fail('TARGETS_ORGANIZATION_MISMATCH');
}
// 명부는 바이트로 받아 대상 파일의 sourceSha256과 대조한 뒤 그 바이트에서 목록을 읽는다(따로 넘긴 목록은 믿지 않는다).
function registryList(registry,recipients){
 if(!plain(registry)||!Buffer.isBuffer(registry.bytes)||sha(registry.bytes)!==recipients.sourceSha256)fail('TARGETS_REGISTRY_MISMATCH');
 let parsed;try{parsed=JSON.parse(registry.bytes.toString('utf8').replace(/^﻿/,''));}catch{fail('TARGETS_REGISTRY_MISMATCH');}
 if(!plain(parsed)||!Array.isArray(parsed.list))fail('TARGETS_REGISTRY_MISMATCH');
 return parsed.list;
}

function normalizeTargets({targets,recipients,registry,organizationId}={}){
 if(plain(targets)&&targets.kind==='all'&&exactKeys(targets,['kind']))return{kind:'all'};
 if(!plain(targets)||targets.kind!=='recipients'||!exactKeys(targets,['kind','recipients'])||!Array.isArray(targets.recipients))fail('TARGETS_INVALID');
 const want=targets.recipients;
 if(!want.length)fail('TARGETS_EMPTY');
 want.forEach((k,i)=>{if(!isKey(k))fail('TARGETS_INVALID',i);});
 if(new Set(want).size!==want.length)fail('TARGETS_INVALID');
 checkRecipientsFile(recipients,organizationId);
 const list=registryList(registry,recipients),entries=recipients.recipients;
 const people=want.map((key,i)=>{
  const [recognitionNo,recognitionSeq]=key.split('|');
  const exact=entries.filter(r=>keyOf(r.recognitionNo,r.recognitionSeq)===key);
  if(!exact.length)fail('TARGET_UNKNOWN',i);
  if(exact.length>1||entries.some(r=>r.recognitionNo===recognitionNo&&r.recognitionSeq!==recognitionSeq))fail('TARGET_AMBIGUOUS',i);
  const rows=list.filter(x=>plain(x)&&String(x.ltc)===recognitionNo);
  if(!rows.length)fail('TARGET_UNKNOWN',i);
  if(rows.length>1)fail('TARGET_AMBIGUOUS',i);
  const row=rows[0];
  if(typeof row.name!=='string'||!row.name||row.lpi===undefined||row.lpi===null||String(row.lpi)==='')fail('TARGET_UNKNOWN',i);
  return{key,recognitionNo,recognitionSeq,name:row.name,lpi:String(row.lpi),deskRecipientId:deskRecipientId(recognitionNo)};
 }).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
 return{kind:'recipients',keys:people.map(p=>p.key),people};
}

function checkNormalized(n){
 if(plain(n)&&n.kind==='all')return n;
 if(!plain(n)||n.kind!=='recipients'||!Array.isArray(n.keys)||!n.keys.length||!n.keys.every(isKey)||new Set(n.keys).size!==n.keys.length)fail('TARGETS_INVALID');
 return n;
}
// 안정 해시: 종류와 정렬된 키만 쓴다(이름·lpi는 명부 파일 해시로 따로 결속된다).
function targetsHash(normalized){
 const n=checkNormalized(normalized);
 return sha(JSON.stringify(n.kind==='all'?{kind:'all'}:{kind:'recipients',keys:[...n.keys].sort()}));
}
function selects(normalized,{recognitionNo,recognitionSeq}={}){
 const n=checkNormalized(normalized);if(n.kind==='all')return true;
 if(recognitionNo==null||recognitionSeq==null)return false;
 return n.keys.includes(keyOf(recognitionNo,recognitionSeq));
}
function selectsDeskRecipient(normalized,recipientId){
 const n=checkNormalized(normalized);if(n.kind==='all')return true;
 if(typeof recipientId!=='string')return false;
 return n.keys.some(k=>deskRecipientId(k.split('|')[0])===recipientId);
}
// 사람 목록(명부 행 {ltc,…}·계획 결과 {ltc,…}·대상 항목 {recognitionNo,recognitionSeq})에서 선택된 사람만 남긴다. 입력은 바꾸지 않는다.
// 차수가 있는 항목은 키 전체로, 없는 항목은 인정번호로 비교한다(선택 인정번호마다 차수가 하나임은 normalizeTargets가 보장).
function filterPeopleByRecognition(people,normalized){
 const n=checkNormalized(normalized);if(!Array.isArray(people))fail('TARGETS_INVALID');
 if(n.kind==='all')return[...people];
 const keys=new Set(n.keys),nos=new Set(n.keys.map(k=>k.split('|')[0]));
 return people.filter(p=>{
  if(!plain(p))return false;
  const no=p.recognitionNo??p.ltc;if(no==null)return false;
  return p.recognitionSeq!=null?keys.has(keyOf(no,p.recognitionSeq)):nos.has(String(no));
 });
}

module.exports={normalizeTargets,targetsHash,selects,selectsDeskRecipient,filterPeopleByRecognition,deskRecipientId};
