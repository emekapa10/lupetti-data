"""Copie les photos libres (Wikimedia Commons) listées dans photos-manifest.json vers docs/photos/<id>.jpg.
Les applis mobiles sont souvent bloquées par Wikimedia : l'appli Lupetti charge donc ces copies."""
import json, os, re, io, time, urllib.request
from PIL import Image
UA = "LupettiPhotoMirror/1.0 (https://lupetti.ch; contact@lupetti.ch)"
os.makedirs("docs/photos", exist_ok=True)
items = json.load(open("photos-manifest.json"))["photos"]
ok = fail = skip = 0
for it in items:
    pid = re.sub(r"[^a-zA-Z0-9_-]", "-", it["id"])
    dest = f"docs/photos/{pid}.jpg"
    if os.path.exists(dest):
        skip += 1; continue
    try:
        req = urllib.request.Request(it["url"], headers={"User-Agent": UA})
        data = urllib.request.urlopen(req, timeout=60).read()
        im = Image.open(io.BytesIO(data)).convert("RGB")
        im.thumbnail((1000, 1000))
        im.save(dest, "JPEG", quality=80, optimize=True, progressive=True)
        ok += 1
    except Exception as e:
        print("ERREUR", pid, e); fail += 1
    time.sleep(1)
print(f"copiées {ok}, déjà là {skip}, erreurs {fail}")
