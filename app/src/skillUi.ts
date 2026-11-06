import type { WireMessage } from './types.ts';
import { reviewedSkillSha256 } from '../../upstream/OpenMausBot/shared/skill-request.ts';

export function skillProposal(card: WireMessage['card']) {
  const skill=card?.skillRequest;if(!skill)return null;
  const applied=card?.answered==='allow';
  return {skill,applied,hash:reviewedSkillSha256(skill),status:card?.expired?'提议已过期':applied?(skill.action==='create'?'已启用':'已更新'):card?.dismissed||card?.answered?'未启用':'等待你确认'};
}
