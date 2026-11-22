import ExcelJS from 'exceljs';
import type { Meeting, MeetingRoster } from './types';

/** تصدير الحضور لملف Excel — اجتماع واحد أو كل الاجتماعات (ملخص + أعضاء + اجتماعات). */
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2430' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const AR_DATE = new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' });

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  row.height = 22;
}

function stamp(meeting: Pick<Meeting, 'starts_at'>): string {
  const date = new Date(meeting.starts_at);
  return Number.isFinite(date.getTime()) ? AR_DATE.format(date) : String(meeting.starts_at);
}

function fileName(prefix: string): string {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}.xlsx`;
}

async function save(workbook: ExcelJS.Workbook, name: string) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function exportMeetingRoster(roster: MeetingRoster) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PHANTOMS';
  const sheet = workbook.addWorksheet('الحضور', { views: [{ rightToLeft: false }] });
  sheet.columns = [
    { header: 'الاسم', key: 'name', width: 32 },
    { header: 'الرقم الأكاديمي', key: 'academic', width: 18 },
    { header: 'ضمن الجمهور', key: 'expected', width: 14 },
    { header: 'حاضر', key: 'present', width: 10 },
    { header: 'طريقة التسجيل', key: 'method', width: 16 },
    { header: 'وقت التسجيل', key: 'marked_at', width: 24 },
  ];
  styleHeader(sheet.getRow(1));
  for (const member of roster.members) {
    sheet.addRow({
      name: member.full_name,
      academic: member.academic_number ?? '—',
      expected: member.expected ? 'نعم' : 'لا',
      present: member.present ? 'حاضر' : 'غائب',
      method: member.method === 'scan' ? 'QR' : member.method === 'manual' ? 'يدوي' : '—',
      marked_at: member.marked_at ? AR_DATE.format(new Date(member.marked_at)) : '—',
    });
  }
  const info = workbook.addWorksheet('بيانات الاجتماع');
  info.columns = [{ header: 'الحقل', key: 'field', width: 24 }, { header: 'القيمة', key: 'value', width: 46 }];
  styleHeader(info.getRow(1));
  info.addRow({ field: 'العنوان', value: roster.meeting.title });
  info.addRow({ field: 'النوع', value: roster.meeting.mode === 'online' ? 'أونلاين' : 'أوفلاين' });
  info.addRow({ field: 'الميعاد', value: stamp(roster.meeting) });
  info.addRow({ field: 'المدة (دقيقة)', value: roster.meeting.duration_minutes });
  info.addRow({ field: roster.meeting.mode === 'online' ? 'الرابط' : 'المكان', value: roster.meeting.mode === 'online' ? (roster.meeting.online_url ?? '—') : (roster.meeting.location ?? '—') });
  info.addRow({ field: 'المتوقع', value: roster.expected });
  info.addRow({ field: 'الحضور', value: roster.present });
  info.addRow({ field: 'نسبة الحضور', value: roster.expected > 0 ? `${Math.round((roster.present / roster.expected) * 100)}%` : '—' });
  await save(workbook, fileName(`meeting-${roster.meeting.id}`));
}

export async function exportAllMeetings(meetings: Meeting[], rosters: MeetingRoster[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PHANTOMS';

  const onlineCount = meetings.filter((meeting) => meeting.mode === 'online').length;
  const offlineCount = meetings.filter((meeting) => meeting.mode === 'offline').length;
  const totalExpected = rosters.reduce((sum, roster) => sum + roster.expected, 0);
  const totalPresent = rosters.reduce((sum, roster) => sum + roster.present, 0);

  const summary = workbook.addWorksheet('ملخص');
  summary.columns = [{ header: 'البند', key: 'label', width: 28 }, { header: 'القيمة', key: 'value', width: 18 }];
  styleHeader(summary.getRow(1));
  summary.addRow({ label: 'عدد الاجتماعات', value: meetings.length });
  summary.addRow({ label: 'اجتماعات أونلاين', value: onlineCount });
  summary.addRow({ label: 'اجتماعات أوفلاين', value: offlineCount });
  summary.addRow({ label: 'إجمالي المتوقع', value: totalExpected });
  summary.addRow({ label: 'إجمالي الحضور', value: totalPresent });
  summary.addRow({ label: 'نسبة الحضور', value: totalExpected > 0 ? `${Math.round((totalPresent / totalExpected) * 100)}%` : '—' });
  summary.addRow({ label: 'تاريخ التقرير', value: AR_DATE.format(new Date()) });

  const sheet = workbook.addWorksheet('الاجتماعات');
  sheet.columns = [
    { header: 'العنوان', key: 'title', width: 34 },
    { header: 'النوع', key: 'mode', width: 12 },
    { header: 'الميعاد', key: 'when', width: 24 },
    { header: 'المكان/الرابط', key: 'where', width: 34 },
    { header: 'المتوقع', key: 'expected', width: 10 },
    { header: 'الحضور', key: 'present', width: 10 },
    { header: 'النسبة', key: 'ratio', width: 10 },
  ];
  styleHeader(sheet.getRow(1));
  for (const roster of rosters) {
    sheet.addRow({
      title: roster.meeting.title,
      mode: roster.meeting.mode === 'online' ? 'أونلاين' : 'أوفلاين',
      when: stamp(roster.meeting),
      where: roster.meeting.mode === 'online' ? (roster.meeting.online_url ?? '—') : (roster.meeting.location ?? '—'),
      expected: roster.expected,
      present: roster.present,
      ratio: roster.expected > 0 ? `${Math.round((roster.present / roster.expected) * 100)}%` : '—',
    });
  }

  const people = new Map<number, { name: string; academic: string; expected: number; present: number; online: number; offline: number }>();
  for (const roster of rosters) {
    for (const member of roster.members) {
      const entry = people.get(member.member_id) ?? {
        name: member.full_name,
        academic: member.academic_number ?? '—',
        expected: 0,
        present: 0,
        online: 0,
        offline: 0,
      };
      if (member.expected) entry.expected += 1;
      if (member.present) {
        entry.present += 1;
        if (roster.meeting.mode === 'online') entry.online += 1;
        else entry.offline += 1;
      }
      people.set(member.member_id, entry);
    }
  }
  const members = workbook.addWorksheet('الأعضاء');
  members.columns = [
    { header: 'الاسم', key: 'name', width: 32 },
    { header: 'الرقم الأكاديمي', key: 'academic', width: 18 },
    { header: 'المتوقع', key: 'expected', width: 10 },
    { header: 'حضر', key: 'present', width: 10 },
    { header: 'أونلاين', key: 'online', width: 10 },
    { header: 'أوفلاين', key: 'offline', width: 10 },
    { header: 'النسبة', key: 'ratio', width: 10 },
  ];
  styleHeader(members.getRow(1));
  for (const entry of [...people.values()].sort((a, b) => b.present - a.present || a.name.localeCompare(b.name))) {
    members.addRow({
      name: entry.name,
      academic: entry.academic,
      expected: entry.expected,
      present: entry.present,
      online: entry.online,
      offline: entry.offline,
      ratio: entry.expected > 0 ? `${Math.round((entry.present / entry.expected) * 100)}%` : '—',
    });
  }
  await save(workbook, fileName('meetings-attendance'));
}