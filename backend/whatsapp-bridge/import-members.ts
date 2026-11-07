import fs from 'fs';
import { read, utils } from 'xlsx';

const path = String.raw`C:\Users\aboha\Desktop\بيانات تيم وصلة  (الردود).xlsx`;
const buf = fs.readFileSync(path);
const workbook = read(buf);
const sheetName = workbook.SheetNames[0];
const data = utils.sheet_to_json(workbook.Sheets[sheetName]);

const normalizePhone = (p: string | number | undefined | null) => {
  if (!p) return null;
  const digits = String(p).replace(/\D/g, '');
  return digits.length >= 10 ? digits : null;
};

const escapeSql = (str: string | null) => {
  if (!str) return 'NULL';
  return "'" + str.replace(/'/g, "''") + "'";
};

let sql = `-- سكربت استيراد بيانات الأعضاء\n`;
sql += `INSERT INTO members (email, full_name, phone, residence, device, work_conditions, bio, can_go_alexandria, work_status, completion_rank)\nVALUES\n`;

const values: string[] = [];

for (const row of data as any[]) {
  const rawPhone = row['رقم تلفون '];
  const phone = normalizePhone(rawPhone);
  const fullName = row['الاسم ثنائي '];
  
  if (!fullName) continue;

  const email = phone ? `${phone}@wasla.app` : `${fullName.replace(/\s+/g, '.')}@wasla.app`;
  const residence = row['السكن '] || null;
  const attendance = row['نزول اجتماعات التيم '];
  const can_go_alexandria = attendance === 'متاح' || attendance === 'نعم';
  const device = row['الاجهزة متوفرة لديك'] || null;
  const work_conditions = row['شغال ولا متفرغ ؟'] || null;
  
  const specialization = row['اكتب تخصص بتاعك او اكثر حاجة بتحب تعلمها (كا مثال : سوفت وير, هارد وير , front end  وهكذا ) '];
  const notes = row['ملاحظات شخصية '];
  
  let bio = '';
  if (specialization) bio += `التخصص: ${specialization}`;
  if (notes) bio += (bio ? ' | ' : '') + `ملاحظات: ${notes}`;
  
  values.push(`(${escapeSql(email)}, ${escapeSql(fullName)}, ${escapeSql(phone || rawPhone || null)}, ${escapeSql(residence)}, ${escapeSql(device)}, ${escapeSql(work_conditions)}, ${escapeSql(bio || null)}, ${can_go_alexandria}, 'active', 0)`);
}

sql += values.join(',\n') + '\n';
sql += `ON CONFLICT (email) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  phone = EXCLUDED.phone,
  residence = EXCLUDED.residence,
  device = EXCLUDED.device,
  work_conditions = EXCLUDED.work_conditions,
  bio = EXCLUDED.bio,
  can_go_alexandria = EXCLUDED.can_go_alexandria;`;

fs.writeFileSync('import.sql', sql, 'utf-8');
console.log('Successfully generated import.sql');

