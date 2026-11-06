export interface SpeechGateCallbacks { speech():void; end():void }
export interface SpeechGate { readonly hasSpeech:boolean; start(stream:MediaStream,context:AudioContext):Promise<void>; stop():void|Promise<void> }
export type SpeechGateFactory=(callbacks:SpeechGateCallbacks)=>SpeechGate;

export const createSpeechGate:SpeechGateFactory=callbacks=>{
  let closed=false,confirmed=false,initializing:Promise<void>|undefined,vad:import('@ricky0123/vad-web').MicVAD|undefined;
  const release=async()=>{const detector=vad;vad=undefined;if(detector)await detector.destroy().catch(()=>{});};
  return {
    get hasSpeech(){return confirmed;},
    start(stream,context){
      initializing=(async()=>{
      const {MicVAD}=await import('@ricky0123/vad-web');if(closed)return;
      const detector=await MicVAD.new({
        model:'v5',startOnLoad:false,processorType:'AudioWorklet',audioContext:context,
        baseAssetPath:'/audio/vad/',onnxWASMBasePath:'/audio/vad/',
        ortConfig:ort=>{ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;},
        getStream:async()=>stream,pauseStream:async()=>{},resumeStream:async()=>stream,
        positiveSpeechThreshold:0.65,negativeSpeechThreshold:0.35,
        minSpeechMs:320,redemptionMs:2000,preSpeechPadMs:600,
        submitUserSpeechOnPause:false,
        onSpeechRealStart:()=>{if(!closed){confirmed=true;callbacks.speech();}},
        onSpeechEnd:()=>{if(!closed&&confirmed)callbacks.end();},
      });
      // Reuse the caller-owned stream; never acquire a second microphone.
      // MicVAD's destroy requires initialized audio nodes.
      vad=detector;
      try{await detector.start();if(!detector.listening&&!closed)throw new Error(detector.errored||'VAD did not start');}catch(error){await release();if(!closed)throw new Error('本地人声检测未能启动，请重新开启语音。',{cause:error});}
      if(closed)await release();
      })().catch(async error=>{
        await release();
        if(!closed)throw new Error('语音人声检测未能加载，请刷新页面后重新开启语音。',{cause:error});
      });return initializing;
    },
    stop(){closed=true;return (initializing||Promise.resolve()).catch(()=>{}).then(release);},
  };
};
