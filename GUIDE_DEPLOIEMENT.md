# Guide de deploiement - upOwa Conges (100% Docker)

Ce guide est fait pour une personne non informaticienne.

Objectif:
- tout executer avec Docker
- ne rien installer comme Nginx systeme
- eviter les conflits de ports existants
- pouvoir changer facilement domaine et serveur

## 1) Ce qui est dockerise

Le projet lance 4 services Docker:
- postgres: base de donnees
- backend: API NestJS
- nginx: frontend + reverse proxy API
- certbot: generation/renouvellement du certificat HTTPS

## 2) Si Docker est absent (obligatoire avant tout)

### 2.1 Verifier si Docker existe deja

```bash
docker --version
docker compose version
```

Si ces commandes repondent, passez a la section 3.

### 2.2 Installer Docker sur Ubuntu/Debian

Copier-coller ces commandes:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

Verification finale:

```bash
docker --version
docker compose version
```

## 3) Fichier unique a remplir (important)

Le fichier central est:
- DEPLOYMENT_PARAMETERS.env.example

Copiez-le vers .env:

```bash
cp DEPLOYMENT_PARAMETERS.env.example .env
```

Puis ouvrez .env et remplissez les valeurs CHANGE_ME_*.

## 4) Parametres minimum a renseigner dans .env

Remplir obligatoirement:
- DOMAIN_NAME
- SERVER_IP
- POSTGRES_PASSWORD
- AUTH_SESSION_SECRET
- AUTH_GOOGLE_ONLY=true pour imposer Google et désactiver tous les mots de passe
- GOOGLE_CLIENT_ID

Pour l'email:
- SMTP relay sans authentification: laisser MAIL_USER et MAIL_PASS vides
- SMTP avec authentification: renseigner MAIL_USER et MAIL_PASS

## 5) Eviter les conflits de ports

Par defaut, le projet utilise:
- NGINX_HTTP_PORT=8080
- NGINX_HTTPS_PORT=8443

Ces ports evitent generalement les conflits avec des services existants.

Si conflit, changez dans .env:
- NGINX_HTTP_PORT=18080
- NGINX_HTTPS_PORT=18443

Puis relancez le deploiement.

## 6) HTTPS Docker (optionnel)

Si vous voulez HTTPS gere par certbot Docker:
- ENABLE_HTTPS=true
- NGINX_BIND_ADDRESS=0.0.0.0
- NGINX_HTTP_PORT=80
- NGINX_HTTPS_PORT=443

Attention:
- le DNS du domaine doit pointer vers ce serveur
- le port 80 doit etre ouvert publiquement

Si ces conditions ne sont pas remplies, laissez ENABLE_HTTPS=false.

## 7) Deploiement (commande unique)

Depuis la racine du projet:

```bash
bash docker/deploy.sh
```

Le script fait automatiquement:
- verification des variables
- build backend et frontend
- demarrage postgres
- creation/verif base de donnees
- demarrage backend + nginx
- certificat HTTPS via certbot Docker si ENABLE_HTTPS=true

## 8) Verification apres deploiement

### 8.1 Etat des conteneurs

```bash
docker compose ps
```

Vous devez voir postgres, backend, nginx en etat Up.

### 8.2 Test local de sante

```bash
curl http://127.0.0.1:${NGINX_HTTP_PORT:-8080}/healthz
```

Resultat attendu:

```text
ok
```

### 8.3 Test dans navigateur

- en HTTP: http://VOTRE_SERVEUR:PORT_HTTP
- en HTTPS (si active): https://VOTRE_DOMAINE

## 9) Configuration Google OAuth (connexion Google)

Dans Google Cloud Console, ouvrir le client OAuth Web.

Ajouter dans Authorized JavaScript origins la vraie origine frontend.

Exemples:
- https://votre-domaine.com
- http://votre-ip:8080

Important: origine exacte (schema + host + port).

## 10) Mise a jour de l'application

```bash
bash update.sh
```

## 11) Renouveler le certificat HTTPS Docker

```bash
bash docker/renew-cert.sh
```

Ce script agit seulement si ENABLE_HTTPS=true.

## 12) Sauvegarde base de donnees

```bash
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup.sql
```

## 13) Probleme frequent: le site ne repond pas

1. Voir les conteneurs:

```bash
docker compose ps
```

2. Voir les logs:

```bash
docker compose logs --tail=200 nginx
docker compose logs --tail=200 backend
docker compose logs --tail=200 postgres
```

3. Si conflit de port, changer NGINX_HTTP_PORT / NGINX_HTTPS_PORT dans .env puis relancer deploy.sh.

## 14) Resume ultra-court

1. Installer Docker (si absent)
2. Copier DEPLOYMENT_PARAMETERS.env.example vers .env
3. Remplir toutes les valeurs CHANGE_ME_*
4. Lancer bash docker/deploy.sh
5. Verifier docker compose ps
