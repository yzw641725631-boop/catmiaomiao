import type { WireMessage } from './types.ts';
import { skillProposal } from './skillUi.ts';
export function SkillReceipt({card}:{card:NonNullable<WireMessage['card']>}) {
  const proposal=skillProposal(card);if(!proposal)return null;const {skill,applied}=proposal;
  const body=<><pre className="skill-source">{skill.preview||'这条提议缺少完整内容，请让助理重新生成。'}</pre>{skill.references?.map(file=><section key={file.path}><strong>{file.path}</strong><pre className="skill-source">{file.content}</pre></section>)}</>;
  return <div className="skill-proposal"><h4>{skill.name}</h4><p className="field-note">{skill.source?`来自 ${skill.source}`:'来自当前对话'}</p>{skill.warnings.map((warning,index)=><p className="field-note" key={index}>{warning}</p>)}{applied?<details><summary>查看保存的做法</summary>{body}</details>:body}</div>;
}
