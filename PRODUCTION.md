# Mise en production

Guide recommande pour deploiement pas a pas:
- `GUIDE_DEPLOIEMENT.md`

Fichier central de parametres administrateur:
- `DEPLOYMENT_PARAMETERS.env.example`

Le principe est simple:
1. Copier `DEPLOYMENT_PARAMETERS.env.example` vers `.env`.
2. Renseigner les valeurs humaines (domaine, IP serveur, secrets, SMTP, etc.).
3. Lancer `bash docker/deploy.sh`.

## Variables backend obligatoires

```env
NODE_ENV=production
DATABASE_URL="postgresql://..."
PORT=3000
CORS_ORIGINS="https://app.example.com"
FRONTEND_URL="https://app.example.com"
AUTH_SESSION_SECRET="generer-une-valeur-aleatoire-de-32-caracteres-minimum"
AUTH_SESSION_TTL_HOURS=12
AUTH_ADMIN_PASSWORD_HASH="hash-du-mot-de-passe-admin"
GOOGLE_CLIENT_ID="449904699288-upv55q520qi2tc3gbg6vh4ouf1lp31md.apps.googleusercontent.com"
ENABLE_SWAGGER=false
EMAIL_MODE="prod"
MAIL_HOST="smtp-relay.gmail.com"
MAIL_PORT=465
MAIL_USER="conges@upowa.org"
MAIL_PASS="" # optionnel en SMTP relay sans auth
MAIL_FROM="Conges <conges@upowa.org>"
RH_AUTO_REJECT_DAYS=7
```

En production, l'API refuse de demarrer sans `CORS_ORIGINS`, `AUTH_SESSION_SECRET` et `AUTH_ADMIN_PASSWORD_HASH`. La connexion Google exige aussi `GOOGLE_CLIENT_ID`. Swagger est desactive par defaut.

### Activer Swagger avec Docker

Sur le serveur, modifiez le fichier `.env` (jamais le fichier compose) :

```env
ENABLE_SWAGGER=true
```

Reconstruisez et recréez le backend et Nginx pour appliquer la variable et la nouvelle configuration du proxy :

```bash
docker compose up -d --build backend nginx
docker compose ps
```

Ouvrez ensuite `https://<votre-domaine>:<NGINX_HTTPS_PORT>/docs` (port Docker par défaut : `8443`) ou `http://<votre-domaine>:<NGINX_HTTP_PORT>/docs` (port par défaut : `8080`, si HTTPS n'est pas activé). Si un reverse proxy de l'hôte publie déjà les ports standards 80/443 vers ces ports Docker, utilisez simplement `https://<votre-domaine>/docs`. L'interface utilise l'API `/api/v1`; pour tester les routes protégées, cliquez sur **Authorize** et collez le jeton de session obtenu via une route de connexion. Le JSON OpenAPI est disponible à `/docs-json` sur le même port.

Swagger est public lorsqu'il est activé : le jeton protège les routes métier, pas l'interface de documentation. N'activez le flag que si cette exposition est acceptable. Pour un accès réservé à l'équipe, limitez `/docs`, `/docs/` et `/docs-json` par une règle IP ou une authentification au niveau du reverse proxy. Pour le désactiver, remettez `ENABLE_SWAGGER=false` puis recréez le backend et Nginx.

Pour generer `AUTH_ADMIN_PASSWORD_HASH`:

```bash
node -e 'const {randomBytes,scryptSync}=require("crypto"); const p=process.argv[1]; const s=randomBytes(16).toString("hex"); console.log(`${s}:${scryptSync(p,s,64).toString("hex")}`)' "mot-de-passe-admin"
```

## Variables frontend obligatoires

```env
VITE_API_URL="https://api.example.com/api/v1"
VITE_GOOGLE_CLIENT_ID="449904699288-upv55q520qi2tc3gbg6vh4ouf1lp31md.apps.googleusercontent.com"
```

## Checklist avant de basculer

1. Sauvegarder la base de donnees de production.
2. Tester les migrations Prisma sur une copie de la base.
3. Generer un `AUTH_SESSION_SECRET` unique et non partage.
4. Generer `AUTH_ADMIN_PASSWORD_HASH` depuis un mot de passe admin fort.
5. Verifier `GOOGLE_CLIENT_ID` cote backend et `VITE_GOOGLE_CLIENT_ID` cote frontend.
6. Verifier `CORS_ORIGINS` et `FRONTEND_URL` avec le domaine frontend exact.
7. Tester un envoi email reel en `EMAIL_MODE=prod`.
8. Lancer `npm run test` et `npm run build` dans `backend` et `frontend`.
9. Effectuer un smoke test: login, demande employe, validation N+1, decision RH, planification, declaration evenement, import employes.
10. Conserver une procedure de rollback et le dernier backup valide.
