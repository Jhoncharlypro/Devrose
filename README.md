# 🌹 DevRose Academy

> Plateforme d'apprentissage en ligne moderne avec cours en direct, simulateur de code, chat communautaire et assistant IA — disponible en **Kreyòl Ayisyen**, **Français**, **English**, et **Español**.

Le nom du dépôt GitHub et du projet est **Devrose** (nom commercial complet : **DevRose Academy**).

---

## ✨ Fonctionnalités principales

- 🎓 **Catalogue de cours** avec recherche, favoris, et inscription multi-étapes (wizard)
- 🟢 **Classes en direct** (Google Meet) avec planning, mentoring 1-on-1, coaching carrière
- 💻 **Simulateur Linux intégré** (DevRose Pro Linux Shell — Debian 12 Bookworm) pour exécuter Python / HTML / Bash dans le navigateur
- 💬 **Chat communautaire temps réel** (Kot3 Chat — WebSockets via Django Channels) avec stories / status style Messenger / WhatsApp
- 🤖 **Assistant IA** (Google Gemini) pour répondre aux questions des apprenants
- 🎨 **8 thèmes visuels** (Dark, Messenger Light/Dark, Rose, Sunset, Forest, Ocean, Dusk) avec persistance localStorage
- 🌐 **Multilingue** — switching instantané HT / EN / ES / FR
- 📊 **Suivi de progression** personnel par cours
- 💳 **Paiement local Haïti** via MonCash / Natcash (inscription WhatsApp)
- 🔐 **Authentification JWT** + profils + récupération mot de passe

---

## 🏗️ Architecture du projet

C'est un **monorepo** avec deux sous-projets:

```
Devrose/                      ← racine du dépôt
├── src/                      ← Frontend React (Vite)
│   ├── components/           ← Tous les composants UI (Header, Chat, Classroom, etc.)
│   ├── data/translations.js  ← 4 langues (HT, EN, ES, FR)
│   ├── services/api.js       ← Client API pour le backend Django
│   ├── styles/               ← CSS (index.css + kot3chat.css)
│   ├── App.jsx               ← Application principale (routing + state)
│   └── main.jsx              ← Bootstrap React
├── backend/                  ← Backend Django REST + Channels
│   ├── devrose_backend/      ← Projet Django (settings, urls, asgi, wsgi)
│   ├── api/                  ← App principale
│   │   ├── models/           ← User, Profile, Course, Session, Enrollment, LiveRoom, Chat...
│   │   ├── serializers/      ← DRF serializers
│   │   ├── views/            ← ViewSets et endpoints
│   │   ├── consumers.py      ← WebSocket consumers (chat temps réel)
│   │   ├── routing.py        ← WebSocket URL routing
│   │   └── migrations/       ← Historique schéma DB
│   ├── db.sqlite3            ← (gitignored) Base SQLite dev
│   └── manage.py
├── package.json              ← Frontend deps (React 18, Vite 5, Axios, Gemini AI)
├── vite.config.js
├── index.html
└── run_vite.sh               ← Script helper pour lancer Vite
```

### 🧰 Stack technique

**Frontend:**
- React 18 + Vite 5
- React Router DOM 6
- Axios (HTTP client)
- @google/generative-ai (assistant IA)
- CSS pur (variables CSS, responsive, animations)

**Backend:**
- Django 5 + Django REST Framework
- Django Channels (WebSockets pour chat live)
- SimpleJWT (authentification)
- SQLite (dev) — facilement remplaçable par PostgreSQL en prod
- Channels Redis layer (recommandé pour prod, en mémoire pour dev)

---

## 🚀 Démarrage rapide

### Pré-requis
- **Node.js** ≥ 18
- **Python** ≥ 3.10
- **pip**

### 1. Frontend (Vite + React)

```bash
npm install
npm run dev      # serveur dev sur http://localhost:5173
npm run build    # build prod dans dist/
```

### 2. Backend (Django)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser   # optionnel — accès admin
python manage.py runserver         # API sur http://localhost:8000
```

### 3. Variables d'environnement

Copier `.env.example` (si présent) vers `.env` à la racine ET dans `backend/`.

Variables clés côté backend:
- `SECRET_KEY` — clé secrète Django
- `DEBUG` — `True` en dev, `False` en prod
- `ALLOWED_HOSTS` — domaines autorisés (CSV)
- `DATABASE_URL` — optionnel si vous utilisez Postgres

Variables clés côté frontend:
- `VITE_API_BASE_URL` — URL de l'API Django (ex: `http://localhost:8000/api`)
- `VITE_GEMINI_API_KEY` — clé Google Gemini pour le chatbot IA

> ⚠️ **Important:** ne jamais commit `.env`, `db.sqlite3`, ni les clés secrètes. Tout est déjà exclu via `.gitignore`.

---

## 🌍 Multilingue

Les traductions vivent dans `src/data/translations.js` avec quatre dictionnaires (`trans_ht`, `trans_en`, `trans_es`, `trans_fr`). Pour ajouter une clé:

```js
// dans trans_en, trans_fr, trans_ht, trans_es
'ma_cle': 'My translation',
```

---

## 🎨 Thèmes

Huit thèmes sont disponibles via le panneau Paramètres:

| Thème | Description |
|---|---|
| Sombre (DevRose) | Dark mode par défaut |
| Messenger Light | Style Messenger / WhatsApp clair |
| Messenger Dark | Style Messenger / WhatsApp sombre |
| Rose | Couleur signature de l'académie |
| Sunset | Tons oranges / violets |
| Forest | Tons verts naturels |
| Ocean | Tons bleus profonds |
| Dusk | Crépuscule violet / rose |

---

## 🔥 WebSockets (Chat temps réel)

Les channels Django montent le chat Kot3 (Messenger-like). Pour activer la couche Redis en prod:

```bash
pip install channels-redis
# dans settings.py: CHANNEL_LAYERS = { "default": { "BACKEND": "channels_redis.core.RedisChannelLayer", "CONFIG": {"hosts": [("redis://...")]}}}
```

Pour le développement, la couche **InMemoryChannelLayer** est utilisée par défaut — aucune config supplémentaire nécessaire.

---

## 📦 Endpoints API (sélection)

| Méthode | URL | Description |
|---|---|---|
| POST | `/api/auth/login/` | Connexion JWT |
| POST | `/api/auth/signup/` | Inscription |
| GET | `/api/courses/` | Liste des cours |
| POST | `/api/favorites/` | Ajouter aux favoris |
| GET | `/api/sessions/me/` | Session utilisateur en cours |
| POST | `/api/progress/` | Marquer la progression |
| GET | `/api/liverooms/` | Liste des salles live |
| WS | `/ws/chat/<room>/` | WebSocket chat |

(Voir `backend/api/urls.py` pour la liste exhaustive.)

---

## 🛣️ Feuille de route suggérée

- [ ] Migration full PostgreSQL + Redis en production
- [ ] Paiement Stripe + MonCash API officielle
- [ ] Application mobile (React Native ou PWA offline-first)
- [ ] Système de quizzes interactifs dans le simulateur
- [ ] Marketplace entre étudiants et mentors

---

## 🤝 Contribution

Les contributions sont les bienvenues. Pour proposer un changement:

1. Forkez le dépôt
2. Créez une branche (`git checkout -b feature/ma-fonctionnalite`)
3. Committez (`git commit -m 'feat: ajoute ma fonctionnalité'`)
4. Pushez (`git push origin feature/ma-fonctionnalite`)
5. Ouvrez une Pull Request

**Important:** lisez `src/data/translations.js` → `rules_text` — les règles du protocole système (analyse stricte avant toute modification).

---

## 📄 Licence

© 2026 DevRose Academy. Tous droits réservés.

---

<p align="center">
  <strong>Bati lavni w ete sa a!</strong><br/>
  <em>Build your future this summer.</em>
</p>
