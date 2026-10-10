import { execSync } from 'node:child_process';
execSync('npm i xlsx@0.18.5 --no-save --silent', { stdio: 'ignore' });
const XLSX = (await import('xlsx')).default;
const out = []; const note = (m) => out.push(String(m).slice(0, 1800).replace(/\n/g, ' | '));
const wb = XLSX.read(Buffer.from(await (await fetch('https://www.priminfo.admin.ch/downloads/praemienregionen-2027.xlsx')).arrayBuffer()));
note('Feuilles: ' + wb.SheetNames.join(', '));
for (const n of wb.SheetNames.slice(3)) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: false });
  note(`[${n}] ${rows.length} lignes: ` + rows.slice(0, 4).map(r => JSON.stringify(r)).join(' || ') + ' ... VS: ' + JSON.stringify(rows.find(r => r.includes('VS'))));
}
for (const m of out.slice(0, 9)) console.log(`::notice::${m}`);
