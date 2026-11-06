import { VolumeX } from 'lucide-react';
import { captionText } from './projection.ts';
import type { CaptureStatus } from './voiceCapture.ts';
import type { PlaybackState } from './speech.ts';

type CaptionInput = {
  micState: CaptureStatus;
  interimSpeech: string;
  elapsed: number;
  playback: PlaybackState;
  streamText?: string;
  chatBusy: boolean;
  viewingWork: boolean;
  lastReply?: { text?: string; at: number };
};

/** The one short line under the portrait: listening, transcribing, speaking, thinking or the latest reply. */
export function captionFor(input: CaptionInput) {
  const { micState, interimSpeech, elapsed, playback, streamText, chatBusy, viewingWork, lastReply } = input;
  return micState === 'starting'
    ? '正在准备麦克风与本地人声检测…'
    : micState === 'recording'
      ? interimSpeech
        ? captionText(interimSpeech)
        : `我在听 · ${elapsed} 秒`
      : micState === 'transcribing'
        ? '正在把你的话转成文字…'
        : playback.status !== 'idle'
          ? playback.caption
          : streamText
            ? captionText(streamText)
            : chatBusy
              ? '让我想一想，马上回来。'
              : viewingWork
                ? '正在查看工作，随时可以和我说话。'
                : lastReply?.text && lastReply.at > Date.now() - 30000
                  ? captionText(lastReply.text)
                  : '我在，慢慢说。';
}

type CaptionProps = { personaState: string; caption: string; speaking: boolean; stopSpeaking: () => void };

export function Caption({ personaState, caption, speaking, stopSpeaking }: CaptionProps) {
  return (
    <div className="caption-block" aria-live="polite">
      <span className={`persona-status ${personaState}`} /> <p>{caption}</p>
      {speaking && (
        <button className="caption-stop" aria-label="打断播报" onClick={stopSpeaking}>
          <VolumeX size={16} />
        </button>
      )}
    </div>
  );
}

type ActivityInput = {
  voicePhase: string;
  micState: CaptureStatus;
  speaking: boolean;
  chatBusy: boolean;
  busyHelpers: string[];
  workCount: number;
};

/** What she is doing right now, from real state only; empty when nothing is happening. */
export function activityFor({ voicePhase, micState, speaking, chatBusy, busyHelpers, workCount }: ActivityInput) {
  const parts: string[] = [];
  if (speaking || voicePhase === 'speaking') parts.push('正在回答');
  else if (micState === 'recording' || voicePhase === 'listening') parts.push('在听你说');
  else if (chatBusy) parts.push('在想…');
  if (busyHelpers.length === 1) parts.push(`${busyHelpers[0]}正在处理`);
  else if (busyHelpers.length > 1) parts.push(`${busyHelpers.length} 位小助理在工作`);
  // One busy helper already says enough for one running work.
  if (workCount > 1 || (workCount === 1 && busyHelpers.length !== 1)) parts.push(`${workCount} 项工作进行中`);
  return parts.join('，');
}

export function ActivityLine({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p className="activity-line">
      <span className="activity-dot" aria-hidden="true" />
      {text}
    </p>
  );
}
