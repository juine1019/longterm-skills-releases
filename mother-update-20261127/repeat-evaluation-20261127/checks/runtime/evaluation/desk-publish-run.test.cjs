'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runPublication}=require('./desk-publish-run.cjs');
function journal(history=[]){let owned=false;return{history,get owned(){return owned;},read:()=>history,acquire(){owned=true;},append(e){assert(owned);history.push(e);},release(){owned=false;}};}
test('a publication attempt is journaled before network access and releases the lease after verification',async()=>{const j=journal(),r=await runPublication({journal:j,publish:async()=>{assert.equal(j.history.at(-1).type,'publish-attempt');return{status:'verified'};}});assert.equal(r.status,'verified');assert.equal(j.owned,false);assert.equal(j.history.at(-1).type,'publish-verified');});
test('an uncertain publication retains the lease and a later attempt is blocked',async()=>{const j=journal(),r=await runPublication({journal:j,publish:async()=>({status:'unknown'})});assert.equal(r.status,'unknown');assert.equal(j.owned,true);let called=false;const second=journal([...j.history]);await assert.rejects(runPublication({journal:second,publish:async()=>{called=true;}}),/PRIOR_DESK_PUBLISH_RECONCILE_ONLY/);assert.equal(called,false);});
test('a failure proven before a write releases the lease',async()=>{const j=journal(),r=await runPublication({journal:j,publish:async()=>({status:'not-written'})});assert.equal(r.status,'not-written');assert.equal(j.owned,false);});

test('an uncertain publication records the attempted draft key in its journal',async()=>{const j=journal(),r=await runPublication({journal:j,publish:async()=>({status:'unknown',code:'DESK_WRITE_UNCONFIRMED',evaluationKey:'a'.repeat(64)})});assert.equal(r.status,'unknown');assert.deepEqual([j.history.at(-1).type,j.history.at(-1).evaluationKey],['publish-unknown','a'.repeat(64)]);});

test('HTTP diagnostics remain in the unknown journal without releasing its lease',async()=>{
 const j=journal();await runPublication({journal:j,publish:async()=>({status:'unknown',code:'DESK_REQUEST_FAILED',httpStatus:400,serverCode:'INVALID_REVIEW'})});
 assert.equal(j.history.at(-1).httpStatus,400);assert.equal(j.history.at(-1).serverCode,'INVALID_REVIEW');assert(j.owned);
});
