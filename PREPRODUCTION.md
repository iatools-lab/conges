# Validation de préproduction

Le script `docker/preproduction-check.sh` contrôle une stack Docker déjà démarrée. Il vérifie :

- les healthchecks et les endpoints de supervision ;
- une sauvegarde PostgreSQL puis sa restauration dans une base temporaire ;
- la connexion SMTP et, si demandé, la livraison d'un message ;
- TLS 1.2+ ainsi que HSTS et la politique CSP ;
- une charge légère sur l'endpoint backend.

Exécution locale HTTP :

```bash
bash docker/preproduction-check.sh
```

Exécution sur le domaine de préproduction avec test de livraison SMTP :

```bash
PREPROD_BASE_URL=https://preprod.example.com \
PREPROD_SMTP_RECIPIENT=qa@example.com \
PREPROD_LOAD_REQUESTS=500 \
PREPROD_LOAD_CONCURRENCY=25 \
bash docker/preproduction-check.sh
```

La restauration utilise une base temporaire `conges_restore_check_*`, supprimée automatiquement. Ne jamais pointer la stack de préproduction vers la base de production pendant ce contrôle.
