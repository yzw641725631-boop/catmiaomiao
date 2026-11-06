import { useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronRight, CornerUpLeft, FileCheck2, SmilePlus, Volume2 } from 'lucide-react';
import { MessageMarkdown } from './MessageMarkdown.ts';
import { MessageImages } from './imageAttachments.tsx';
import { isHelperQuestion, visibleMessageText } from './projection.ts';
import { activityTitle } from './work.ts';
import { SkillReceipt } from './SkillReceipt.tsx';
import { skillProposal } from './skillUi.ts';
import { creationProposal } from './teamUi.ts';
import { fileApprovalDetails, workspaceApproval } from './approvalText.ts';
import type { WireMessage } from './types.ts';
import { SpecialCard } from './SpecialCards.tsx';
import { SPECIAL_KINDS } from './specialKinds.ts';

/** Upstream's reaction set (shared/reactions.ts). 👍 and 👎 also answer the message as a reply. */
const REACTIONS: Array<[string, string]> = [
  ['👍', '赞同，作为回复'],
  ['👎', '不赞同，作为回复'],
  ['❤️', '喜欢'],
  ['😂', '好笑'],
  ['🎉', '庆祝'],
  ['👀', '我看到了'],
];

// One row in the conversation or work record: text, helper question, approval card, activity step or digest.
export function ChatMessage({
  message,
  threadId,
  name,
  work,
  speak,
  respond,
  openEvidence,
  questionAnswered,
  questionExpired,
  replyToHelper,
  managePermissions,
  reply,
  react,
  quoted,
  botId,
}: {
  message: WireMessage;
  threadId: string;
  name: string;
  work: boolean;
  speak: (text: string) => void;
  respond: (requestId: string, behavior: string, answer?: string, reviewedSha256?: string) => Promise<void>;
  openEvidence: () => void;
  managePermissions: () => void;
  questionAnswered: boolean;
  questionExpired?: boolean;
  replyToHelper: (text: string, sendId: string) => Promise<void>;
  /** Main-conversation replies of the Chief only: quote it in the composer. */
  reply?: () => void;
  /** Main-conversation replies of the Chief only. */
  react?: (emoji: string) => Promise<void>;
  /** The message this one replied to, for the inline quote. */
  quoted?: { name: string; text: string };
  /** Bot that owns this thread; widget, secret and sign-in cards answer through it. */
  botId?: string;
}) {
  const [picking, setPicking] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState('');
  const replyId = useRef(crypto.randomUUID());
  if (isHelperQuestion(message))
    return (
      <article className="message assistant work-message">
        <div className="message-avatar">
          <span />
        </div>
        <div className="message-main">
          <div className="message-meta">
            <strong>
              {name}
              <span className="source-tag">工作</span>
            </strong>
          </div>
          <div className="approval-card">
            <strong>需要补充说明</strong>
            <p>{message.tool!.name.split(' needs your input: ').slice(1).join(' needs your input: ')}</p>
            {questionAnswered || questionExpired ? (
              <span className="field-note">{questionExpired ? '这次等待已超时结束' : '已回答'}</span>
            ) : (
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (answering || !answer.trim()) return;
                  setAnswering(true);
                  setError('');
                  try {
                    await replyToHelper(answer, replyId.current);
                  } catch (error) {
                    setError(error instanceof Error ? error.message : '回答未发送');
                  } finally {
                    setAnswering(false);
                  }
                }}
              >
                <input
                  aria-label="补充工作说明"
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  required
                />
                <button className="primary-button" disabled={answering}>
                  发送补充说明
                </button>
              </form>
            )}
            {error && <p className="feedback error">{error}</p>}
          </div>
        </div>
      </article>
    );
  if (message.kind === 'digest') {
    const digest = message.digest;
    if (
      !digest ||
      !(
        digest.files?.added.length ||
        digest.files?.changed.length ||
        digest.files?.deleted.length ||
        digest.tools.length
      )
    )
      return null;
    const count = digest.files
      ? digest.files.added.length + digest.files.changed.length + digest.files.deleted.length
      : 0;
    if (!work) return <p className="field-note">本轮工具操作已记录，可在步骤详情中查看。</p>;
    return (
      <button className="digest-row" onClick={openEvidence}>
        <FileCheck2 size={18} />
        <span>
          {count
            ? `记录了 ${count} 个文件的变化`
            : `记录了 ${digest.toolCalls ?? digest.tools.reduce((n, tool) => n + tool.count, 0)} 次工具操作`}
          <small>查看工作证据</small>
        </span>
        <ChevronRight size={15} />
      </button>
    );
  }
  const bot = message.role === 'bot';
  const card = message.card;
  const creation = creationProposal(card);
  const skill = skillProposal(card);
  const surfaceTool = /^(?:computer_|browser_)/.test(card?.tool || '');
  const approvalTitle = skill
    ? skill.skill.action === 'create'
      ? '保存新技能'
      : '更新技能'
    : creation
      ? '创建小助理'
      : (card?.tool && workspaceApproval[card.tool]) ||
        (surfaceTool ? (card?.tool?.startsWith('computer_') ? '操作这台电脑' : '操作专用浏览器') : card?.title);
  const fileApproval = fileApprovalDetails(card?.tool, card?.subtitle);
  const approvalSubtitle = skill
    ? skill.skill.gist || (skill.applied ? '已保存这套做法。' : '阅读下面的做法，确认后用于后续工作。')
    : creation
      ? creation.status === '已创建'
        ? '以下成员已加入团队，可以交给他们工作。'
        : '主助理准备添加以下成员。确认后，他们会加入团队并可接收工作。'
      : fileApproval?.summary ||
        (surfaceTool
          ? `${name}需要执行一次${card?.tool?.startsWith('computer_') ? '电脑' : '网页'}操作。`
          : card?.subtitle);
  const closed = card?.answered || card?.dismissed || card?.expired;
  const act = async (behavior: string, text?: string) => {
    if (!card?.requestId || answering) return;
    setAnswering(true);
    setError('');
    try {
      if (skill && behavior === 'allow' && !skill.hash)
        throw new Error('这条技能提议缺少可核对的内容版本，请让助理重新生成。');
      await respond(card.requestId, behavior, text, behavior === 'allow' ? skill?.hash : undefined);
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作未完成');
    } finally {
      setAnswering(false);
    }
  };
  if (message.kind === 'activity')
    return (
      <article className={`work-step ${message.tool?.ok === false ? 'step-failed' : 'step-done'}`}>
        <span className="step-icon">
          {message.tool?.ok === false ? <AlertCircle size={15} /> : <Check size={15} />}
        </span>
        <details>
          <summary>
            <strong>{activityTitle(message)}</strong>
            <span>
              {name} · {new Date(message.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </span>
            <ChevronDown size={13} />
          </summary>
          <pre>
            {message.tool?.name || message.text}
            {message.tool?.output ? '\n\n' + message.tool.output : ''}
          </pre>
        </details>
      </article>
    );
  return (
    <article id={'message-' + message.id} className={`message ${bot ? 'assistant' : 'user'} ${work ? 'work-message' : ''}`}>
      <div className="message-avatar">{bot ? <span /> : '你'}</div>
      <div className="message-main">
        <div className="message-meta">
          <strong>
            {bot ? name : '你'}
            {work && <span className="source-tag">工作</span>}
          </strong>
          <time>{new Date(message.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>
        </div>
        {message.kind === 'options' && card ? (
          <div className="approval-card">
            <strong>{approvalTitle}</strong>
            <p>{approvalSubtitle}</p>
            {surfaceTool && card?.subtitle && (
              <details className="approval-parameters">
                <summary>
                  查看这次操作的内容
                  <ChevronDown size={12} />
                </summary>
                <pre>{card.subtitle}</pre>
              </details>
            )}
            {creation?.people.map((person) => (
              <div className="creation-preview" key={person.id}>
                <h4>{person.name}</h4>
                <p>{person.role}</p>
                {person.instructions && (
                  <details>
                    <summary>查看工作方式</summary>
                    <p>{person.instructions}</p>
                  </details>
                )}
              </div>
            ))}
            {skill && <SkillReceipt card={card} />}{' '}
            {creation?.error && <p className="feedback error">{creation.error}</p>}
            {fileApproval?.content && <pre className="approval-preview">{fileApproval.content}</pre>}
            {closed ? (
              <span className="field-note">
                {skill?.status ||
                  creation?.status ||
                  (card.expired
                    ? '此请求已过期'
                    : (card.answered === 'allow'
                        ? '已允许这次操作'
                        : card.answered === 'deny'
                          ? '已拒绝'
                          : card.answered === 'answer'
                            ? '已回答'
                            : card.answered) || '已处理')}
              </span>
            ) : card.requestType === 'question' ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void act('answer', answer);
                }}
              >
                <input
                  aria-label="回答助理的问题"
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  required
                />
                <button disabled={answering} className="primary-button">
                  提交回答
                </button>
              </form>
            ) : (
              <div className="button-row">
                <button
                  className="primary-button"
                  disabled={answering || (!!skill && !skill.hash)}
                  onClick={() => act('allow')}
                >
                  {skill
                    ? skill.skill.action === 'create'
                      ? '启用技能'
                      : '确认更新'
                    : creation
                      ? '确认创建'
                      : '允许这一次'}
                </button>
                <button className="secondary-button" disabled={answering} onClick={() => act('deny')}>
                  {skill ? '暂不启用' : creation ? '暂不创建' : '拒绝'}
                </button>
              </div>
            )}
            {!closed && surfaceTool && (
              <button className="permission-shortcut" onClick={managePermissions}>
                为{name}设置后续操作权限
                <ChevronRight size={12} />
              </button>
            )}
            {error && <p className="feedback error">{error}</p>}
          </div>
        ) : (
          <div className="message-content">
            {quoted && (
              <blockquote className="message-quote">
                <strong>{quoted.name}</strong>
                {quoted.text}
              </blockquote>
            )}
            {SPECIAL_KINDS.has(message.kind) ? (
              <SpecialCard message={message} botId={botId || ''} threadId={threadId} />
            ) : (
              <>
                <MessageImages text={message.text || ''} />
                <MessageMarkdown text={visibleMessageText(message)} threadId={threadId} messageId={message.id} />
              </>
            )}
          </div>
        )}
        {!!message.reactions?.length && (
          <div className="message-reactions" aria-label="回应">
            {message.reactions.map((item) => (
              <button
                key={item.by + item.emoji}
                className="reaction-chip"
                disabled={!react || item.by !== 'user'}
                aria-label={item.by === 'user' ? `取消回应 ${item.emoji}` : `${item.name || '助理'}的回应 ${item.emoji}`}
                onClick={() => void react?.(item.emoji)}
              >
                {item.emoji}
              </button>
            ))}
          </div>
        )}
        {bot && message.kind === 'text' && message.text && (
          <div className="message-actions">
            <button
              className="read-message"
              title="播放这条回复"
              aria-label="播放这条回复"
              onClick={() => speak(message.text!)}
            >
              <Volume2 size={13} />
              听一听
            </button>
            {reply && (
              <button className="read-message" aria-label="回复这条消息" onClick={reply}>
                <CornerUpLeft size={13} />
                回复
              </button>
            )}
            {react && (
              <span className="reaction-picker">
                <button
                  className="read-message"
                  aria-label="回应这条消息"
                  aria-expanded={picking}
                  onClick={() => setPicking((open) => !open)}
                >
                  <SmilePlus size={13} />
                  回应
                </button>
                {picking && (
                  <span className="reaction-options" role="group" aria-label="选择回应">
                    {REACTIONS.map(([emoji, label]) => (
                      <button
                        key={emoji}
                        aria-label={label}
                        title={label}
                        onClick={() => {
                          setPicking(false);
                          void react(emoji);
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </span>
                )}
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
