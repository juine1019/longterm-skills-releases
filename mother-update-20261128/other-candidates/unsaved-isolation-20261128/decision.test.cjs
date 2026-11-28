'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{decide}=require('./decision.cjs');
const base={operation:'read',boundSessionVerified:true,navigationRequired:false,existingEdit:'dirty',isolatedTabVerified:false};
test('guarded transport can read without moving an edited screen',()=>assert.equal(decide(base),'use-guarded-transport'));
test('authorized publication may use guarded transport without navigating',()=>assert.equal(decide({...base,operation:'authorized-write'}),'use-guarded-transport'));
test('never navigate dirty or unknown screen without verified isolation',()=>{for(const existingEdit of ['dirty','unknown'])assert.equal(decide({...base,navigationRequired:true,existingEdit}),'preserve-screen-and-check-isolation');});
test('verified isolated tab or clean screen permits navigation',()=>{assert.equal(decide({...base,navigationRequired:true,isolatedTabVerified:true}),'use-verified-isolated-tab');assert.equal(decide({...base,navigationRequired:true,existingEdit:'clean'}),'use-current-screen');});
test('session and explicit states are required',()=>{assert.equal(decide({...base,boundSessionVerified:false}),'verify-session');assert.throws(()=>decide({...base,existingEdit:undefined}));});
