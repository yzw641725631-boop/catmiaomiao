import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { SpeechController, type PlaybackState } from './speech.ts';
import { VoiceCapture, type CaptureStatus } from './voiceCapture.ts';
import { ContinuousVoice, type VoicePhase } from './continuousVoice.ts';
import { VoiceOwnership } from './voiceOwnership.ts';
import type { InputLevel } from './microphone.ts';
import type { ImageDraft } from './imageAttachments.tsx';
import type { CompanionInfo } from './types.ts';
import type { useCompanion } from './useCompanion.ts';

type Backend = ReturnType<typeof useCompanion>;
type SettingsTab = 'model' | 'voice' | 'memory' | 'appearance';

/** Latest values read by long-lived voice callbacks; App refreshes it on every render. */
export type VoiceRuntime = { backend: Backend; kind: 'chat' | 'work'; info: CompanionInfo | null; settings: boolean };

type VoiceOptions = {
  runtime: MutableRefObject<VoiceRuntime>;
  imagesRef: MutableRefObject<ImageDraft[]>;
  backend: Backend;
  info: CompanionInfo | null;
  connected: boolean;
  sending: boolean;
  settings: SettingsTab | null;
  setSettings: (tab: SettingsTab) => void;
  setPinned: Dispatch<SetStateAction<boolean>>;
  setPanel: Dispatch<SetStateAction<boolean>>;
  setTab: Dispatch<SetStateAction<'all' | 'work'>>;
  setSelectedWork: Dispatch<SetStateAction<string | null>>;
  setImages: Dispatch<SetStateAction<ImageDraft[]>>;
  setKind: Dispatch<SetStateAction<'chat' | 'work'>>;
  setDraft: Dispatch<SetStateAction<string>>;
};

/** Microphone capture, continuous voice conversation and reply playback. */
export function useVoice(options: VoiceOptions) {
  const { runtime, imagesRef, backend, info, connected, sending, settings, setSettings } = options;
  const { setPinned, setPanel, setTab, setSelectedWork, setImages, setKind, setDraft } = options;
  const [playback, setPlayback] = useState<PlaybackState>({ status: 'idle', caption: '' });
  const speaker = useMemo(() => new SpeechController(setPlayback), []);
  const [micState, setMicState] = useState<CaptureStatus>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [micLevel, setMicLevel] = useState<InputLevel | null>(null);
  const capture = useRef<VoiceCapture | null>(null);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('off');
  const voiceOwnership = useMemo(() => new VoiceOwnership(), []);
  const voiceClaiming = useRef(false);
  const [interimSpeech, setInterimSpeech] = useState('');
  const voiceSession = useMemo(
    () =>
      new ContinuousVoice({
        changed: setVoicePhase,
        stopSpeech: () => speaker.stop(),
        capture: (handlers) => {
          const current = runtime.current;
          setElapsed(0);
          setInterimSpeech('');
          setMicLevel(null);
          const recorder = new VoiceCapture(
            { status: setMicState, partial: setInterimSpeech, elapsed: setElapsed, level: setMicLevel, ...handlers },
            voiceOwnership.id,
          );
          capture.current = recorder;
          void recorder.start(
            current.info?.provider === 'reachai' && current.info.asr.mode === 'realtime' ? 'realtime' : 'file',
          );
          return recorder;
        },
        submit: async (text, arm) => {
          const current = runtime.current,
            purpose = current.kind;
          setPinned(true);
          setPanel(true);
          setTab(purpose === 'work' ? 'work' : 'all');
          setSelectedWork(null);
          const sent = await current.backend.send(text, purpose, arm, imagesRef.current, 'voice');
          if (sent) setImages([]);
          if (sent) {
            setKind('chat');
            current.backend.setNotice(purpose === 'work' ? '工作已交给助理，我会继续听。' : '');
          }
          return sent && purpose === 'work' ? 'background' : sent;
        },
        speak: async (text) => {
          if (runtime.current.info?.voice.ready) await speaker.speak(text);
        },
        failed: (message, partial) => {
          if (partial) setDraft((previous) => [previous, partial].filter(Boolean).join('\n'));
          runtime.current.backend.setError(message);
        },
      }),
    [speaker, voiceOwnership],
  );

  useEffect(() => {
    voiceOwnership.onLost = (message) => {
      voiceSession.stop();
      runtime.current.backend.setError(message);
    };
    return () => voiceOwnership.release();
  }, [voiceOwnership, voiceSession]);
  useEffect(
    () => () => {
      voiceSession.stop();
    },
    [voiceSession],
  );
  useEffect(() => {
    if (playback.error) backend.setError(playback.error);
  }, [playback.error]);
  useEffect(() => {
    if (settings || !connected) voiceSession.pause();
    else voiceSession.resume();
  }, [settings, connected, voiceSession]);

  const record = async () => {
    if (voiceSession.enabled && micState === 'recording') {
      await voiceSession.finish();
      return;
    }
    if (voiceSession.enabled && voicePhase === 'speaking') {
      voiceSession.interrupt();
      return;
    }
    if (voiceSession.enabled && voicePhase === 'waiting') {
      voiceSession.interrupt();
      return;
    }
    if (micState !== 'idle' || sending || voiceClaiming.current) return;
    if (!info?.asr.configured) {
      setSettings('voice');
      backend.setNotice('先连接语音识别服务，就可以直接说话。');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext || !window.AudioWorkletNode) {
      backend.setError('请使用支持麦克风和 AudioWorklet 的新版 Chrome 或 Edge。');
      return;
    }
    const realtime = info.provider === 'reachai' && info.asr.mode === 'realtime';
    if (!realtime && !window.MediaRecorder) {
      backend.setError('当前浏览器不支持录音，请使用新版 Chrome 或 Edge。');
      return;
    }
    backend.setError('');
    backend.setNotice('');
    voiceClaiming.current = true;
    try {
      if (await voiceOwnership.claim()) voiceSession.start();
    } catch (error) {
      backend.setError(error instanceof Error ? error.message : '语音暂未连接，请重试。');
    } finally {
      voiceClaiming.current = false;
    }
  };
  const cancelRecording = () => {
    voiceSession.stop();
    voiceOwnership.release();
    capture.current = null;
    setMicState('idle');
    setInterimSpeech('');
  };
  const play = useCallback(
    (text: string) => {
      if (!info?.voice.ready) {
        setSettings('voice');
        return;
      }
      const resume = voiceSession.enabled;
      if (resume) voiceSession.pause();
      void speaker.speak(text).finally(() => {
        if (resume && !runtime.current.settings) voiceSession.resume();
      });
    },
    [info?.voice.ready, speaker, voiceSession],
  );

  return {
    playback,
    speaker,
    micState,
    elapsed,
    micLevel,
    voicePhase,
    voiceSession,
    voiceOwnership,
    interimSpeech,
    record,
    cancelRecording,
    play,
  };
}
