import type { TeamAccessEntry } from '../../types/db';

type WorkspaceAccess = {
  is_admin?: boolean;
  is_team_admin?: boolean;
  teams?: TeamAccessEntry[];
};

/** Global access always keeps its original workspace. Team access is separate. */
export function managerDestination(access: WorkspaceAccess | null | undefined): '/admin' | '/team' | null {
  // Heads and Monitors are management accounts too. They may still have
  // team-scoped permissions, but they must never land in the member portal.
  if (access?.is_admin === true || access?.is_team_admin === true) return '/admin';
  return authorizedTeamEntries(access).length ? '/team' : null;
}

/** Global administrators may explicitly open a team using their global feature
 * permissions; this never changes their landing page or creates a team seat. */
export function workspaceTeamEntries(access: WorkspaceAccess | null | undefined): TeamAccessEntry[] {
  if (access?.is_admin !== true) return authorizedTeamEntries(access);
  if (!Array.isArray(access.teams)) return [];
  return access.teams.filter((team) => (
    typeof team.team_id === 'string' && team.team_id.length > 0 && team.role === null
    && typeof team.permissions === 'object' && team.permissions !== null
  ));
}

export function authorizedTeamEntries(access: WorkspaceAccess | null | undefined): TeamAccessEntry[] {
  if (access?.is_admin === true || access?.is_team_admin !== true || !Array.isArray(access.teams)) return [];
  return access.teams.filter((team) => (
    typeof team.team_id === 'string' && team.team_id.length > 0
    && (team.role === 'head' || team.role === 'monitor')
    && typeof team.permissions === 'object' && team.permissions !== null
  ));
}
