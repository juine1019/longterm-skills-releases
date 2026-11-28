'use strict';
// Only this exact, observed timeout notice is eligible for automatic confirmation.
function isTimeoutNotice(type,message){
 return (type==='confirm'||type==='alert')&&/^\s*\[접속대기시간\s*초과\]\s*다시\s*접속하여\s*주시기\s*바랍니다\.\s*$/.test(message);
}
async function handleTimeout(dialog){
 if(!isTimeoutNotice(dialog.type(),dialog.message()))return {handled:false};
 await dialog.accept();return {handled:true,code:'LT_CONNECTION_TIMEOUT_NOTICE'};
}
module.exports={isTimeoutNotice,handleTimeout};
