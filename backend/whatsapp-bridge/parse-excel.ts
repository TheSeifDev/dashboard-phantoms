import fs from 'fs';
import ExcelJS from 'exceljs';

const filePath = String.raw`C:\Users\aboha\Desktop\بيانات تيم PHANTOMS (الردود).xlsx`;

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

  console.log('Columns:', headers.filter(Boolean));
  console.log('First 2 rows:', rows.slice(0, 2));
}

void main();
