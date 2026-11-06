import { ChevronRight, FileText, Search, Square, UserRound } from 'lucide-react';
import type { WireBot, WireTask } from './types.ts';

export type HelperState = { bot?: WireBot; task?: WireTask; root?: string; status: string };

type TeamDockProps = {
  helperIds: string[];
  helperState: (botId: string) => HelperState;
  busyCount: number;
  openTeam: () => void;
  openWork: (threadId?: string) => void;
  stopTask: (botId: string, threadId: string) => unknown;
};

/** Bottom-left: the last two helpers as round icons with name and status, and one link to the team or the running work. */
export function TeamDock({ helperIds, helperState, busyCount, openTeam, openWork, stopTask }: TeamDockProps) {
  return (
    <aside className="team-dock" aria-label="小助理状态">
      {helperIds.slice(-2).map((id) => {
        const index = helperIds.indexOf(id);
        const { bot, task, root, status } = helperState(id);
        const working = !!task?.busy;
        return (
          <div className="helper-row" key={id}>
            <button className="helper-open" onClick={() => (root ? openWork(root) : openTeam())}>
              <span className={`helper-avatar helper-${index}`} aria-hidden="true">
                {index === 0 ? (
                  <Search size={18} strokeWidth={1.6} />
                ) : index === 1 ? (
                  <FileText size={18} strokeWidth={1.6} />
                ) : (
                  <UserRound size={18} strokeWidth={1.6} />
                )}
                <i className={working ? 'working' : ''} />
              </span>
              <span className="helper-text">
                <strong>{bot?.name || '小助理'}</strong>
                <span className="helper-status">{status}</span>
              </span>
            </button>
            {working && (
              <button
                className="icon-button helper-stop"
                aria-label={`停止${bot?.name}当前任务`}
                onClick={() => stopTask(id, task!.threadId)}
              >
                <Square size={12} />
              </button>
            )}
          </div>
        );
      })}
      {busyCount > 0 ? (
        <button className="team-work-link" onClick={() => openWork()}>
          <span>{busyCount} 项工作进行中</span>
          <ChevronRight size={13} />
        </button>
      ) : (
        <button className="team-work-link" onClick={openTeam}>
          <span>查看我的小助理</span>
          <ChevronRight size={13} />
        </button>
      )}
    </aside>
  );
}
