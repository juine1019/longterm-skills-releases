'use strict';
// Decide only: caller must use the existing guarded transport and verify the UI.
function decide({operation, boundSessionVerified, navigationRequired, existingEdit, isolatedTabVerified}) {
 if (!['read','authorized-write'].includes(operation) || typeof boundSessionVerified !== 'boolean' || typeof navigationRequired !== 'boolean' || !['clean','dirty','unknown'].includes(existingEdit) || typeof isolatedTabVerified !== 'boolean') throw Error('INVALID_SCREEN_STATE');
 if (!boundSessionVerified) return 'verify-session';
 if (!navigationRequired) return 'use-guarded-transport';
 if (existingEdit === 'clean') return 'use-current-screen';
 if (isolatedTabVerified) return 'use-verified-isolated-tab';
 return 'preserve-screen-and-check-isolation';
}
module.exports={decide};
