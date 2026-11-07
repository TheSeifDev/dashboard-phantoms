import fs from 'fs';
import { read, utils } from 'xlsx';

const path = String.raw`C:\Users\aboha\Desktop\بيانات تيم وصلة  (الردود).xlsx`;
const buf = fs.readFileSync(path);
const workbook = read(buf);
const sheetName = workbook.SheetNames[0];
const data = utils.sheet_to_json(workbook.Sheets[sheetName]);

console.log('Columns:', Object.keys(data[0] || {}));
console.log('First 2 rows:', data.slice(0, 2));
