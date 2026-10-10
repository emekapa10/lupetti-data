// Extraction OpenStreetMap des lieux de sortie en famille du canton du Valais (lancé par GitHub Actions).
// Sortie : valais/osm-places.json (tags bruts + commune + infos Wikidata). Aucune donnée inventée.
const fs = require('node:fs');
const path = require('node:path');
const OUT = path.resolve(__dirname, '..', 'valais');
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UA = { 'User-Agent': 'LupettiValais/1.0 (https://lupetti.ch; contact@lupetti.ch)' };
const AREA = 'area["ISO3166-2"="CH-VS"]["boundary"="administrative"]->.vs;';
const POI_QUERY = `[out:json][timeout:180];${AREA}(
  nwr["leisure"~"^(park|playground|nature_reserve|water_park|swimming_pool|swimming_area|beach_resort|bathing_place|ice_rink|miniature_golf|trampoline_park|garden|summer_toboggan|adventure_park)$"](area.vs);
  nwr["tourism"~"^(museum|zoo|aquarium|theme_park|attraction|picnic_site|gallery|wildlife_park)$"](area.vs);
  nwr["natural"~"^(beach|gorge|waterfall|cave_entrance)$"]["name"](area.vs);
  nwr["attraction"]["name"](area.vs);
  nwr["sport"~"climbing|ice_skating|swimming"]["leisure"="sports_centre"](area.vs);
  nwr["amenity"="planetarium"](area.vs);
);out center tags;`;
const COMMUNE_QUERY = `[out:json][timeout:180];${AREA}rel["boundary"="administrative"]["admin_level"="8"](area.vs);out geom;`;
const pause = ms => new Promise(r => setTimeout(r, ms));

async function overpass(query) {
  for (let round = 0; round < 3; round++) {
    for (const endpoint of SERVERS) {
      try {
        const res = await fetch(endpoint, { method: 'POST', body: new URLSearchParams({ data: query }), headers: UA, signal: AbortSignal.timeout(240000) });
        if (!res.ok) { console.log(endpoint, res.status); continue; }
        const data = await res.json();
        if (data.remark && /error|timed out/i.test(data.remark)) { console.log(endpoint, data.remark); continue; }
        return { endpoint, data };
      } catch (e) { console.log(endpoint, e.message); }
    }
    await pause(30000);
  }
  throw new Error('Overpass indisponible');
}

// Assemble les anneaux extérieurs d'une relation à partir des géométries des chemins membres.
function rings(rel) {
  const segs = (rel.members ?? []).filter(m => m.type === 'way' && m.role !== 'inner' && m.geometry?.length > 1)
    .map(m => m.geometry.map(p => [p.lon, p.lat]));
  const out = [];
  const key = p => p[0].toFixed(7) + ',' + p[1].toFixed(7);
  while (segs.length) {
    let ring = segs.shift();
    let guard = 0;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && guard++ < 5000) {
      const end = key(ring[ring.length - 1]);
      const i = segs.findIndex(s => key(s[0]) === end || key(s[s.length - 1]) === end);
      if (i < 0) break;
      const s = segs.splice(i, 1)[0];
      ring = ring.concat(key(s[0]) === end ? s.slice(1) : s.slice().reverse().slice(1));
    }
    if (ring.length > 3) out.push(ring);
  }
  return out;
}
function inside(pt, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

async function wikidata(ids) {
  const result = {};
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url = 'https://www.wikidata.org/w/api.php?' + new URLSearchParams({ action: 'wbgetentities', ids: batch.join('|'), props: 'labels|descriptions|claims|sitelinks', languages: 'fr|de|en', format: 'json' });
    try {
      const res = await fetch(url, { headers: UA });
      const data = await res.json();
      for (const [id, e] of Object.entries(data.entities ?? {})) {
        const claim = p => e.claims?.[p]?.[0]?.mainsnak?.datavalue?.value;
        result[id] = {
          labelFr: e.labels?.fr?.value ?? null, labelDe: e.labels?.de?.value ?? null,
          descriptionFr: e.descriptions?.fr?.value ?? null, descriptionDe: e.descriptions?.de?.value ?? null,
          image: claim('P18') ?? null, website: claim('P856') ?? null, commonsCategory: claim('P373') ?? null,
          frwiki: e.sitelinks?.frwiki?.title ?? null, dewiki: e.sitelinks?.dewiki?.title ?? null,
        };
      }
    } catch (e) { console.log('wikidata', e.message); }
    await pause(500);
  }
  return result;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const poi = await overpass(POI_QUERY);
  console.log('POI', poi.data.elements.length);
  await pause(10000);
  const com = await overpass(COMMUNE_QUERY);
  const communes = com.data.elements.filter(r => r.tags?.name).map(r => ({ name: r.tags.name, nameFr: r.tags['name:fr'] ?? null, nameDe: r.tags['name:de'] ?? null, rings: rings(r) }));
  console.log('Communes', communes.length);
  const wdIds = [...new Set(poi.data.elements.map(e => e.tags?.wikidata).filter(id => /^Q\d+$/.test(id ?? '')))];
  const wd = await wikidata(wdIds);
  const places = poi.data.elements.map(e => {
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    const c = lat == null ? null : communes.find(cm => cm.rings.some(r => inside([lon, lat], r)));
    return {
      osmId: `${e.type}/${e.id}`, lat, lon, tags: e.tags ?? {},
      commune: c ? { name: c.name, nameFr: c.nameFr, nameDe: c.nameDe } : null,
      wikidata: e.tags?.wikidata ? wd[e.tags.wikidata] ?? null : null,
    };
  });
  const meta = {
    generatedAt: new Date().toISOString(), endpoint: poi.endpoint, osmBase: poi.data.osm3s?.timestamp_osm_base ?? null,
    attribution: '© OpenStreetMap contributors (ODbL) ; Wikidata (CC0)', query: POI_QUERY,
    count: places.length, withCommune: places.filter(p => p.commune).length, communes: communes.length,
  };
  fs.writeFileSync(path.join(OUT, 'osm-places.json'), JSON.stringify({ meta, places }, null, 1));
  fs.writeFileSync(path.join(OUT, 'communes.json'), JSON.stringify(communes.map(c => ({ name: c.name, nameFr: c.nameFr, nameDe: c.nameDe })), null, 1));
  console.log(meta);
})().catch(e => { console.error(e); process.exit(1); });
