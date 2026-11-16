/**
 * Explicit authenticated/admin projection for member rows.
 * Secrets are intentionally absent: session_token and push_subscription must
 * never be selected by the frontend.
 */
export const ADMIN_MEMBER_COLUMNS =
  'id,created_at,email,full_name,completion_rank,team_notes,residence,work_conditions,bio,phone,device,gender,meeting_attendance,work_status,can_go_alexandria,bonus_infinite,custom_fields' as const;

/** Preserve the existing pre-custom-fields fallback without a wildcard response. */
export const PRE_CUSTOM_FIELDS_ADMIN_MEMBER_COLUMNS =
  'id,created_at,email,full_name,completion_rank,team_notes,residence,work_conditions,bio,phone,device,gender,meeting_attendance,work_status,can_go_alexandria,bonus_infinite' as const;
