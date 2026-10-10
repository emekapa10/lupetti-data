// 2e passe : photos libres (Wikimedia Commons) pour les lieux encore sans photo (photo-search/places2.json).
// Sources, par ordre de confiance : image Wikidata (P18), catégorie Commons du lieu, recherche par nom, photos géolocalisées.
const fs = require('node:fs');
const path = require('node:path');
const dir = path.resolve(__dirname, '..', 'photo-search');
const API = 'https://commons.wikimedia.org/w/api.php';
const WD = 'https://www.wikidata.org/w/api.php';
const HEADERS = { 'User-Agent': 'LupettiPhotoFinder/1.1 (https://lupetti.ch; contact@lupetti.ch)' };
const OK_LICENSE = /^(cc0|public domain|pd\b|cc by(-sa)? \d(\.\d)?( [a-z]{2})?$)/i;
const MAX_PER_PLACE = 4;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const plain = html => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const normalize = text => String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const STOP = new Set(['avec', 'pour', 'dans', 'place', 'parc', 'jeux', 'plage', 'piscine', 'sentier', 'chemin', 'musee', 'lac', 'des', 'les', 'sur']);
function distanceM(a, b) {
  const r = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.sqrt(h)));
}
async function get(base, params) {
  const url = base + '?' + new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: HEADERS });
      if (response.ok) return response.json();
    } catch {}
    await pause(2000 * (attempt + 1));
  }
  throw new Error('API indisponible');
}
const IMAGE_PROPS = { prop: 'imageinfo|coordinates', iiprop: 'url|extmetadata|size|mime', iiurlwidth: '960' };
function words(place) {
  return [...new Set([place.title, ...(place.alt ?? [])].flatMap(t => normalize(t).split(/[^a-z0-9]+/)).filter(w => w.length > 3 && !STOP.has(w)))];
}
function toCandidate(page, place, via) {
  const info = page.imageinfo?.[0];
  if (!info || !/^image\/(jpeg|png)$/.test(info.mime) || info.width < 800) return null;
  const meta = info.extmetadata ?? {};
  const license = plain(meta.LicenseShortName?.value);
  if (!OK_LICENSE.test(license) || /\b(nc|nd)\b/i.test(license)) return null;
  const description = plain(meta.ImageDescription?.value).slice(0, 300);
  const coords = page.coordinates?.[0];
  const haystack = normalize(page.title + ' ' + description + ' ' + plain(meta.Categories?.value));
  return {
    file: page.title, sourceUrl: info.descriptionurl, url: info.thumburl,
    reviewThumb: info.thumburl.replace(/\/\d+px-/, '/330px-'),
    width: info.width, height: info.height, license,
    author: plain(meta.Artist?.value) || 'Auteur inconnu', description,
    distanceM: coords ? distanceM(place, { lat: coords.lat, lon: coords.lon }) : null,
    nameHits: words(place).filter(w => haystack.includes(w)).length, via,
  };
}
const RANK = { wikidata: 0, category: 1, search: 2, geo: 3 };
async function candidatesFor(place) {
  const found = new Map();
  const add = (pages, via, keep = () => true) => { for (const page of pages ?? []) { const c = toCandidate(page, place, via); if (c && keep(c) && !found.has(c.file)) found.set(c.file, c); } };
  let category = null;
  if (place.wikidata) {
    const wd = await get(WD, { action: 'wbgetentities', ids: place.wikidata, props: 'claims' });
    const claims = wd.entities?.[place.wikidata]?.claims ?? {};
    const image = claims.P18?.[0]?.mainsnak?.datavalue?.value;
    category = claims.P373?.[0]?.mainsnak?.datavalue?.value ?? null;
    if (image) add((await get(API, { action: 'query', titles: 'File:' + image, ...IMAGE_PROPS })).query?.pages, 'wikidata');
    await pause(200);
  }
  if (!category) {
    // Catégorie Commons dont le nom correspond au lieu (ex. « Category:Gorges du Trient »).
    for (const title of [place.title, ...(place.alt ?? [])].slice(0, 3)) {
      const res = await get(API, { action: 'query', list: 'search', srsearch: `intitle:"${title.replace(/"/g, '')}"`, srnamespace: '14', srlimit: '5' });
      const want = normalize(title).replace(/[^a-z0-9]/g, '');
      const hit = (res.query?.search ?? []).find(s => { const n = normalize(s.title.replace(/^Category:/, '')).replace(/[^a-z0-9]/g, ''); return n === want || (n.startsWith(want) && want.length > 8); });
      await pause(200);
      if (hit) { category = hit.title.replace(/^Category:/, ''); break; }
    }
  }
  if (category) {
    const res = await get(API, { action: 'query', generator: 'categorymembers', gcmtitle: 'Category:' + category, gcmtype: 'file', gcmlimit: '12', ...IMAGE_PROPS });
    add(res.query?.pages, 'category', c => c.distanceM == null || c.distanceM < 3000);
    await pause(200);
  }
  for (const title of [place.title, ...(place.alt ?? [])].slice(0, 2)) {
    const res = await get(API, { action: 'query', generator: 'search', gsrsearch: `${title} ${place.city ?? ''}`.trim(), gsrnamespace: '6', gsrlimit: '12', ...IMAGE_PROPS });
    add(res.query?.pages, 'search', c => c.nameHits > 0 && (c.distanceM == null || c.distanceM < 2000));
    await pause(200);
  }
  const geo = await get(API, { action: 'query', generator: 'geosearch', ggscoord: `${place.lat}|${place.lon}`, ggsradius: '150', ggslimit: '20', ggsnamespace: '6', ...IMAGE_PROPS });
  add(geo.query?.pages, 'geo', c => c.nameHits > 0 || c.distanceM < 60);
  return [...found.values()]
    .sort((a, b) => RANK[a.via] - RANK[b.via] || b.nameHits - a.nameHits || (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9))
    .slice(0, MAX_PER_PLACE);
}
async function main() {
  const places = JSON.parse(fs.readFileSync(path.join(dir, 'places2.json'), 'utf8')).places;
  const outFile = path.join(dir, 'candidates2.json');
  const previous = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')).places : [];
  const done = new Map(previous.filter(p => !p.error).map(p => [p.id, p]));
  fs.mkdirSync(path.join(dir, 'thumbs2'), { recursive: true });
  const results = [];
  let count = 0;
  for (const place of places) {
    if (done.has(place.id)) { results.push(done.get(place.id)); continue; }
    try {
      const candidates = await candidatesFor(place);
      for (const [index, candidate] of candidates.entries()) {
        const file = `${place.id.replace(/[^a-zA-Z0-9_-]/g, '-')}--${index}.jpg`;
        try {
          const response = await fetch(candidate.reviewThumb, { headers: HEADERS });
          if (response.ok) { fs.writeFileSync(path.join(dir, 'thumbs2', file), Buffer.from(await response.arrayBuffer())); candidate.thumbFile = file; }
        } catch {}
        await pause(120);
      }
      results.push({ ...place, candidates });
    } catch (error) {
      results.push({ ...place, candidates: [], error: String(error.message ?? error) });
    }
    if (++count % 25 === 0) console.log(`${count} lieux traités…`);
  }
  fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), places: results }, null, 1));
  console.log(`Terminé : ${results.filter(r => r.candidates.length).length}/${results.length} lieux avec au moins une photo candidate.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
