export type IcpcRole = 'admin' | 'coach' | 'captain' | 'member' | 'guest';
export type IcpcMode = 'admin' | 'member';
export type ProblemDifficulty = 'easy' | 'medium' | 'hard' | 'expert';
export type ProblemStatus = 'todo' | 'solving' | 'solved' | 'upsolving' | 'revisit';
export type ContestKind = 'individual' | 'virtual' | 'internal';
export type ContestStatus = 'draft' | 'scheduled' | 'running' | 'finished';

export interface IcpcContext {
  role: IcpcRole;
  can_manage: boolean;
  user_id: string | null;
  member_id: number | null;
  member_name: string | null;
}

export interface IcpcKpis {
  active_members: number;
  problems_solved: number;
  contests: number;
  training_hours: number;
  streak: number;
  weekly_solved: number;
  weekly_goal: number;
}

export interface HeatDay {
  day: string;
  problems: number;
  contests: number;
}

export interface RatingSeries {
  platform: string;
  points: Array<{ date: string; rating: number }>;
  current: number;
  peak: number;
  first: number;
}

export interface MasteryRow {
  topic: string;
  total: number;
  solved: number;
  percent: number;
}

export interface RecentContest {
  id: number;
  name: string;
  platform: string;
  kind: ContestKind;
  starts_at: string;
  status: ContestStatus;
  solved: number;
  rank: number | null;
  delta: number | null;
}

export interface RecentAc {
  problem: string;
  platform: string;
  difficulty: ProblemDifficulty;
  topics: string[];
  url: string | null;
  solved_at: string | null;
  member: string;
}

export interface WorkoutItem {
  assignment_id: number;
  problem_id: number;
  title: string;
  url: string | null;
  difficulty: ProblemDifficulty;
  status: ProblemStatus;
  topics: string[];
}

export interface OverviewPayload {
  role: IcpcRole;
  can_manage: boolean;
  scope: string | null;
  kpis: IcpcKpis;
  heatmap: HeatDay[];
  rating: RatingSeries[];
  mastery: MasteryRow[];
  topics_top: Array<{ topic: string; count: number }>;
  recent_contests: RecentContest[];
  recent_ac: RecentAc[];
  workout: { day: string; items: WorkoutItem[] };
}

export interface TrainingTopic {
  id: number;
  slug: string;
  title_ar: string;
  title_en: string;
  difficulty: ProblemDifficulty;
  description: string | null;
  prerequisites: string[];
  resources: Array<{ label?: string; url?: string }>;
  status: 'todo' | 'learning' | 'done';
  problems: number;
}

export interface TrainingStage {
  stage: number;
  topics: TrainingTopic[];
  done: number;
  total: number;
}

export interface TrainingPayload {
  stages: TrainingStage[];
}

export interface Assignment {
  id: number;
  user_id: string;
  status: ProblemStatus;
  attempts: number;
  notes: string | null;
  due_date: string | null;
  solved_at: string | null;
  member: string;
}

export interface IcpcProblem {
  id: number;
  title: string;
  url: string | null;
  platform: string;
  external_id: string | null;
  difficulty: ProblemDifficulty;
  topics: string[];
  description: string | null;
  editorial_url: string | null;
  created_at: string;
  assignments: Assignment[];
}

export interface DirectoryMember {
  user_id: string;
  member_id: number;
  full_name: string;
  team: string | null;
  role: IcpcRole;
}

export interface ProblemsPayload {
  problems: IcpcProblem[];
  topics: string[];
  directory: DirectoryMember[];
}

export interface ProblemFilters {
  query?: string;
  platform?: string;
  difficulty?: string;
  topic?: string;
  status?: string;
}

export interface IcpcContest {
  id: number;
  name: string;
  description: string | null;
  platform: string;
  kind: ContestKind;
  starts_at: string;
  duration_minutes: number;
  visibility: 'team' | 'admins';
  status: ContestStatus;
  scoring: { penalty_minutes?: number; points_per_problem?: number };
  problems: number;
  participants: number;
  joined: boolean;
}

export interface ContestsPayload {
  contests: IcpcContest[];
  directory: DirectoryMember[];
}

export interface ContestScoreRow {
  user_id: string;
  member: string;
  team_name: string | null;
  solved: number;
  penalty: number;
  rank: number | null;
  rating_delta: number | null;
  score: number;
}

export interface ContestDetail {
  contest: IcpcContest;
  problems: Array<{
    id: number;
    label: string;
    points: number;
    problem_id: number;
    title: string;
    url: string | null;
    difficulty: ProblemDifficulty;
    topics: string[];
  }>;
  scoreboard: ContestScoreRow[];
  can_manage: boolean;
}

export interface TeamMemberStat {
  user_id: string;
  member: string;
  team: string | null;
  role: IcpcRole;
  solved: number;
  contests: number;
  rating: number | null;
  topics: Record<string, number>;
}

export interface TeamPayload {
  members: TeamMemberStat[];
  topics: string[];
  can_manage: boolean;
}

export interface IcpcSession {
  id: number;
  title: string;
  kind: 'training' | 'mock' | 'upsolving' | 'sharing' | 'deadline';
  starts_at: string;
  duration_minutes: number;
  location: string | null;
  url: string | null;
  topic: string | null;
}

export interface CalendarPayload {
  sessions: IcpcSession[];
  contests: Array<{ id: number; name: string; starts_at: string; duration_minutes: number; kind: ContestKind; platform: string }>;
  deadlines: Array<{ assignment_id: number; title: string; due_date: string; status: ProblemStatus }>;
  can_manage: boolean;
}

export interface IcpcNote {
  id: number;
  title: string;
  category: string;
  tags: string[];
  content_md: string;
  links: Array<{ label?: string; url?: string }>;
  status: 'published' | 'pending';
  updated_at: string;
  created_at: string;
  author: string;
  author_id: string | null;
}

export interface NotesPayload {
  notes: IcpcNote[];
  can_manage: boolean;
}

export interface AnalyticsPayload {
  by_platform: Array<{ platform: string; solved: number }>;
  by_difficulty: Array<{ difficulty: string; solved: number }>;
  weekly: Array<{ week: string; solved: number }>;
  status_breakdown: Array<{ status: string; total: number }>;
}

export const PLATFORM_LABELS: Record<string, string> = {
  codeforces: 'Codeforces',
  codechef: 'CodeChef',
  atcoder: 'AtCoder',
  cses: 'CSES',
  internal: 'PHANTOMS',
  other: 'Other',
};

export const DIFFICULTY_LABELS: Record<ProblemDifficulty, { ar: string; en: string }> = {
  easy: { ar: 'سهلة', en: 'Easy' },
  medium: { ar: 'متوسطة', en: 'Medium' },
  hard: { ar: 'صعبة', en: 'Hard' },
  expert: { ar: 'خبيرة', en: 'Expert' },
};

export const STATUS_LABELS: Record<ProblemStatus, { ar: string; en: string }> = {
  todo: { ar: 'لسه', en: 'Todo' },
  solving: { ar: 'بتحل', en: 'Solving' },
  solved: { ar: 'محلولة', en: 'Solved' },
  upsolving: { ar: 'Upsolving', en: 'Upsolving' },
  revisit: { ar: 'مراجعة', en: 'Revisit' },
};

export const STAGE_TITLES: Record<number, { ar: string; en: string }> = {
  1: { ar: 'الأساسيات', en: 'Foundations' },
  2: { ar: 'تقنيات حل المسائل', en: 'Problem Solving Techniques' },
  3: { ar: 'هياكل البيانات', en: 'Data Structures' },
  4: { ar: 'الخوارزميات الأساسية', en: 'Core Algorithms' },
  5: { ar: 'الخوارزميات المتقدمة', en: 'Advanced Algorithms' },
  6: { ar: 'مواضيع متخصصة', en: 'Specialized Topics' },
  7: { ar: 'الاستعداد للمسابقات', en: 'Contest Preparation' },
};

export const NOTE_CATEGORIES: Record<string, { ar: string; en: string }> = {
  algorithms: { ar: 'خوارزميات', en: 'Algorithms' },
  'data-structures': { ar: 'هياكل بيانات', en: 'Data Structures' },
  templates: { ar: 'قوالب ++C', en: 'C++ Templates' },
  complexity: { ar: 'التعقيد', en: 'Complexity' },
  techniques: { ar: 'تقنيات', en: 'Techniques' },
  editorials: { ar: 'إيديتوريال', en: 'Editorials' },
  lessons: { ar: 'دروس المسابقات', en: 'Contest Lessons' },
  'team-notes': { ar: 'ملاحظات الفريق', en: 'Team Notes' },
};
