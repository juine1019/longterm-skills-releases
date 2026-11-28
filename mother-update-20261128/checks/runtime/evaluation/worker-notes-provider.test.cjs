'use strict';
// 6-1 특이사항 읽기가 로컬 보관소의 확정월 원문을 재사용하는지(상세 재조회 0회) 합성 자료로 확인한다.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {nativeEvidenceAdapter}=require('./native-evidence-adapter.cjs'),C=require('../context.cjs'),W=require('../worker-notes-store.cjs');
const ORG={id:'ORG',name:'기관'},NOW=Date.parse('2026-11-17T03:00:00Z');
const context={orgId:'ORG',workerId:'WORKER',workerName:'NAME',recipientId:'R|1',recognitionNo:'LSYN000A',recognitionSeq:'1',planId:'PLAN',serviceCode:'001'};
const request={context,recipientName:'가상어르신',period:{from:'2026-09-15',to:'2026-10-28'},evaluationDate:'2026-10-28'};
function pair(i,ltc,day,note,seq='1'){const h=Object.fromEntries(W.LIST_KEYS.map(k=>[k,'']));Object.assign(h,{FNM:'가상어르신',LTC_MGMT_NO:ltc,RECU_SFF_NM:'가상보호사',LTCP_CLSFC_CD:'001',LTCP_FR_DT:day,LTCP_OFFR_YYYYMM:day.slice(0,6),RFID_ADM_NO:'ADM'+i,TAG_ID:'TAG'+i,READER_NO:'RD1',LTCP_FR_DTHMS:day+'0900',LTCP_TO_DTHMS:day+'1200',USE_YN:'Y',DEL_YN:'N'});
 const d=Object.fromEntries(W.DETAIL_KEYS.map(k=>[k,k in h?h[k]:'']));Object.assign(d,{LTC_MGMT_NO_SEQ:seq,ORI_LTC_ADMIN_SYM:'ORG',PCLR_COMT_CONTN:note,FMLY_YN:'N',DEL_YN:'N'});return{header:h,detail:d};}
const october=[pair(0,'LSYN000A','20261005','가상 원문 10월'),pair(1,'LSYN000B','20261006','다른 어르신'),pair(2,'LSYN000A','20261030','관찰 기간 밖')];
const september=[pair(3,'LSYN000A','20260920','가상 원문 9월')];
const batch=rows=>({ok:true,out:{format:'lt-spec-batch/2',org:{id:'ORG',type:'20A'},from:'20261001',to:'20261031',filters:{SEARCH_GBN:'',SEARCH_VALUE:'',LTCP_CLSFC_CD:'',SVC_TRANS_TYPE_CD:'',SVC_CONTN_SAVE_YN:'',SVC_PROC:'',LTC_ADMIN_SYM:''},total:rows.length,offset:0,end:rows.length,screenTotal:null,records:rows.map((r,i)=>({i,prs:r.header.FNM,worker:r.header.RECU_SFF_NM,ltc:r.header.LTC_MGMT_NO,fr:r.detail.LTCP_FR_DTHMS,to:r.detail.LTCP_TO_DTHMS,fmly:'N',cls:'001',note:r.detail.PCLR_COMT_CONTN,save:'Y',header:r.header,detail:r.detail})),skipped:0,skippedRows:[],errors:[],mismatches:0,blocked:0,popupsLeft:0,startedAt:'2026-11-10T00:00:00.000Z',finishedAt:'2026-11-10T00:00:10.000Z'}});
function workspace(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lt-wn-provider-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 C.writeNewJson(path.join(root,'longterm.workspace.json'),{schemaVersion:1,organization:ORG,operator:{name:'NAME',job:'직원'},origins:{lt:'https://lt.example.test',ltRfid:'https://rfid.example.test',cm:'https://cm.example.test',desk:'https://desk.example.test',ez:'https://ez.example.test'},policy:{accepted:true,version:'test'}});
 const c=C.loadContext(root);C.writeNewJson(path.join(c.stateRoot,'browser-bindings.json'),{schemaVersion:1,configHash:c.configHash,targets:[{service:'lt',targetId:'LT',role:'20L'},{service:'ltRfid',targetId:'RFID',role:'20A'}]});
 return{root,store:W.storeForContext(c)};
}
// 가짜 RFID 화면: 월 목록은 이 수급자 행만, 상세는 같은 원천 행을 돌려준다. 호출 수를 센다.
function fakeBridge(){const calls=[],all=[...september,...october];return{calls,bridge:async source=>{const p=JSON.parse(source.match(/page\.evaluate\(.*?,(\{"action".*\})\);console/s)[1]);
 if(p.action==='month'){calls.push('month:'+p.month);const to=p.period.to.replaceAll('-','');return{ok:true,result:{ok:true,headers:all.filter(r=>r.header.LTC_MGMT_NO===p.context.recognitionNo&&r.header.LTCP_OFFR_YYYYMM===p.month&&r.header.LTCP_FR_DT<=to).map(r=>r.header),month:p.month,listTotal:{rows:1,total:1}}};}
 if(p.action==='details'){calls.push('details');return{ok:true,result:{ok:true,records:p.headers.map(h=>all.find(r=>r.header.RFID_ADM_NO===h.RFID_ADM_NO))}};}
 return{ok:true,result:{ok:true,screenPreserved:true}};}};}

test('기본으로 작업공간 보관소를 쓰며, 확정월은 보관소 원문을 재사용해 목록·상세 재조회 0회, 미확정월만 실제로 읽고 결과 기록은 실제 읽기와 같다',async t=>{
 const {root,store}=workspace(t);await store.ensureMonth('2026-10',{collect:async()=>[batch(october)],now:NOW,closing:{kind:'input-closed',month:'2026-10',organizationId:'ORG',confirmedAt:'2026-11-05T00:00:00.000Z',evidence:'가상 입력 마감 확인'}});
 const live=fakeBridge(),a=nativeEvidenceAdapter(root,request,{bridge:live.bridge,workerNotesProvider:null}),s1=await a.captureScreen(),plain=await a.readWorkerNotes();await a.assertScreenUnchanged(s1);
 const reuse=fakeBridge(),b=nativeEvidenceAdapter(root,request,{bridge:reuse.bridge}),s2=await b.captureScreen(),stored=await b.readWorkerNotes();await b.assertScreenUnchanged(s2);
 assert.deepEqual(live.calls,['month:202609','details','month:202610','details']);
 assert.deepEqual(reuse.calls,['month:202609','details']);
 assert.equal(stored.status,'complete');assert.deepEqual(stored.records,plain.records);assert.equal(stored.records.length,2);
 assert.deepEqual(stored.coverage.map(x=>[x.month,x.status,x.count]),[['202609','complete',1],['202610','complete',1]]);
 assert.equal(stored.coverage[1].storedSnapshot.sha256,store.status('2026-10').snapshot.sha256);assert.equal(stored.coverage[1].storedSnapshot.collectedAt,'2026-11-10T00:00:00.000Z');
});

test('미확정 보관 자료는 쓰지 않고 실제로 읽으며, 다른 차수 원천은 빈 기록이 아니라 실패로 남긴다',async t=>{
 const {root,store}=workspace(t);await store.ensureMonth('2026-10',{collect:async()=>[batch(october)],now:NOW});
 const live=fakeBridge(),a=nativeEvidenceAdapter(root,request,{bridge:live.bridge,workerNotesProvider:store}),s=await a.captureScreen();await a.readWorkerNotes();await a.assertScreenUnchanged(s);
 assert.deepEqual(live.calls,['month:202609','details','month:202610','details']);
 const other=workspace(t);await other.store.ensureMonth('2026-10',{collect:async()=>[batch([pair(0,'LSYN000A','20261005','가상','2')])],now:NOW,closing:{kind:'claim-request',month:'2026-10',organizationId:'ORG',confirmedAt:'2026-11-05T00:00:00.000Z',evidence:'가상 청구의뢰 확인'}});
 const f=fakeBridge(),b=nativeEvidenceAdapter(other.root,request,{bridge:f.bridge,workerNotesProvider:other.store}),s2=await b.captureScreen(),read=await b.readWorkerNotes();await b.assertScreenUnchanged(s2);
 assert.equal(read.status,'partial');assert.equal(read.error.code,'RFID_RECOGNITION_SEQUENCE_CHANGED');assert.deepEqual(read.coverage.map(x=>[x.month,x.status]),[['202609','complete'],['202610','failed']]);
});

test('local prior-month mode reads collected records using worker tab only and closes worker session',async t=>{
 const {root,store}=workspace(t);await store.ensureMonth('2026-10',{collect:async()=>[batch(october)],now:NOW});
 const c=C.loadContext(root),bindingPath=path.join(c.stateRoot,'browser-bindings.json');fs.writeFileSync(bindingPath,JSON.stringify({schemaVersion:1,configHash:c.configHash,targets:[{service:'lt',targetId:'LT',role:'20L'}]}));
 const r={...request,period:{from:'2026-10-01',to:'2026-12-05'},evaluationDate:'2026-11-20',evidenceObservedTo:'2026-10-31',workerNotesMode:'local-prior-month'};
 const f=fakeBridge(),adapter=nativeEvidenceAdapter(root,r,{bridge:f.bridge}),session=await adapter.captureScreen(),read=await adapter.readWorkerNotes();await adapter.assertScreenUnchanged(session);
 assert.equal(read.status,'complete');assert.equal(read.records.length,2);assert.equal(read.coverage[0].storedSnapshot.state,'collected');assert.deepEqual(f.calls,[]);
});
