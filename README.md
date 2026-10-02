# lupetti-data

Données publiques de l'appli **Lupetti** (sorties en famille en Suisse romande).

- `events.json` : sélection d'événements familiaux (trocs, bourses aux jouets, fêtes, marchés de Noël, spectacles jeune public…).
  Chaque événement renvoie à la page de l'organisateur où la date a été vérifiée.
  L'appli télécharge ce fichier à l'ouverture ; sans connexion, elle garde la dernière version reçue.
- Mise à jour : chaque semaine (ajout des nouveaux événements, retrait des annulés).

Format : `{ "schemaVersion": 1, "checkedAt": "AAAA-MM-JJ", "events": [ … ] }`.
Les dates passées sont ignorées automatiquement par l'appli.
