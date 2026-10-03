// Cherche sur Wikimedia Commons des photos libres pour photo-search/places.json (lancé par GitHub Actions).
const fs = require('node:fs');
const path = require('node:path');
const dir = path.resolve(__dirname, '..', 'photo-search');
const API = 'https://commons.wikimedia.org/w/api.php';
const HEADERS = { 'User-Agent': 'LupettiPhotoFinder/1.0 (https://lupetti.ch; contact@lupetti.ch)' };
const OK_LICENSE = /^(cc0|public domain|pd\b|cc by(-sa)? \d(\.\d)?( [a-z]{2})?$)/i;
const MAX_PER_PLACE = 3;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function plain(html) {
  return String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
function normalize(text) {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
function distanceM(a, b) {
  const r = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.sqrt(h)));
}
async function api(params) {
  const url = API + '?' + new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, { headers: HEADERS });
    if (response.ok) return response.json();
    await pause(2000 * (attempt + 1));
  }
  throw new Error('Commons indisponible');
}
const IMAGE_PROPS = { prop: 'imageinfo|coordinates', iiprop: 'url|extmetadata|size|mime', iiurlwidth: '960' };

function toCandidate(page, place) {
  const info = page.imageinfo?.[0];
  if (!info || !/^image\/(jpeg|png)$/.test(info.mime) || info.width < 800) return null;
  const meta = info.extmetadata ?? {};
  const license = plain(meta.LicenseShortName?.value);
  if (!OK_LICENSE.test(license) || /\b(nc|nd)\b/i.test(license)) return null;
  const author = plain(meta.Artist?.value) || 'Auteur inconnu';
  const description = plain(meta.ImageDescription?.value).slice(0, 300);
  const coords = page.coordinates?.[0];
  const words = normalize(place.title).split(/[^a-z0-9]+/).filter(w => w.length > 3);
  const haystack = normalize(page.title + ' ' + description);
  const nameHits = words.filter(w => haystack.includes(w)).length;
  return {
    file: page.title,
    sourceUrl: info.descriptionurl,
    url: info.thumburl,
    reviewThumb: info.thumburl.replace(/\/\d+px-/, '/330px-'),
    width: info.width, height: info.height,
    license, author, description,
    distanceM: coords ? distanceM(place, { lat: coords.lat, lon: coords.lon }) : null,
    nameHits,
  };
}

async function candidatesFor(place) {
  const found = new Map();
  if (Number.isFinite(place.lat) && Number.isFinite(place.lon)) {
    const geo = await api({ action: 'query', generator: 'geosearch', ggscoord: `${place.lat}|${place.lon}`,
      ggsradius: '250', ggslimit: '15', ggsnamespace: '6', ...IMAGE_PROPS });
    for (const page of geo.query?.pages ?? []) { const c = toCandidate(page, place); if (c) found.set(c.file, c); }
    await pause(250);
  }
  const search = await api({ action: 'query', generator: 'search', gsrsearch: `${place.title} ${place.city ?? ''}`.trim(),
    gsrnamespace: '6', gsrlimit: '10', ...IMAGE_PROPS });
  for (const page of search.query?.pages ?? []) { const c = toCandidate(page, place); if (c && (c.nameHits > 0 || (c.distanceM ?? 1e9) < 400)) found.set(c.file, c); }
  return [...found.values()]
    .sort((a, b) => b.nameHits - a.nameHits || (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9))
    .slice(0, MAX_PER_PLACE);
}

async function main() {
  const places = JSON.parse(fs.readFileSync(path.join(dir, 'places.json'), 'utf8')).places;
  const outFile = path.join(dir, 'candidates.json');
  const previous = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')).places : [];
  const done = new Map(previous.filter(p => !p.error).map(p => [p.id, p]));
  fs.mkdirSync(path.join(dir, 'thumbs'), { recursive: true });
  const results = [];
  let count = 0;
  for (const place of places) {
    if (done.has(place.id)) { results.push(done.get(place.id)); continue; }
    try {
      const candidates = await candidatesFor(place);
      for (const [index, candidate] of candidates.entries()) {
        const file = `${place.id.replace(/[^a-zA-Z0-9_-]/g, '-')}--${index}.jpg`;
        const response = await fetch(candidate.reviewThumb, { headers: HEADERS });
        if (response.ok) { fs.writeFileSync(path.join(dir, 'thumbs', file), Buffer.from(await response.arrayBuffer())); candidate.thumbFile = file; }
        await pause(150);
      }
      results.push({ ...place, candidates });
    } catch (error) {
      results.push({ ...place, candidates: [], error: String(error.message ?? error) });
    }
    if (++count % 20 === 0) console.log(`${count} lieux traités…`);
    await pause(250);
  }
  fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), places: results }, null, 1));
  console.log(`Terminé : ${results.filter(r => r.candidates.length).length}/${results.length} lieux avec au moins une photo candidate.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
