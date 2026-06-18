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

En production, l'API refuse de demarrer sans `CORS_ORIGINS`, `AUTH_SESSION_SECRET` et `AUTH_ADMIN_PASSWORD_HASH`. La connexion Google exige aussi `GOOGLE_CLIENT_ID`. Swagger est desactive par defaut; mettez `ENABLE_SWAGGER=true` uniquement si l'exposition de `/docs` est voulue.

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
