'use strict';
const expected={careRecordEvidence:1,policyBinding:'organization-and-sha256',recordContent:'explicit-preserved',emptyNotes:'preserved-empty',exportContent:'prepared-records-only',duplicateProtection:'request-id-and-body-hash',conditionalWrite:'expected-version'};
function checkCompatibility(observed,{deskId,month}){
 const reasons=[];if(observed?.orgId!==deskId)reasons.push('DESK_ORGANIZATION_CHANGED');if(observed?.month!==month)reasons.push('CARE_RECORD_MONTH_CHANGED');if(!Number.isSafeInteger(observed?.version)||observed.version<0)reasons.push('CARE_RECORD_VERSION_UNCONFIRMED');
 for(const[k,v]of Object.entries(expected))if(observed?.capabilities?.[k]!==v)reasons.push('CAPABILITY_REQUIRED:'+k);
 return{ok:reasons.length===0,status:reasons.length?'incompatible-no-publication':'declared-compatible-integration-unverified',reasons,publicationEnabled:false,roundtripAndExportVerified:false,siteWrites:0};
}
async function readCompatibilityPage(a){
 if(location.origin!==a.origin)throw Error('SERVICE_ORIGIN_CHANGED');const r=await fetch('/api/care-records?month='+encodeURIComponent(a.month),{credentials:'same-origin',cache:'no-store'});if(!r.ok||r.redirected)throw Error('CARE_RECORD_COMPATIBILITY_READ_FAILED');const j=await r.json();
 // Deliberately omit recipients, records and every other business field.
 const names=['careRecordEvidence','policyBinding','recordContent','emptyNotes','exportContent','duplicateProtection','conditionalWrite'],capabilities=Object.fromEntries(names.map(k=>[k,['string','number','boolean'].includes(typeof j.capabilities?.[k])?j.capabilities[k]:null]));
 return{orgId:j.orgId,month:j.month,version:j.version,capabilities};
}
module.exports={expected,checkCompatibility,readCompatibilityPage};
