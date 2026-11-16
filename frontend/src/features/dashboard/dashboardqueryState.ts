import type { Member, Note, Task } from '../../types/db';

export type DashboardQueryName = 'members' | 'tasks' | 'notes';

export type DashboardQuerySnapshot<T> = {
  data?: T;
  isError: boolean;
  isLoading: boolean;
  isSuccess: boolean;
};

export type DashboardQueryInputs = {
  members: DashboardQuerySnapshot<Member[]>;
  tasks: DashboardQuerySnapshot<Task[]>;
  notes: DashboardQuerySnapshot<Note[]>;
};

type DashboardQueryEntry = {
  name: DashboardQueryName;
  snapshot: DashboardQuerySnapshot<unknown>;
};

export type DashboardQueryState =
  | { status: 'loading' }
  | { status: 'error'; reason: 'query-error' | 'missing-data'; failedQueries: DashboardQueryName[] }
  | { status: 'ready'; data: { members: Member[]; tasks: Task[]; notes: Note[] } };

export function resolveDashboardQueryState(input: DashboardQueryInputs): DashboardQueryState {
  const entries: DashboardQueryEntry[] = [
    { name: 'members', snapshot: input.members },
    { name: 'tasks', snapshot: input.tasks },
    { name: 'notes', snapshot: input.notes },
  ];

  const failedQueries = entries
    .filter(({ snapshot }) => snapshot.isError)
    .map(({ name }) => name);
  if (failedQueries.length > 0) {
    return { status: 'error', reason: 'query-error', failedQueries };
  }

  if (entries.some(({ snapshot }) => snapshot.isLoading || !snapshot.isSuccess)) {
    return { status: 'loading' };
  }

  const { members, tasks, notes } = input;
  const missingQueries = entries
    .filter(({ snapshot }) => !Array.isArray(snapshot.data))
    .map(({ name }) => name);
  if (missingQueries.length > 0 || !Array.isArray(members.data) || !Array.isArray(tasks.data) || !Array.isArray(notes.data)) {
    return { status: 'error', reason: 'missing-data', failedQueries: missingQueries };
  }

  return {
    status: 'ready',
    data: {
      members: members.data,
      tasks: tasks.data,
      notes: notes.data,
    },
  };
}
