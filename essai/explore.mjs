// Exploration temporaire (Fidou) : quelles ressources pour les primes LAMal ?
const note = (m) => console.log(`::notice::${String(m).slice(0, 900).replace(/\n/g, ' | ')}`);
const pkg = await (await fetch('https://ckan.opendata.swiss/api/3/action/package_show?id=health-insurance-premiums')).json();
for (const r of pkg.result.resources) note(`${r.format} | ${JSON.stringify(r.name)} | ${r.url} | ${r.modified || r.issued}`);
for (const u of ['https://www.priminfo.admin.ch/downloads/praemienregionen-2027.xlsx', 'https://www.priminfo.admin.ch/downloads/assureurs-maladie-admis-2026-10.xlsx']) {
  const r = await fetch(u); note(`${u} -> ${r.status} ${r.headers.get('content-type')} ${r.headers.get('content-length')}`);
}
