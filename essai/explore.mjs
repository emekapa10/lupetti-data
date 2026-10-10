const out = [];
const note = (m) => out.push(String(m).slice(0, 1800).replace(/\n/g, ' | '));
const B = 'https://opendata.bagnet.ch/?r=/download&path=';
async function head(name, path, n = 4) {
  const r = await fetch(B + path); const buf = Buffer.from(await r.arrayBuffer());
  const txt = buf.toString('utf8'); const lines = txt.split(/\r?\n/);
  note(`${name}: status ${r.status} ${buf.length} octets, ${lines.length} lignes. ${lines.slice(0, n).join(' || ')}`);
  return lines;
}
const p = await head('Primes', 'L1ByYWVtaWVuL1Byw6RtaWVuX0NILmNzdg%3D%3D', 3);
const sep = p[0].includes(';') ? ';' : ',';
const cols = p[0].split(sep);
const vals = {};
for (const l of p.slice(1, 400000)) { const c = l.split(sep); cols.forEach((k, i) => { if (['Kanton', 'Geschäftsjahr', 'Altersklasse', 'Unfalleinschluss', 'Tariftyp', 'Franchise', 'Franchisestufe', 'Region', 'Altersuntergruppe', 'isBaseP', 'isBaseF', 'Erhebungsjahr'].some(x => k.includes(x))) { (vals[k] ??= new Set()).add(c[i]); } }); }
note('Valeurs: ' + Object.entries(vals).map(([k, s]) => `${k}=[${[...s].slice(0, 40).join(',')}]`).join(' ; '));
const vdRows = p.filter(l => l.split(sep)[cols.findIndex(c => c.includes('Kanton'))] === 'VD').length;
note(`Lignes VD: ${vdRows}`);
await head('Tarife', 'L1ByYWVtaWVuL1RhcmlmZS5jc3Y%3D', 4);
for (const u of ['https://www.priminfo.admin.ch/downloads/praemienregionen-2027.xlsx', 'https://www.priminfo.admin.ch/downloads/assureurs-maladie-admis-2026-10.xlsx']) {
  try { const r = await fetch(u); note(`${u} -> ${r.status} ${r.headers.get('content-type')} ${r.headers.get('content-length')}`); } catch (e) { note(u + ' ERR ' + e.message); }
}
for (const m of out) console.log(`::notice::${m}`);
