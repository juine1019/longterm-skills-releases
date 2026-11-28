'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{handleTimeout}=require('./timeout-dialog.cjs');
function dialog(type,message){let accepted=0;return{type:()=>type,message:()=>message,accept:async()=>{accepted++},count:()=>accepted};}
test('the observed timeout notice is accepted once',async()=>{const d=dialog('confirm','[접속대기시간 초과] 다시 접속하여 주시기 바랍니다.');assert.equal((await handleTimeout(d)).handled,true);assert.equal(d.count(),1);});
test('save, deletion, other notices and prompts are left for their own workflows',async()=>{for(const [type,message] of [['confirm','저장 하시겠습니까?'],['confirm','삭제하시겠습니까?'],['alert','오류가 발생했습니다.'],['prompt','[접속대기시간 초과] 다시 접속하여 주시기 바랍니다.']]){const d=dialog(type,message);assert.equal((await handleTimeout(d)).handled,false);assert.equal(d.count(),0);}});
test('an unsuccessful acknowledgement is never treated as handled',async()=>{const d=dialog('confirm','[접속대기시간 초과] 다시 접속하여 주시기 바랍니다.');d.accept=async()=>{throw Error('UNAVAILABLE')};await assert.rejects(handleTimeout(d),/UNAVAILABLE/);});
