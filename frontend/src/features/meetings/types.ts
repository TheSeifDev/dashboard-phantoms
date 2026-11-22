/** عقود RPC الاجتماعات والحضور — مشتركة بين الإدارة والبوابة. */
export type MeetingMode = 'online' | 'offline';
export type MeetingStatus = 'scheduled' | 'cancelled';
export type MeetingAudienceType = 'all' | 'teams' | 'members' | 'leaders';

export interface MeetingAudience {
  type: MeetingAudienceType;
  teams?: string[];
  member_ids?: string[];
}

export interface Meeting {
  id: number;
  title: string;
  description: string | null;
  mode: MeetingMode;
  starts_at: string;
  duration_minutes: number;
  location: string | null;
  online_url: string | null;
  audience: MeetingAudience;
  status: MeetingStatus;
  created_at: string;
  expected: number;
  present: number;
}

export interface MeetingRosterEntry {
  member_id: number;
  full_name: string;
  academic_number: string | null;
  present: boolean;
  method: 'scan' | 'manual' | null;
  marked_at: string | null;
  expected: boolean;
}

export interface MeetingRoster {
  meeting: Omit<Meeting, 'expected' | 'present' | 'created_at'>;
  members: MeetingRosterEntry[];
  expected: number;
  present: number;
}

export type MarkAttendanceStatus = 'marked' | 'duplicate' | 'not_found' | 'cancelled' | 'empty';

export interface MarkAttendanceResult {
  status: MarkAttendanceStatus;
  expected?: boolean;
  code?: string;
  member?: { member_id: number; full_name: string; academic_number: string | null };
}

export interface MeetingDraft {
  id?: number;
  title: string;
  description: string;
  mode: MeetingMode;
  starts_at: string;
  duration_minutes: number;
  location: string;
  online_url: string;
  audience: MeetingAudience;
  status: MeetingStatus;
}

export interface MemberMeetingCard {
  id: number;
  title: string;
  description?: string | null;
  mode: MeetingMode;
  starts_at: string;
  duration_minutes: number;
  location: string | null;
  online_url: string | null;
  status: MeetingStatus;
  present?: boolean;
}

export interface MemberMeetingHistoryEntry {
  id: number;
  title: string;
  mode: MeetingMode;
  starts_at: string;
  present: boolean;
  marked_at: string | null;
}

export interface MemberMeetingsPayload {
  member: { member_id: number; full_name: string; academic_number: string | null };
  upcoming: MemberMeetingCard[];
  history: MemberMeetingHistoryEntry[];
  stats: { total: number; attended: number; online: number; offline: number };
}

/** يعرض الجمهور بنص مفهوم في القوائم. */
export function describeAudience(audience: MeetingAudience, teamNames: Map<string, string>, t: (ar: string, en: string) => string): string {
  if (audience.type === 'all') return t('كل الفريق', 'Whole team');
  if (audience.type === 'leaders') return t('Heads وMonitors', 'Heads & monitors');
  if (audience.type === 'teams') {
    const names = (audience.teams ?? []).map((slug) => teamNames.get(slug) ?? slug);
    return names.length ? names.join(' · ') : t('تيمات محددة', 'Specific teams');
  }
  const count = audience.member_ids?.length ?? 0;
  return t(`${count} عضو محدد`, `${count} selected members`);
}