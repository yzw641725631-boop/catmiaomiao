import type { WireMessage } from './types.ts';

// Read only a server-proven reply to this voice send, never an unrelated or historical answer.
export class VoiceReplies {
  private pending = new Set<string>();
  arm(sendId: string) { this.pending.clear(); this.pending.add(sendId); }
  clear() { this.pending.clear(); }
  take(histories: Record<string, WireMessage[]>): WireMessage | null { return this.takeResult(histories)?.reply || null; }
  takeResult(histories: Record<string, WireMessage[]>): { reply?: WireMessage; error?: string } | null {
    for (const messages of Object.values(histories)) {
      for (const user of messages.filter(message => message.role === 'user' && !!message.sendId && this.pending.has(message.sendId))) {
        if (user.requestCancelled) { this.pending.delete(user.sendId!); return { error: '这次语音请求已停止。' }; }
        const owned = messages.filter(message => message.role === 'bot' && message.requestMessageId === user.id);
        const terminal = owned.findLast(message => message.tool?.terminal && message.tool.ok === false || message.kind === 'text' && message.turnTerminal && message.turnSucceeded === true && message.text?.trim());
        const terminalFailure = terminal?.tool?.terminal && terminal.tool.ok === false;
        // The native request stays pending to allow later teammate recovery, even
        // after a terminal model failure. Release voice waiting, without replaying
        // that task or reading an earlier "I've delegated it" as its final answer.
        // A settled provider reply can coexist with an older outstanding handoff.
        // Speak only this request's proven terminal text, then keep listening.
        if (user.requestPending === true && !terminalFailure && !terminal) continue;
        if (terminal && !terminalFailure) { this.pending.delete(user.sendId!); return { reply: terminal }; }
        const failures = owned.filter(message => message.turnSucceeded === false || message.tool?.terminal && message.tool.ok === false);
        if (failures.length) {
          this.pending.delete(user.sendId!);
          const reason = failures.map(message => [message.text, message.tool?.name].filter(Boolean).join('\n')).join('\n');
          if (/网页验证|upstream_web_verification|MODEL_UPSTREAM_WEB_VERIFICATION/i.test(reason)) return { error: '这句话已经识别并发送，但模型上游要求网页验证。请在“模型连接”更换模型，或处理上游账号验证。我会继续听。' };
          return { error: /502|503|504|Saturn|upstream|timeout/i.test(reason) ? '这句话已经识别并发送，模型上游暂时未能回复。我会继续听，你可以接着说。' : '助理这次没有完成回复，我会继续听。失败记录已保留。' };
        }
      }
    }
    return null;
  }
}
