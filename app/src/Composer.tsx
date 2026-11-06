import type { RefObject } from 'react';
import { AlertCircle, ArrowUp, AudioLines, Check, Layers2, LoaderCircle, Mic, X } from 'lucide-react';
import { ImageDrafts, ImagePicker, type ImageDraft } from './imageAttachments.tsx';
import type { CaptureStatus } from './voiceCapture.ts';
import type { VoicePhase } from './continuousVoice.ts';
import type { InputLevel } from './microphone.ts';

type ComposerProps = {
  micState: CaptureStatus;
  micLevel: InputLevel | null;
  elapsed: number;
  voicePhase: VoicePhase;
  record: () => void;
  cancelRecording: () => void;
  chooseMicrophone: () => void;
  images: ImageDraft[];
  imageUploading: boolean;
  removeImage: (id: string) => void;
  addImages: (files: File[]) => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: (text: string) => void;
  kind: 'chat' | 'work';
  setKind: (kind: 'chat' | 'work') => void;
  sending: boolean;
  connected: boolean;
  submit: () => void;
  /** The Chief reply being answered, shown above the input. */
  replyTo?: { name: string; text: string };
  cancelReply: () => void;
};

/** Bottom input pill: recording meter and image drafts above one row of mic, text, image, 安排任务 and send. */
export function Composer(props: ComposerProps) {
  const { micState, micLevel, elapsed, voicePhase, images, imageUploading, draft, kind, sending } = props;
  const micLabel =
    voicePhase === 'waiting'
      ? '继续说话'
      : voicePhase === 'speaking'
        ? '打断并说话'
        : micState === 'recording'
          ? '现在发送这句话'
          : '开启语音对话';
  return (
    <div className="composer-shell">
      {micState === 'recording' && (
        <div className="recording-input">
          <meter aria-label="录音输入音量" min={0} max={100} value={micLevel?.percent || 0} />
          <span>
            {micLevel?.muted ? '麦克风已静音' : micLevel && micLevel.rms > 0.00005 ? '已收到声音' : '等待麦克风声音'} ·{' '}
            {elapsed} 秒
          </span>
          <button onClick={props.chooseMicrophone}>选择麦克风</button>
        </div>
      )}
      {props.replyTo && (
        <div className="reply-quote">
          <span>
            回复 <strong>{props.replyTo.name}</strong>：{props.replyTo.text}
          </span>
          <button aria-label="取消回复" onClick={props.cancelReply}>
            <X size={13} />
          </button>
        </div>
      )}
      <ImageDrafts images={images} uploading={imageUploading} remove={props.removeImage} />
      <div className="composer-row">
        <button
          className={`mic-button ${micState === 'recording' ? 'recording' : ''}`}
          onClick={props.record}
          disabled={micState === 'starting' || micState === 'transcribing'}
          title={micLabel}
          aria-label={micLabel}
        >
          {micState === 'transcribing' || micState === 'starting' ? (
            <LoaderCircle size={22} className="spin" />
          ) : micState === 'recording' ? (
            <AudioLines size={23} />
          ) : (
            <Mic size={23} strokeWidth={1.6} />
          )}
        </button>
        {voicePhase !== 'off' ? (
          <>
            <div className="voice-conversation" aria-live="polite">
              <strong>
                {voicePhase === 'waiting'
                  ? '这句话正在发送…'
                  : voicePhase === 'speaking'
                    ? '正在回复，播完继续听'
                    : voicePhase === 'paused'
                      ? '语音暂时暂停'
                      : voicePhase === 'error'
                        ? '请检查麦克风后继续'
                        : '我在听，直接说就好'}
              </strong>
              <small>说完停顿 2 秒自动发送</small>
            </div>
            <button className="switch-to-typing" onClick={props.cancelRecording}>
              转为打字
            </button>
          </>
        ) : (
          <>
            <textarea
              onPaste={(event) => {
                const files = [...event.clipboardData.files];
                if (files.length) {
                  event.preventDefault();
                  props.addImages(files);
                }
              }}
              ref={props.composerRef}
              aria-label="和助理对话"
              value={draft}
              onChange={(event) => props.setDraft(event.target.value)}
              rows={1}
              placeholder={kind === 'work' ? '把要做的事告诉我，我来安排…' : '和我说说，接下来想做什么…'}
              aria-describedby="composer-keys"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  props.submit();
                }
              }}
            />
            <ImagePicker add={props.addImages} disabled={imageUploading || sending || !props.connected} />
            <button
              className={`task-chip ${kind === 'work' ? 'selected' : ''}`}
              onClick={() => props.setKind(kind === 'work' ? 'chat' : 'work')}
              aria-pressed={kind === 'work'}
              title={kind === 'work' ? '这条会交给小助理去做，再点一次改回对话' : '把这条交给小助理去做'}
            >
              <Layers2 size={15} />
              安排任务
            </button>
            <button
              className="send-button"
              aria-label="发送消息"
              title="发送"
              disabled={
                (!draft.trim() && !images.length) ||
                imageUploading ||
                sending ||
                micState !== 'idle' ||
                !props.connected
              }
              onClick={props.submit}
            >
              {sending ? <LoaderCircle className="spin" size={20} /> : <ArrowUp size={22} />}
            </button>
          </>
        )}
      </div>
      <span id="composer-keys" className="sr-only">
        Enter 发送，Shift + Enter 换行
      </span>
    </div>
  );
}

type ComposerFeedbackProps = {
  error: string;
  notice: string;
  retryAvailable: boolean;
  checkMicrophone: () => void;
  openStatus: () => void;
  retry: () => void;
  dismiss: () => void;
};

/** Error or notice line under the composer, with the one action that fixes it. */
export function ComposerFeedback({
  error,
  notice,
  retryAvailable,
  checkMicrophone,
  openStatus,
  retry,
  dismiss,
}: ComposerFeedbackProps) {
  return (
    <div className={`composer-feedback ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>
      {error ? <AlertCircle size={14} /> : <Check size={14} />}
      <span>{error || notice}</span>
      {error && /麦克风|录音|声音/.test(error) && (
        <button className="microphone-help" onClick={checkMicrophone}>
          检查麦克风
        </button>
      )}
      {error && /模型|LLM|Saturn Cloud|网页验证|上游|服务/.test(error) && (
        <button className="microphone-help" onClick={openStatus}>
          查看状态
        </button>
      )}
      {retryAvailable && (
        <button className="microphone-help" onClick={retry}>
          重试
        </button>
      )}
      <button aria-label="关闭提示" onClick={dismiss}>
        <X size={13} />
      </button>
    </div>
  );
}
