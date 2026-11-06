export type { WireBot, WireTask, WireMessage, ServerFrame } from '../../upstream/OpenMausBot/shared/wire.ts';

export interface ConversationSettings {
  revision: number;
  preferences: { readReplies?: boolean; reducedMotion?: boolean; pureView?: boolean };
  voice: { provider: 'reachai' | 'compatible'; speechRate: number; voiceId: string; configured: boolean };
}
export interface ConversationSettingsPatch { readReplies?: boolean; reducedMotion?: boolean; pureView?: boolean; speechRate?: number; voiceId?: string }

export interface CompanionInfo {
  interaction?: ConversationSettings;
  vision?:{configured:boolean;model:string;location:string};
  health?:{model:{state:'healthy'|'degraded'|'unknown';lastAt:string|null;code:string|null;status:number|null};vision:{state:'healthy'|'degraded'|'unknown';lastAt:string|null;code:string|null;status:number|null}};
  verificationLabel?:string;
  mode: 'fixture' | 'live' | 'external';
  provider: 'reachai' | 'compatible';
  sessionId: string;
  chiefId: string;
  companionThreadId: string;
  helperIds: string[];
  workThreadIds: string[];
  model: { url: string; model: string; configured: boolean };
  asr: { url: string; model: string; configured: boolean; mode?: 'file' | 'realtime' };
  voice: { provider: string; voice: string; ready: boolean; baseUrl?: string };
  reachai: { url: string; keySaved: boolean; llmId: string; asrId: string; ttsId: string; voice: string; speed: number; asrMode: 'file' | 'realtime'; checkedAt: number | null };
}

export interface ReachaiInstance { id: string; name: string; modelType: 'LLM' | 'ASR' | 'TTS'; modelName: string; provider: string; status: string }
export type ServiceTab = 'folders' | 'web' | 'memory' | 'reminders';
export interface FolderGrant { id: string; name: string; path: string; writable: boolean }
export interface Preference { id: string; text: string; status: 'pending' | 'confirmed' | 'rejected' | 'forgotten' }
export interface Reminder { id: string; title: string; nextAt: string; repeat: 'once' | 'daily'; action: 'notify' | 'work'; status: 'active' | 'paused' | 'cancelled' | 'triggered'; task?: string; error?: string; lastThreadId?: string }
export interface ReminderEvent { id: string; title: string; at: number; action: 'notify' | 'work'; seen: boolean; threadId?: string }
export interface AssistantServicesData { folders: FolderGrant[]; preferences: Preference[]; reminders: Reminder[]; events: ReminderEvent[]; workThreadIds: string[]; serviceRunning: boolean; timeZone: string }

export interface MemoryDocument { text: string; hash: string; path: string }
export interface EvidenceChange { path: string; before: string; after: string; diff: string; status: 'added' | 'changed' | 'deleted' }
export interface WorkEvidence {
  threadId: string; files: EvidenceChange[]; coverage: string;
  tests: Array<{ command: string; exitCode: number; stdout: string; stderr: string; current?: boolean; path?: string; sha256?: string }>;
}
