import { useRef, useState } from 'react';
import { Download, FileSpreadsheet, ShieldAlert, Upload } from 'lucide-react';
import type { Member, MemberCustomField, MemberInsert } from '../../types/db';
import { useBulkUpsertMembers } from './api';
import { parseMemberWorkbook, downloadMembersWorkbook } from './memberExcel';
import { Modal } from '../../components/ui/Modal';
import { toast } from '../../store/toast';
import { Button } from '../../components/ui/Button';
import { useLocale } from '../../i18n/useLocale';

/**
 * Feature gate: XLSX importing is temporarily disabled pending safe parser upgrades (CVE-2026-78206).
 * Export functionality (downloadMembersWorkbook) remains fully enabled and secured.
 */
const XLSX_IMPORT_DISABLED = true;
const XLSX_DISABLED_MESSAGE_AR =
  'تم إيقاف استيراد ملفات Excel (XLSX) مؤقتًا لدواعي الأمان والتوافقية الهندسية (CVE-2026-78206). ميزة تصدير البيانات مستمرة بالكامل.';
const XLSX_DISABLED_MESSAGE_EN =
  'Excel (XLSX) file imports are temporarily disabled for security and engineering compatibility (CVE-2026-78206). Data export remains fully available.';

export function MemberExcelActions({
  members,
  customFields = [],
}: {
  members: Member[];
  customFields?: MemberCustomField[];
}) {
  const { t, number } = useLocale();
  const xlsxDisabledMessage = t(XLSX_DISABLED_MESSAGE_AR, XLSX_DISABLED_MESSAGE_EN);
  const inputRef = useRef<HTMLInputElement>(null);
  const importMembers = useBulkUpsertMembers();
  const [isOpen, setIsOpen] = useState(false);
  const [rows, setRows] = useState<MemberInsert[]>([]);
  const [message, setMessage] = useState(XLSX_IMPORT_DISABLED ? xlsxDisabledMessage : '');
  const displayMessage = message === XLSX_DISABLED_MESSAGE_AR || message === XLSX_DISABLED_MESSAGE_EN
    ? xlsxDisabledMessage
    : message;

  const chooseFile = async (file: File | undefined) => {
    if (XLSX_IMPORT_DISABLED) {
      setMessage(xlsxDisabledMessage);
      return;
    }
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setMessage(t('حجم الملف كبير جدًا. الحد الأقصى المسموح لملفات Excel هو 5 ميجابايت.', 'The file is too large. The maximum allowed Excel file size is 5 MB.'));
      return;
    }
    try {
      const parsed = await parseMemberWorkbook(await file.arrayBuffer(), members, customFields);
      setRows(parsed.members);
      setMessage(t(`اتجهز ${number(parsed.members.length)} عضو. اتساب ${number(parsed.skipped)} صف عشان البيانات ناقصة أو مكررة.`, `${number(parsed.members.length)} members are ready. ${number(parsed.skipped)} rows were skipped because data was missing or duplicated.`));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('معرفناش نقرا ملف Excel.', 'Could not read the Excel file.'));
    }
  };

  const confirmImport = async () => {
    if (XLSX_IMPORT_DISABLED) {
      toast.warning(xlsxDisabledMessage);
      return;
    }
    try {
      await importMembers.mutateAsync(rows);
      setRows([]);
      setIsOpen(false);
      setMessage('');
      toast.success(t('بيانات الأعضاء اتستوردت بنجاح.', 'Member data was imported successfully.'));
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : t('حصلت مشكلة في الاستيراد.', 'There was a problem importing the data.');
      setMessage(msg);
      toast.error(msg);
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setIsOpen(true);
          setRows([]);
          setMessage('');
        }}
        icon={<Upload size={17} />}
        fullOnMobile
        className="whitespace-nowrap"
      >
        {t('استيراد بيانات', 'Import data')}
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          members.length ? downloadMembersWorkbook(members, customFields) : toast.warning(t('مفيش بيانات نصدّرها.', 'There is no data to export.'))
        }
        icon={<Download size={17} />}
        fullOnMobile
        className="whitespace-nowrap"
      >
        {t('تصدير Excel', 'Export Excel')}
      </Button>
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title={t('استيراد بيانات الأعضاء من Excel', 'Import member data from Excel')} maxWidth="xl">
        <div className="grid gap-4">
          {XLSX_IMPORT_DISABLED && (
            <div
              className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs font-semibold leading-relaxed text-[var(--text)]"
              role="alert"
            >
              <ShieldAlert size={20} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <div>
                <p className="font-bold text-amber-800 dark:text-amber-300">{t('استيراد ملفات Excel معطّل مؤقتًا', 'Excel file imports are temporarily disabled')}</p>
                <p className="mt-1 text-[var(--text-2)]">{xlsxDisabledMessage}</p>
              </div>
            </div>
          )}
          <label
            className={`grid gap-3 rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--bg)] p-5 text-center ${
              XLSX_IMPORT_DISABLED ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            }`}
          >
            <FileSpreadsheet size={34} className="mx-auto text-[var(--success-text)] dark:text-[var(--success-text)]" />
            <span className="text-sm font-bold">
              {XLSX_IMPORT_DISABLED ? t('الاستيراد معطّل مؤقتًا لدواعي الأمان', 'Import is temporarily disabled for security reasons') : t('اختار ملف Excel أو CSV', 'Choose an Excel or CSV file')}
            </span>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              disabled={XLSX_IMPORT_DISABLED}
              onChange={(event) => {
                void chooseFile(event.target.files?.[0]);
              }}
              className="min-h-11 text-sm disabled:cursor-not-allowed"
            />
          </label>
          {displayMessage && (
            <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm" role="status">
              {displayMessage}
            </p>
          )}
          {rows.length > 0 && (
            <>
              <div className="max-h-64 overflow-auto rounded-xl border border-[var(--border)]">
                <table className="data-table w-full text-start text-sm">
                  <thead>
                    <tr>
                      <th>{t('الاسم', 'Name')}</th>
                      <th>{t('البريد الإلكتروني', 'Email')}</th>
                      <th>{t('حالة العمل', 'Work status')}</th>
                      <th>{t('الجهاز', 'Device')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 10).map((row) => (
                      <tr key={row.email}>
                        <td data-label={t('الاسم', 'Name')}>{row.full_name}</td>
                        <td data-label={t('البريد الإلكتروني', 'Email')} dir="ltr">
                          {row.email}
                        </td>
                        <td data-label={t('حالة العمل', 'Work status')}>{row.work_status || '—'}</td>
                        <td data-label={t('الجهاز', 'Device')}>{row.device || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-sm text-[var(--text-muted)]">
                {t('هيتحدّث الأعضاء المطابقين للإيميل، وهينضاف الأعضاء الجدد.', 'Members with matching email addresses will be updated, and new members will be added.')}
              </p>
            </>
          )}
          <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setIsOpen(false)} fullOnMobile>
              {t('إلغاء', 'Cancel')}
            </Button>
            <Button
              onClick={() => void confirmImport()}
              disabled={!rows.length}
              isLoading={importMembers.isPending}
              loadingText={t('بنستورد...', 'Importing...')}
              fullOnMobile
            >
              {t('تأكيد الاستيراد', 'Confirm import')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
