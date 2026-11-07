import type { Member } from '../../types/db';
import { DeviceChips, MemberRowMenu, ReadinessChip, WorkStatusChip } from './MemberCells';

export function MemberTable({
  members,
  onView,
  onEdit,
  onDelete,
}: {
  members: Member[];
  onView: (member: Member) => void;
  onEdit: (member: Member) => void;
  onDelete: (member: Member) => void;
}) {
  return (
    <div className="w-full overflow-x-auto border-y border-[var(--border)]">
      <table className="w-full min-w-[56rem] table-fixed border-collapse text-start text-sm">
        <caption className="sr-only">جدول الأعضاء — دوس على أي صف عشان تشوف التفاصيل</caption>
        <thead className="sticky top-0 z-10 bg-[var(--surface-2)]">
          <tr>
            <th scope="col" className="w-[30%] px-4 py-3 text-start text-xs font-black text-[var(--text-muted)]">العضو</th>
            <th scope="col" className="w-[12%] px-4 py-3 text-start text-xs font-black text-[var(--text-muted)]">الحالة</th>
            <th scope="col" className="w-[15%] px-4 py-3 text-start text-xs font-black text-[var(--text-muted)]">الأجهزة</th>
            <th scope="col" className="w-[20%] px-4 py-3 text-start text-xs font-black text-[var(--text-muted)]">الموقع</th>
            <th scope="col" className="w-[15%] px-4 py-3 text-start text-xs font-black text-[var(--text-muted)]">الميدان</th>
            <th scope="col" className="w-[8%] sticky inline-end-0 px-4 py-3 text-center text-xs font-black text-[var(--text-muted)] bg-[var(--surface-2)] shadow-[1px_0_0_var(--border)]">الإجراءات</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)] bg-[var(--surface)]">
          {members.map((member) => (
            <tr 
              key={member.id} 
              onClick={() => onView(member)} 
              className="group h-[72px] cursor-pointer transition-colors hover:bg-[var(--primary-soft)] focus-visible:bg-[var(--primary-soft)] focus-visible:outline-none" 
              tabIndex={0}
              onKeyDown={(event) => { if (event.key === 'Enter') onView(member); }}
              aria-label={`شوف تفاصيل ${member.full_name}`}
            >
              <td className="px-4 py-2">
                <div className="flex items-center gap-3 overflow-hidden">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--surface-2)] text-base font-black text-[var(--link)] group-hover:bg-[var(--surface)]" aria-hidden="true">
                    {member.full_name.trim().charAt(0) || '؟'}
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-bold text-[var(--text)]">{member.full_name}</span>
                    {member.email ? (
                      <span className="truncate text-xs font-semibold text-[var(--text-muted)]" dir="ltr" title={member.email}>{member.email}</span>
                    ) : member.phone ? (
                      <span className="truncate text-xs font-semibold text-[var(--text-muted)]" dir="ltr" title={member.phone}>{member.phone}</span>
                    ) : null}
                  </div>
                </div>
              </td>
              <td className="px-4 py-2"><WorkStatusChip status={member.work_status} /></td>
              <td className="px-4 py-2"><DeviceChips device={member.device} /></td>
              <td className="px-4 py-2">
                <span className="block truncate text-sm font-semibold text-[var(--text)]" title={member.residence || 'مش محدد'}>{member.residence || '—'}</span>
              </td>
              <td className="px-4 py-2 whitespace-nowrap"><ReadinessChip ready={member.can_go_alexandria} /></td>
              <td className="sticky inline-end-0 bg-[var(--surface)] px-2 py-2 text-center group-hover:bg-[var(--primary-soft)] shadow-[1px_0_0_var(--border)]" onClick={(event) => event.stopPropagation()}>
                <MemberRowMenu member={member} onView={onView} onEdit={onEdit} onDelete={onDelete} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
