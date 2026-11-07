import fs from 'fs';
import ExcelJS from 'exceljs';

const filePath = String.raw`C:\Users\aboha\Desktop\بيانات تيم وصلة  (الردود).xlsx`;

const normalizePhone = (p: string | number | undefined | null) => {
  if (!p) return null;
  const digits = String(p).replace(/\D/g, '');
  return digits.length >= 10 ? digits : null;
};

const escapeSql = (str: string | null) => {
  if (!str) return 'NULL';
  return "'" + str.replace(/'/g, "''") + "'";
};

async function main() {
  if (!fs.existsSync(filePath)) {
    console.log('Sample file not found at:', filePath);
    return;
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    console.log('No worksheets found');
    return;
  }

  const rows: Record<string, unknown>[] = [];
  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell((cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? '').trim();
  });

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const rowData: Record<string, unknown> = {};
    row.eachCell((cell, colNumber) => {
      const header = headers[colNumber];
      if (header) {
        rowData[header] = cell.value;
      }
    });
    rows.push(rowData);
  });

  let sql = `-- سكربت استيراد بيانات الأعضاء\n`;
  sql += `INSERT INTO members (email, full_name, phone, residence, device, work_conditions, bio, can_go_alexandria, work_status, completion_rank)\nVALUES\n`;

  const values: string[] = [];

  for (const row of rows) {
    const rawPhone = row['رقم تلفون '] as string | number | undefined;
    const phone = normalizePhone(rawPhone);
    const fullName = String(row['الاسم ثنائي '] ?? '').trim();

    if (!fullName) continue;

    const email = phone ? `${phone}@wasla.app` : `${fullName.replace(/\s+/g, '.')}@wasla.app`;
    const residence = (row['السكن '] as string) || null;
    const attendance = row['نزول اجتماعات التيم '];
    const can_go_alexandria = attendance === 'متاح' || attendance === 'نعم';
    const device = (row['الاجهزة متوفرة لديك'] as string) || null;
    const work_conditions = (row['شغال ولا متفرغ ؟'] as string) || null;

    const specialization = row['اكتب تخصص بتاعك او اكثر حاجة بتحب تعلمها (كا مثال : سوفت وير, هارد وير , front end  وهكذا ) '];
    const notes = row['ملاحظات شخصية '];

    let bio = '';
    if (specialization) bio += `التخصص: ${specialization}`;
    if (notes) bio += (bio ? ' | ' : '') + `ملاحظات: ${notes}`;

    values.push(`(${escapeSql(email)}, ${escapeSql(fullName)}, ${escapeSql(phone || String(rawPhone || '') || null)}, ${escapeSql(residence)}, ${escapeSql(device)}, ${escapeSql(work_conditions)}, ${escapeSql(bio || null)}, ${can_go_alexandria}, 'active', 0)`);
  }

  sql += values.join(',\n') + '\n';
  fs.writeFileSync('backend/whatsapp-bridge/data/import_members.sql', sql);
  console.log('Generated SQL for', values.length, 'members');
}

void main();
