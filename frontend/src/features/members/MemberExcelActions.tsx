import { useRef, useState } from 'react';
import { Download, FileSpreadsheet, ShieldAlert, Upload } from 'lucide-react';
import type { Member, MemberCustomField, MemberInsert } from '../../types/db';
import { useBulkUpsertMembers } from './api';
import { parseMemberWorkbook, downloadMembersWorkbook } from './memberExcel';
import { Modal } from '../../components/ui/Modal';
import { toast } from '../../store/toast';
import { Button } from '../../components/ui/Button';

/**
 * Feature gate: XLSX importing is temporarily disabled pending safe parser upgrades (CVE-2026-78206).
 * Export functionality (downloadMembersWorkbook) remains fully enabled and secured.
 */
const XLSX_IMPORT_DISABLED = true;
const XLSX_DISABLED_MESSAGE =
  'تم إيقاف استيراد ملفات Excel (XLSX) مؤقتًا لدواعي الأمان والتوافقية الهندسية (CVE-2026-78206). ميزة تصدير البيانات مستمرة بالكامل.';

export function MemberExcelActions({
  members,
  customFields = [],
}: {
  members: Member[];
  customFields?: MemberCustomField[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const importMembers = useBulkUpsertMembers();
  const [isOpen, setIsOpen] = useState(false);
  const [rows, setRows] = useState<MemberInsert[]>([]);
  const [message, setMessage] = useState(XLSX_IMPORT_DISABLED ? XLSX_DISABLED_MESSAGE : '');

  const chooseFile = async (file: File | undefined) => {
    if (XLSX_IMPORT_DISABLED) {
      setMessage(XLSX_DISABLED_MESSAGE);
      return;
    }
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setMessage('حجم الملف كبير جدًا. الحد الأقصى المسموح لملفات Excel هو 5 ميجابايت.');
      return;
    }
    try {
      const parsed = await parseMemberWorkbook(await file.arrayBuffer(), members, customFields);
      setRows(parsed.members);
      setMessage(`اتجهز ${parsed.members.length} عضو. اتساب ${parsed.skipped} صف عشان البيانات ناقصة أو مكررة.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'معرفناش نقرا ملف Excel.');
    }
  };

  const confirmImport = async () => {
    if (XLSX_IMPORT_DISABLED) {
      toast.warning(XLSX_DISABLED_MESSAGE);
      return;
    }
    try {
      await importMembers.mutateAsync(rows);
      setRows([]);
      setIsOpen(false);
      setMessage('');
      toast.success('بيانات الأعضاء اتستوردت بنجاح.');
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : 'حصلت مشكلة في الاستيراد.';
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
        استيراد بيانات
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          members.length ? downloadMembersWorkbook(members, customFields) : toast.warning('مفيش بيانات نصدّرها.')
        }
        icon={<Download size={17} />}
        fullOnMobile
        className="whitespace-nowrap"
      >
        تصدير Excel
      </Button>
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="استيراد بيانات الأعضاء من Excel" maxWidth="xl">
        <div className="grid gap-4">
          {XLSX_IMPORT_DISABLED && (
            <div
              className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs font-semibold leading-relaxed text-[var(--text)]"
              role="alert"
            >
              <ShieldAlert size={20} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <div>
                <p className="font-bold text-amber-800 dark:text-amber-300">استيراد ملفات Excel معطّل مؤقتًا</p>
                <p className="mt-1 text-[var(--text-2)]">{XLSX_DISABLED_MESSAGE}</p>
              </div>
            </div>
          )}
          <label
            className={`grid gap-3 rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--bg)] p-5 text-center ${
              XLSX_IMPORT_DISABLED ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            }`}
          >
            <FileSpreadsheet size={34} className="mx-auto text-emerald-700 dark:text-emerald-300" />
            <span className="text-sm font-bold">
              {XLSX_IMPORT_DISABLED ? 'الاستيراد معطّل مؤقتًا لدواعي الأمان' : 'اختار ملف Excel أو CSV'}
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
          {message && (
            <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm" role="status">
              {message}
            </p>
          )}
          {rows.length > 0 && (
            <>
              <div className="max-h-64 overflow-auto rounded-xl border border-[var(--border)]">
                <table className="data-table w-full text-start text-sm">
                  <thead>
                    <tr>
                      <th>الاسم</th>
                      <th>البريد الإلكتروني</th>
                      <th>حالة العمل</th>
                      <th>الجهاز</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 10).map((row) => (
                      <tr key={row.email}>
                        <td data-label="الاسم">{row.full_name}</td>
                        <td data-label="البريد الإلكتروني" dir="ltr">
                          {row.email}
                        </td>
                        <td data-label="حالة العمل">{row.work_status || '—'}</td>
                        <td data-label="الجهاز">{row.device || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-sm text-[var(--text-muted)]">
                هيتحدّث الأعضاء المطابقين للإيميل، وهينضاف الأعضاء الجدد.
              </p>
            </>
          )}
          <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setIsOpen(false)} fullOnMobile>
              إلغاء
            </Button>
            <Button
              onClick={() => void confirmImport()}
              disabled={!rows.length}
              isLoading={importMembers.isPending}
              loadingText="بنستورد..."
              fullOnMobile
            >
              تأكيد الاستيراد
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
