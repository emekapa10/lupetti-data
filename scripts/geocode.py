"""Cherche des coordonnées OpenStreetMap (Nominatim) pour geocode/queries.json -> geocode/results.json."""
import json, time, traceback, urllib.parse, urllib.request
UA = {"User-Agent": "LupettiGeocode/1.0 (https://lupetti.ch; contact@lupetti.ch)"}
out = []
for q in json.load(open("geocode/queries.json"))["queries"]:
    hits = []
    for text in (q["q"], f'{q["name"]}, {q["city"]}', q["name"]):
        url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": text, "format": "jsonv2", "countrycodes": "ch", "limit": 5, "addressdetails": 1})
        try:
            hits = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))
        except Exception as e:
            print(f"::warning::{text}: {e}"); hits = []
        time.sleep(1.2)
        if hits: break
    try:
        out.append({**q, "results": [{"lat": h["lat"], "lon": h["lon"], "name": h.get("name"), "display": h.get("display_name"), "osm": f'https://www.openstreetmap.org/{h.get("osm_type")}/{h.get("osm_id")}', "type": h.get("type")} for h in hits]})
    except Exception:
        print("::error::" + traceback.format_exc().replace("\n", " | "))
json.dump({"results": out}, open("geocode/results.json", "w"), ensure_ascii=False, indent=1)
print(sum(1 for o in out if o["results"]), "/", len(out))
