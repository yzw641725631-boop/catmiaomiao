import type { ReactNode } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import type { WireMessage } from './types.ts';
interface Row {
  message: WireMessage;
  threadId: string;
  botId: string;
  name: string;
  workThreadId?: string;
}
export function ConversationFeed({
  rows,
  render,
  showDates = true,
}: {
  rows: Row[];
  render(row: Row): ReactNode;
  showDates?: boolean;
}) {
  const groups: Array<{ key: string; rows: Row[]; trace: boolean }> = [];
  for (const row of rows) {
    const message = row.message,
      card = message.card;
    const trace =
      message.kind === 'digest' ||
      (message.kind === 'activity' &&
        message.tool?.ok !== false &&
        !message.tool?.name?.includes(' needs your input: ')) ||
      (message.kind === 'options' && !!(card?.answered || card?.dismissed || card?.expired));
    const previous = groups.at(-1);
    if (trace && previous?.trace) previous.rows.push(row);
    else groups.push({ key: message.id, rows: [row], trace });
  }
  const date = (at: number) =>
    new Date(at).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric' });
  return (
    <>
      {groups.map((group, index) => (
        <div key={group.key} className="conversation-group">
          {showDates &&
            (!index || date(groups[index - 1].rows.at(-1)!.message.at) !== date(group.rows[0].message.at)) && (
              <p className="conversation-date">{date(group.rows[0].message.at)}</p>
            )}
          {group.trace ? (
            <details className="conversation-trace">
              <summary>
                <Check size={13} />
                <span>{group.rows.length === 1 ? '查看操作记录' : `查看 ${group.rows.length} 条操作记录`}</span>
                <ChevronDown size={12} />
              </summary>
              <div>{group.rows.map(render)}</div>
            </details>
          ) : (
            group.rows.map(render)
          )}
        </div>
      ))}
    </>
  );
}
