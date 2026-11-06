// An explicit classifier boundary for transport/controller tests. Real Silero
// inference is exercised separately by vad-check.html, not approximated by RMS.
export function speechGateFixture(){
  let callbacks,confirmed=false,stopped=false;
  return {factory:handlers=>{callbacks=handlers;return {get hasSpeech(){return confirmed;},async start(){},stop(){stopped=true;}};},speech(){if(!stopped){confirmed=true;callbacks.speech();}},end(){if(!stopped&&confirmed)callbacks.end();},get stopped(){return stopped;}};
}
