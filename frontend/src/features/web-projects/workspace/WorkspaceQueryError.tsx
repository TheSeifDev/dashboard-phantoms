import { ErrorState } from "../../../components/ui/ErrorState";
import { useLocale } from "../../../i18n/useLocale";

type RetryableQuery = { refetch: () => Promise<unknown> };

export function WorkspaceQueryError({
  error,
  queries,
}: {
  error: unknown;
  queries: RetryableQuery[];
}) {
  const { t } = useLocale();
  const message =
    error instanceof Error
      ? error.message
      : t(
          "تعذر تحميل بيانات مساحة المشروع.",
          "Could not load project workspace data.",
        );
  return (
    <WorkspaceQueryErrorFrame
      message={message}
      onRetry={() => {
        void Promise.all(queries.map((query) => query.refetch()));
      }}
    />
  );
}

export function WorkspaceQueryErrorFrame({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return <ErrorState message={message} onRetry={onRetry} />;
}
