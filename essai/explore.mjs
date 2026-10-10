import { execSync } from 'node:child_process';
execSync('npm i xlsx@0.18.5 --no-save --silent', { stdio: 'ignore' });
const XLSX = (await import('xlsx')).default;
const out = []; const note = (m) => out.push(String(m).slice(0, 1800).replace(/\n/g, ' | '));
for (const u of ['https://www.priminfo.admin.ch/downloads/praemienregionen-2027.xlsx', 'https://www.priminfo.admin.ch/downloads/assureurs-maladie-admis-2026-10.xlsx']) {
  const wb = XLSX.read(Buffer.from(await (await fetch(u)).arrayBuffer()));
  for (const n of wb.SheetNames.slice(0, 3)) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: false });
    note(`${u.split('/').pop()} [${n}] ${rows.length} lignes: ` + rows.slice(0, 6).map(r => JSON.stringify(r)).join(' || '));
    const vd = rows.filter(r => r.some(c => c === 'VD' || c === 'VS')).slice(0, 3);
    if (vd.length) note('VD/VS exemples: ' + vd.map(r => JSON.stringify(r)).join(' || '));
  }
}
const B = 'https://opendata.bagnet.ch/?r=/download&path=';
const t = (await (await fetch(B + 'L1ByYWVtaWVuL1RhcmlmZS5jc3Y%3D')).text()).split(/\r?\n/);
const cat = {}; for (const l of t.slice(1)) { const c = l.split(','); (cat[c[3]] ??= []).push(c.slice(4, 8).join('/')); }
note('Tarife catégories: ' + Object.entries(cat).map(([k, v]) => `${k}(${v.length}): ${v.slice(0, 6).join(' ; ')}`).join(' ### '));
for (const m of out) console.log(`::notice::${m}`);
