// Met à jour les primes d'assurance maladie (assurance de base, LAMal) à partir des données officielles de l'OFSP.
// Lancé chaque automne par GitHub Actions (.github/workflows/maj-primes.yml), ou à la main : node scripts/maj-primes.mjs
// Sources : opendata.swiss « Primes de l'assurance-maladie » (OFSP) et priminfo.admin.ch (régions de primes, assureurs admis).
// Sortie : public/primes/<année>/<canton>.json et public/primes/index.json. Aucune donnée personnelle.

import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

const CANTONS = ["VD", "VS", "GE", "FR", "NE", "JU"];
const RACINE = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const SORTIE = path.join(RACINE, "public", "primes");
const CKAN = "https://ckan.opendata.swiss/api/3/action/package_show?id=health-insurance-premiums";
const UA = { "User-Agent": "Fidou/1.0 (https://fidou.ch)" };

async function telecharger(url) {
  for (let essai = 1; essai <= 3; essai++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      console.log(`${url} : ${r.status}`);
    } catch (e) { console.log(`${url} : ${e.message}`); }
    await new Promise((ok) => setTimeout(ok, 5000 * essai));
  }
  throw new Error("Téléchargement impossible : " + url);
}

/** CSV avec guillemets éventuels. */
function lireCsv(texte) {
  const lignes = [];
  let ligne = [], champ = "", guillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (guillemets) {
      if (c === '"' && texte[i + 1] === '"') { champ += '"'; i++; }
      else if (c === '"') guillemets = false;
      else champ += c;
    } else if (c === '"') guillemets = true;
    else if (c === ",") { ligne.push(champ); champ = ""; }
    else if (c === "\n") { ligne.push(champ.replace(/\r$/, "")); lignes.push(ligne); ligne = []; champ = ""; }
    else champ += c;
  }
  if (champ || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  const entete = lignes.shift().map((h) => h.replace(/^﻿/, "").trim());
  return lignes.filter((l) => l.length >= entete.length).map((l) => Object.fromEntries(entete.map((h, i) => [h, l[i]])));
}

const feuille = (wb, nom) => XLSX.utils.sheet_to_json(wb.Sheets[nom], { header: 1, blankrows: false });
const propre = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

async function main() {
  const paquet = JSON.parse((await telecharger(CKAN)).toString("utf8"));
  const res = (nom) => paquet.result.resources.find((r) => Object.values(r.name ?? {}).includes(nom) || r.url?.includes(Buffer.from(`/Praemien/${nom}`).toString("base64").replace(/=+$/, "")));
  const urlPrimes = res("Prämien_CH.csv")?.url, urlTarifs = res("Tarife.csv")?.url;
  if (!urlPrimes || !urlTarifs) throw new Error("Fichiers Prämien_CH.csv ou Tarife.csv introuvables sur opendata.swiss");

  const primes = lireCsv((await telecharger(urlPrimes)).toString("utf8"));
  const annee = Math.max(...primes.map((p) => Number(p["Geschäftsjahr"])).filter(Number.isFinite));
  console.log(`Primes ${annee} : ${primes.length} lignes`);

  // Régions de primes et assureurs admis (priminfo), avec repli sur l'année précédente si le fichier n'existe pas encore
  const wbRegions = XLSX.read(await telecharger(`https://www.priminfo.admin.ch/downloads/praemienregionen-${annee}.xlsx`));
  const communesBrutes = feuille(wbRegions, "A_COM").filter((r) => Number.isInteger(r[0]) && CANTONS.includes(r[1]));
  const tarifs = lireCsv((await telecharger(urlTarifs)).toString("utf8")).filter((t) => t.Kategorie === "MOD" && Number(t["Geschäftsjahr"]) === annee);

  // Liste des assureurs : l'onglet « Indice » donne le numéro et le nom
  let nomsAssureurs = {};
  const page = (await telecharger("https://www.priminfo.admin.ch/fr/downloads/aktuell")).toString("utf8");
  const lien = page.match(/downloads\/assureurs-maladie-admis-[0-9-]+\.xlsx/)?.[0];
  if (lien) {
    const wbAss = XLSX.read(await telecharger(`https://www.priminfo.admin.ch/${lien}`));
    for (const r of feuille(wbAss, wbAss.SheetNames.find((n) => /indice/i.test(n)) ?? wbAss.SheetNames[0])) {
      if (Number.isInteger(r[0]) && r[2]) nomsAssureurs[r[0]] = propre(r[2]);
    }
  }

  fs.mkdirSync(path.join(SORTIE, String(annee)), { recursive: true });
  for (const canton of CANTONS) {
    const lignes = primes.filter((p) => p.Kanton === canton && Number(p["Geschäftsjahr"]) === annee && p.Hoheitsgebiet === "P_OKPCH"
      && ["E1", "J1", "K1"].includes(p.Altersuntergruppe));
    const assureurs = {}, modeles = {}, tableau = {};
    for (const p of lignes) {
      const id = Number(p.Versicherer);
      assureurs[id] ??= nomsAssureurs[id] ?? `Assureur n° ${id}`;
      const cleModele = `${id}|${p.Tarif}`;
      if (!modeles[cleModele]) {
        const t = tarifs.find((x) => Number(x.Versicherer) === id && x.Tarif === p.Tarif);
        modeles[cleModele] = { nom: propre(t?.Name_FR || p.Tarifbezeichnung || "Assurance de base"), type: p.Tariftyp };
      }
      const age = { AKA_03_ERW: "adulte", AKA_02_JUG: "jeune", AKA_01_KIN: "enfant" }[p.Altersklasse];
      const cle = `${p.Region.replace("PR_REG_", "")}|${age}|${p.Unfalleinschluss === "MIT_UNF" ? "accident" : "sans"}`;
      const franchise = Number(p.Franchise.slice(-4));
      (tableau[cle] ??= []).push([id, p.Tarif, franchise, Math.round(Number(p["Prämie"]) * 100) / 100]);
    }
    const parCommune = new Map();
    for (const r of communesBrutes.filter((r) => r[1] === canton)) {
      const c = parCommune.get(r[0]) ?? { ofs: r[0], nom: propre(r[2]), region: Number(r[3]), npa: [] };
      if (Number.isInteger(r[5]) && !c.npa.includes(r[5])) c.npa.push(r[5]);
      parCommune.set(r[0], c);
    }
    const donnees = {
      annee, canton, genere: new Date().toISOString().slice(0, 10),
      source: "Office fédéral de la santé publique (OFSP) : primes approuvées de l'assurance obligatoire des soins, opendata.swiss et priminfo.admin.ch",
      assureurs, modeles, communes: [...parCommune.values()].sort((a, b) => a.nom.localeCompare(b.nom, "fr")), primes: tableau,
    };
    fs.writeFileSync(path.join(SORTIE, String(annee), `${canton}.json`), JSON.stringify(donnees));
    console.log(`${canton} : ${lignes.length} primes, ${Object.keys(assureurs).length} assureurs, ${parCommune.size} communes`);
    if (lignes.length < 500 || parCommune.size < 10) throw new Error(`Données ${canton} incomplètes`);
  }
  const annees = fs.readdirSync(SORTIE).filter((n) => /^\d{4}$/.test(n)).map(Number).sort();
  fs.writeFileSync(path.join(SORTIE, "index.json"), JSON.stringify({ derniere: Math.max(...annees), annees, cantons: CANTONS, misAJour: new Date().toISOString().slice(0, 10) }, null, 1));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
