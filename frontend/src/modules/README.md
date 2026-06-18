# Organisation modulaire frontend

Les fichiers de page vivent dans `src/modules`, organises par groupe d'utilisateur et sous-module metier.

Le dossier technique `src/modules/routing` contient uniquement les declarations TanStack Router (`createFileRoute`) qui importent les pages depuis les modules metier. Le dossier historique `src/routes` n'est plus utilise.

- `employee`: espace employe, soldes, demandes, planification, evenements et historique.
- `manager`: pilotage equipe, validations, conflits, calendrier et planning.
- `rh`: tableaux RH, personnel, enfants, conges speciaux, passif, exports, audit et parametres.
- `admin`: utilisateurs, roles, departements, workflows, jours feries, parametres et logs.
- `auth`: pages publiques et connexion.
- `shared`: referentiels et fonctions transverses.

Chaque sous-module peut recevoir ses composants, hooks, schemas, services API et types propres.
