# Meme Monitor

[English](README.md) | [Français](README.fr.md) | [Português](README.pt.md)

Meme Monitor est un service Node.js accompagné de tableaux de bord web. Il surveille les paires de jetons Solana récemment publiées sur DexScreener, évalue l'activité du marché et diffuse les signaux aux clients connectés en temps réel.

> Ce projet fournit des indicateurs de marché automatisés à des fins de recherche. Il ne constitue pas un conseil financier.

## Fonctionnalités

- Interroge toutes les 10 secondes les profils et les paires Solana récents sur DexScreener.
- Évalue les paires selon la liquidité, l'âge, le volume sur 24 heures, l'activité d'achat et de vente, la FDV ainsi que la croissance à court terme de la liquidité et du prix.
- Publie les derniers signaux par l'intermédiaire d'une API JSON et de Server-Sent Events (SSE).
- Inclut des tableaux de bord avec des filtres de score, d'âge, de mot-clé et d'alerte.
- Propose des vues sur 10, 15, 30 et 60 minutes.
- Conserve l'état de déduplication des signaux à score élevé dans `seen_pairs.json`.

## Prérequis

- Node.js 18.x
- npm
- Un accès Internet à l'API DexScreener

## Démarrage rapide

```bash
npm ci
npm start
```

Ouvrez [http://localhost:3000](http://localhost:3000) dans un navigateur.

## Configuration

Créez un fichier `.env` à la racine du projet si vous devez remplacer les valeurs par défaut :

```dotenv
PORT=3000
HELIUS_API_KEY=votre_cle_helius_facultative
```

| Variable | Obligatoire | Description |
| --- | --- | --- |
| `PORT` | Non | Port HTTP. La valeur par défaut est `3000`. |
| `HELIUS_API_KEY` | Non | Réservée à l'intégration Helius. Le serveur actuel vérifie uniquement si elle est présente. |

Les seuils de score, la fréquence d'interrogation et les paramètres de déduplication se trouvent dans `monitor.js`. L'origine web autorisée en production est définie par `ALLOWED_ORIGIN` dans `server.js` ; modifiez-la si le tableau de bord est déployé sous un autre domaine.

## Tableaux de bord

| Route | Description |
| --- | --- |
| `/?view=10m` | Tableau de bord par défaut sur 10 minutes |
| `/?view=15m` | Tableau de bord V2 sur 15 minutes |
| `/?view=30m` | Tableau de bord V2 sur 30 minutes |
| `/?view=60m` | Tableau de bord V2 sur 60 minutes |
| `/?view=v2` | Laboratoire V2 étendu sur 120 minutes |

Toutes les vues utilisent un seul tableau de bord partagé ; le changement de fenêtre conserve donc la connexion SSE. Les anciennes routes HTML restent valides et redirigent vers la vue correspondante. Les filtres, le tri, le mode compact et les préférences sonores sont enregistrés sur l'appareil actuel.

## API

| Point d'accès | Description |
| --- | --- |
| `GET /ping` | Contrôle d'état ; renvoie `pong`. |
| `GET /api/signals` | Renvoie jusqu'à 200 signaux récents conservés en mémoire. |
| `GET /events` | Ouvre le flux SSE des signaux en direct. |

Un signal contient les adresses du jeton et de la paire, leurs symboles, la liquidité, la FDV, le volume, le prix, l'âge, le score, les motifs du score, l'horodatage et l'URL DexScreener lorsqu'ils sont disponibles.

## Aperçu du calcul du score

Le score du serveur dans `monitor.js` prend en compte :

- La liquidité en dollars américains
- L'âge de la paire
- Le volume d'échange sur 24 heures
- La pression acheteuse et vendeuse sur cinq minutes
- La valorisation entièrement diluée (FDV)
- La croissance de la liquidité sur une et trois minutes
- La croissance du prix sur une et trois minutes

Les tableaux de bord V2 appliquent un score supplémentaire côté client pour l'affichage et le filtrage. Tous les scores reposent sur des heuristiques et peuvent être affectés par des données tierces manquantes, retardées ou inexactes.

## Structure du projet

| Chemin | Rôle |
| --- | --- |
| `server.js` | Serveur Express, hébergement des tableaux de bord, API REST et flux SSE |
| `monitor.js` | Interrogation active de DexScreener et logique de score du serveur |
| `index.js` | Ancien outil autonome de calcul du score qui écrit dans `signals.csv` |
| `public/index.html` | Document partagé du tableau de bord et contrôles |
| `public/dashboard-app.js` | Flux en direct, filtres, tri, préférences et rendu DOM sécurisé |
| `public/dashboard-logic.js` | Formatage, validation des URL, analyse des motifs et score V2 |
| `public/dashboard-shell.js` | Mise en page, navigation, état de connexion et changement de vue |
| `public/dashboard.css` | Système visuel partagé et styles adaptatifs |
| `test/dashboard.test.js` | Tests Node.js pour le score, la sécurité des URL et les anciennes routes |
| `seen_pairs.json` | État persistant de déduplication des signaux à score élevé |
| `signals.csv` | Sortie CSV utilisée par l'outil autonome |

Pour exécuter l'outil CSV autonome à la place du service web :

```bash
node index.js
```

## Notes d'exploitation

- Les signaux récents de l'API sont conservés en mémoire et disparaissent au redémarrage du serveur.
- La déduplication des signaux à score élevé est conservée entre les redémarrages grâce à `seen_pairs.json`.
- Le service dépend du format des réponses et de la disponibilité de DexScreener.
- CORS autorise actuellement le domaine GitHub Pages configuré et le développement local sur le port `3000`.

## Licence

ISC
