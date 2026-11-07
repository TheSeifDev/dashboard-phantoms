import ExcelJS from 'exceljs';
import type { Member, MemberCustomField, MemberInsert } from '../../types/db';
import { formatCustomFieldValue, getMemberCustomFieldValue } from './customFieldsApi';

type Row = Record<string, unknown>;
const clean = (value: unknown) =>
  Array.from(String(value ?? ''))
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join('')
    .trim();

const cell = (row: Row, names: string[]) =>
  names
    .map((name) => row[name])
    .find((value) => value !== undefined && value !== null && clean(value) !== '');

function extractCellValue(cellValue: ExcelJS.CellValue): unknown {
  if (cellValue === null || cellValue === undefined) return '';
  if (typeof cellValue === 'object') {
    if ('text' in cellValue) {
      return (cellValue as { text: string }).text;
    }
    if ('result' in cellValue) {
      return (cellValue as { result: unknown }).result;
    }
  }
  return cellValue;
}

export async function parseMemberWorkbook(
  buffer: ArrayBuffer,
  knownMembers: Member[],
  customFields: MemberCustomField[] = [],
): Promise<{ members: MemberInsert[]; skipped: number }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('الملف مفيهوش ورقة بيانات.');

  const headers: string[] = [];
  const headerRow = worksheet.getRow(1);
  headerRow.eachCell({ includeEmpty: false }, (c, colNumber) => {
    headers[colNumber] = clean(extractCellValue(c.value));
  });

  const rows: Row[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const rowObj: Row = {};
    row.eachCell({ includeEmpty: false }, (c, colNumber) => {
      const header = headers[colNumber];
      if (header) {
        rowObj[header] = extractCellValue(c.value);
      }
    });
    rows.push(rowObj);
  });

  const imported: MemberInsert[] = [];
  const seenNames = new Set<string>();
  const seenEmails = new Set<string>();
  const knownNames = new Set(knownMembers.map((member) => member.full_name.trim().toLocaleLowerCase('ar')));
  let skipped = 0;

  for (const row of rows) {
    const name = clean(cell(row, ['الاسم الكامل', 'الاسم', 'اسم العضو', 'Name']));
    const email = clean(cell(row, ['البريد الإلكتروني', 'البريد', 'Email'])).toLowerCase();
    if (!name || !email.includes('@')) {
      skipped++;
      continue;
    }
    const normalizedName = name.toLocaleLowerCase('ar');
    if (seenEmails.has(email) || seenNames.has(normalizedName) || knownNames.has(normalizedName)) {
      skipped++;
      continue;
    }
    seenEmails.add(email);
    seenNames.add(normalizedName);
    const alex = cell(row, ['نزول الإسكندرية', 'متاح لنزول الإسكندرية', 'Alexandria']);

    const customMap: Record<string, string | number | boolean | null> = {};
    for (const field of customFields) {
      const rawCell = cell(row, [field.label]);
      if (rawCell === undefined || rawCell === null) continue;
      const cleanedVal = clean(rawCell);
      if (!cleanedVal) continue;
      if (field.field_type === 'yes_no') {
        customMap[String(field.id)] = cleanedVal === 'نعم' || cleanedVal === 'true' || cleanedVal === '1';
      } else if (field.field_type === 'number') {
        const num = Number(cleanedVal);
        if (Number.isFinite(num)) customMap[String(field.id)] = num;
      } else {
        customMap[String(field.id)] = cleanedVal;
      }
    }

    imported.push({
      full_name: name,
      email,
      completion_rank: null,
      team_notes: null,
      device: clean(cell(row, ['الجهاز', 'الجهاز المتوفر', 'Device'])) || 'لابتوب',
      residence: clean(cell(row, ['محل الإقامة', 'الإقامة'])) || null,
      phone: clean(cell(row, ['رقم الهاتف', 'الهاتف'])) || null,
      bio: clean(cell(row, ['نبذة', 'الدور'])) || null,
      gender: clean(cell(row, ['الجنس'])) || null,
      meeting_attendance: clean(cell(row, ['الحضور', 'حضور الاجتماعات'])) || null,
      work_status: clean(cell(row, ['حالة العمل', 'حالة الاستعداد'])) || 'active',
      work_conditions: clean(cell(row, ['ظروف العمل'])) || null,
      can_go_alexandria: alex === 'نعم' || alex === true || alex === 1,
      custom_fields: customMap,
    });
  }
  return { members: imported, skipped };
}

export async function downloadMembersWorkbook(members: Member[], customFields: MemberCustomField[] = []): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('أعضاء وصلة', {
    views: [{ rightToLeft: true }],
  });

  const columns: { header: string; key: string; width: number }[] = [
    { header: 'الاسم الكامل', key: 'name', width: 25 },
    { header: 'البريد الإلكتروني', key: 'email', width: 28 },
    { header: 'الجهاز المتوفر', key: 'device', width: 18 },
    { header: 'محل الإقامة', key: 'residence', width: 20 },
    { header: 'رقم الهاتف', key: 'phone', width: 16 },
    { header: 'متاح لنزول الإسكندرية', key: 'alex', width: 22 },
    { header: 'حالة العمل', key: 'work_status', width: 16 },
    { header: 'نبذة / الدور', key: 'bio', width: 25 },
    { header: 'الجنس', key: 'gender', width: 12 },
    { header: 'ظروف العمل', key: 'work_conditions', width: 20 },
  ];

  for (const field of customFields) {
    columns.push({
      header: field.label,
      key: `cf_${field.id}`,
      width: 20,
    });
  }

  worksheet.columns = columns;

  for (const member of members) {
    const rowValues: Record<string, string> = {
      name: safeCell(member.full_name),
      email: safeCell(member.email),
      device: safeCell(member.device),
      residence: safeCell(member.residence),
      phone: safeCell(member.phone),
      alex: member.can_go_alexandria ? 'نعم' : 'لا',
      work_status: safeCell(member.work_status),
      bio: safeCell(member.bio),
      gender: safeCell(member.gender),
      work_conditions: safeCell(member.work_conditions),
    };

    for (const field of customFields) {
      const val = formatCustomFieldValue(field, getMemberCustomFieldValue(member, field));
      rowValues[`cf_${field.id}`] = safeCell(val || null);
    }

    worksheet.addRow(rowValues);
  }

  const fileName = `wasla-members-${new Date().toISOString().slice(0, 10)}.xlsx`;
  const uint8 = await workbook.xlsx.writeBuffer();

  const isNativeContainer =
    typeof window !== 'undefined' &&
    (window.location.origin === 'https://localhost' ||
      window.location.origin === 'http://localhost' ||
      window.location.origin.startsWith('capacitor://'));

  if (isNativeContainer && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      const file = new File(
        [uint8],
        fileName,
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      );
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'دليل أعضاء وصلة',
          files: [file],
        });
        return;
      }
    } catch {
      // Fallback to standard download
    }
  }

  const blob = new Blob([uint8], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function safeCell(value: string | null): string {
  const text = clean(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}
