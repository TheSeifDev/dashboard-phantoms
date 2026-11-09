import fs from 'node:fs';
import path from 'node:path';

const terms = ['com.wasla.app', 'wasla', 'Wasla', 'WASLA', 'وصلة', 'وصلة تك'];
const results = [];

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (['node_modules', '.git', 'dist', 'dist-apk', 'build', '.gradle', 'screenshots'].includes(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (['.png', '.jpg', '.jpeg', '.ico', '.pdf', '.jar', '.webp'].includes(ext)) continue;
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');
        const matchedTerms = [];
        const matchedLines = [];
        for (let i = 0; i < lines.length; i++) {
          for (const term of terms) {
            if (lines[i].includes(term)) {
              if (!matchedTerms.includes(term)) matchedTerms.push(term);
              if (matchedLines.length < 5) {
                matchedLines.push({ line: i + 1, text: lines[i].trim().slice(0, 120) });
              }
            }
          }
        }
        if (matchedTerms.length > 0) {
          results.push({
            file: fullPath.replace(/\\/g, '/'),
            terms: matchedTerms,
            matches: matchedLines
          });
        }
      } catch {}
    }
  }
}

walk('.');

console.log(`Found ${results.length} files containing legacy terms.`);
const grouped = {
  android: [],
  frontend_src: [],
  frontend_config: [],
  backend: [],
  scripts: [],
  audit_reports: [],
  other: []
};

for (const r of results) {
  if (r.file.includes('android')) grouped.android.push(r);
  else if (r.file.includes('frontend/src')) grouped.frontend_src.push(r);
  else if (r.file.includes('frontend/scripts')) grouped.scripts.push(r);
  else if (r.file.includes('frontend/')) grouped.frontend_config.push(r);
  else if (r.file.includes('backend/')) grouped.backend.push(r);
  else if (r.file.includes('audit/')) grouped.audit_reports.push(r);
  else grouped.other.push(r);
}

for (const [group, list] of Object.entries(grouped)) {
  console.log(`\n=== GROUP: ${group.toUpperCase()} (${list.length} files) ===`);
  for (const item of list) {
    console.log(`- ${item.file} [${item.terms.join(', ')}]`);
    item.matches.slice(0, 2).forEach(m => console.log(`    L${m.line}: ${m.text}`));
  }
}
