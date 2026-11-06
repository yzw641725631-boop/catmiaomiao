import type { WireMessage } from './types.ts';

export function creationProposal(card: WireMessage['card']) {
  const request = card?.teamSetupRequest;
  if (card?.tool !== 'set_up_team' || !request || request.deletion || !request.operations.length || request.operations.some(operation => operation.action !== 'create')) return null;
  return {
    people: request.operations.map(operation => ({ id: operation.botId, name: operation.fields.name || '新小助理', role: operation.fields.title || '', instructions: operation.fields.soul || '' })),
    status: request.result?.state === 'applied' ? '已创建' : request.result?.state === 'failed' ? '创建未完成' : request.result?.state === 'denied' || request.result?.state === 'cancelled' || card.dismissed ? '已取消' : card.expired ? '此请求已过期' : card.answered ? '正在应用创建结果' : '等待你确认',
    error: request.result?.error,
  };
}
