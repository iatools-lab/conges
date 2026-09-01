# Synthese des mises a jour production

Date: 2026-08-28

## Vue globale conges RH

- Ajout d'un detail cliquable dans le calendrier RH: les cases jour/mois affichent maintenant toutes les personnes presentes dans la periode selectionnee.
- Correction du jeu de couleurs dans la planification annuelle: les mini-calendriers reprennent la couleur du statut reel.
- Correction du filtre periode: la vue globale RH filtre maintenant selon la date de debut du conge, et non selon le chevauchement ou la date de fin.
- Ajout de la date de soumission dans les lignes de planification remontees par l'API RH.

## Calendriers manager et employe

- Alignement des vues "Planification mensuelle" et "Planification annuelle" manager sur le comportement RH: clic sur un jour ou un mois occupe pour ouvrir le detail des collaborateurs concernes.
- Alignement de la vue calendrier employe: les cases occupees peuvent etre ouvertes pour afficher toutes les personnes presentes sur la periode.
- Harmonisation des couleurs des mini-calendriers manager/employe avec les statuts reels des planifications.
- Ajout des dates de soumission dans les lignes de planification remontees par les API manager/employe.

## Demandes et planifications manager

- Ajout de la colonne "Date de soumission" dans les onglets:
  - Demandes en attente d'action N+1
  - Conges planifies
  - Historique traite
- Ajout de la date de soumission dans le detail d'une demande manager.

## Demandes et planifications RH

- Ajout de la colonne "Date de soumission" dans les onglets:
  - En attente d'action N+1
  - En attente validation RH
  - Conges planifies
  - Historique traite
- Correction de l'import de l'historique valide: les libelles comme "valide", "approuve" ou "approved" sont acceptes comme demandes deja prises.
- Mise a jour du modele CSV d'import historique avec un exemple "valide".
- Lorsqu'une demande traitee est modifiee et que la periode change, le nombre de jours est recalcule automatiquement en jours ouvres.
- Protection ajoutee contre les periodes sans jour ouvre lors de la maintenance RH de l'historique.

## Formulaires employe

- Retrait du champ visible "Precision du conge" dans les formulaires de demande et de planification.
- Le champ backend reste compatible pour les anciennes donnees et integrations.
- Le justificatif reste optionnel pour tous les types de conges.

## Conges speciaux et evenements RH

- Les types d'evenements declares par les employes sont maintenant construits depuis les types de conges actifs, avec les options par defaut en secours.
- Le menu employe "Declarer un evenement" affiche les types speciaux disponibles avec une selection stable, meme lorsque plusieurs libelles correspondent au meme type technique.
- Les conges speciaux ne sont plus exposes dans les formulaires de demande/planification tant qu'aucun evenement RH approuve n'existe pour l'employe.
- Le backend impose qu'un conge special corresponde a un evenement RH approuve sur l'exercice concerne.
- La duree demandee pour un conge special doit correspondre exactement au droit configure ou au droit par defaut.
- Le sous-menu RH "Conges speciaux" liste uniquement les evenements declares a valider, et non les demandes de conges issues des formulaires.
- Ajout du referentiel detaille des permissions exceptionnelles payees:
  - Mariage du travailleur: 4 jours
  - Accouchement de l'epouse du travailleur: 3 jours
  - Bapteme d'un enfant du travailleur: 1 jour
  - Mariage d'un enfant du travailleur: 2 jours
  - Deces du conjoint du travailleur: 5 jours
  - Deces d'un enfant du travailleur: 3 jours
  - Deces du pere ou de la mere du travailleur: 5 jours
  - Deces du pere ou de la mere du conjoint legitime: 3 jours
  - Deces du frere ou de la soeur du travailleur: 3 jours
- Le formulaire employe "Declarer un evenement" affiche ces sous-types exacts et conserve le code du sous-type declare dans la description de l'evenement.
- Le tableau RH des evenements declares affiche le sous-type exact lorsqu'il a ete declare via ce nouveau referentiel.
- Apres validation RH, le formulaire de demande/planification n'ouvre que le ou les sous-types réellement autorises par les evenements valides.
- Le backend verifie que le sous-type demande correspond au sous-type de l'evenement valide et que la duree demandee ne depasse pas le plafond legal configure.
- Le menu employe "Declarer un evenement" dispose maintenant d'actions completes sur les declarations: consultation, modification et suppression.
- Les declarations deja validees ou en revue RH restent protegees contre la modification/suppression cote employe afin d'eviter de casser les droits deja accordes.
- Le recapitulatif des conges speciaux ne considere plus les lignes generiques "Conge special", "Conge maladie" ni l'ancien doublon "Accouchement de l'epouse".
- Le droit "Accouchement de l'epouse du travailleur" est conserve en compatibilite historique mais s'affiche et se consomme maintenant comme "Conge paternite".
- Le formulaire de declaration d'evenement et le formulaire RH de conges speciaux proposent uniquement la liste detaillee des permissions exceptionnelles payees.

## Interface et lisibilite

- Les acronymes techniques visibles dans le tableau de solde employe (CP, ENF, PASSIF, etc.) ont ete retires de l'affichage utilisateur.
- Les KPI situes en haut des menus "Permissions equipe" et "Permissions RH" ont ete retires; les acces rapides des dashboards manager/RH sont conserves.
- Le bouton d'import du menu RH "Demandes & Planification" est plus robuste: s'il n'y a pas encore de fichier charge, il ouvre directement le selecteur de fichier; apres previsualisation, il lance l'import.

## Emails

- Le template HTML global des emails a ete ameliore: en-tete visuel, contenu plus lisible, bloc de details, bouton d'action plus clair et pied de page explicite.
- Les emails conservent un fallback texte avec le lien direct vers la plateforme.

## Notifications de modification des soldes

- Toute correction RH du compteur "jours pris" declenche maintenant un email a l'employe concerne.
- Toute correction RH du solde total de conges declenche maintenant un email a l'employe concerne.
- Toute correction RH des jours planifies declenche maintenant un email a l'employe concerne.
- Les imports RH de soldes CP notifient par email les employes dont le solde est modifie.
- Les modifications manuelles et imports RH du passif notifient egalement les employes concernes.

## Profil employe et hierarchie

- La page profil recharge systematiquement les donnees RH a l'ouverture et au retour focus.
- Lorsqu'un N+1, N+2 ou N+3 est modifie cote RH, l'employe voit donc la chaine hierarchique a jour sans rester bloque sur une ancienne donnee de cache.

## Alignement du passif disponible

- Le calcul du passif affiche dans la vue RH, le dashboard employe, le dashboard manager et la planification manager utilise la meme source fonctionnelle: le solde restant du pool PASSIF.
- Cela evite les ecarts entre interfaces lorsque le passif initial, les jours pris ou les jours planifies evoluent.
- Les retours API d'import passif ont ete nettoyes pour ne plus exposer les champs internes utilises uniquement pour les emails.

## Synchronisation des jours pris avec les soldes

- La synchronisation des soldes utilise maintenant `LeaveRequest.days` comme source de verite pour les jours pris et planifies, afin d'aligner les soldes avec l'historique affiche aux RH, managers et employes.
- Cela corrige les ecarts crees lorsque des demandes importees ou corrigees manuellement avaient un nombre de jours different du recalcul automatique depuis la periode.
- Le pool des conges payes est maintenant reconcilie depuis toutes les demandes payees de l'employe sur l'exercice: les ecarts du type "historique a 6 jours pris mais solde RH a 1 jour" sont recalcules au niveau du total.
- Les demandes qui traversent deux exercices restent correctement decoupees: les jours stockes sont repartis proportionnellement selon les jours ouvres de chaque exercice concerne.
- Les chemins de recalcul des conges speciaux/evenements RH ont ete alignes sur la meme logique pour eviter un deuxieme ecart cache.
- Un garde-fou evite de remettre a zero un solde CP lorsqu'une synchronisation est declenchee par un autre type de conge sans aucune demande payee sur l'exercice.
- Apres deploiement, ouvrir les vues qui declenchent la resynchronisation annuelle realignera les soldes; pour une correction immediate de toute la production, lancer une resynchronisation annuelle globale apres sauvegarde.

## Nouveau module Permissions

- Ajout d'un modele `PermissionRequest` dedie aux permissions d'une journee.
- Ajout d'une migration Prisma: `20260828090000_add_permission_requests`.
- Ajout d'un menu "Permissions" dans les espaces employe, manager et RH.
- Un employe peut soumettre, modifier ou annuler une permission tant qu'elle reste dans un statut modifiable.
- Le quota est limite a 5 permissions par an et chaque permission vaut exactement 1 jour.
- Le backend empeche deux permissions actives sur la meme date pour le meme employe.
- Le flux de validation suit le parcours demande: employe -> N+1 -> RH.
- Le N+1 peut approuver ou refuser; un refus exige un commentaire.
- La RH peut approuver ou refuser apres validation N+1; un refus exige un commentaire.
- Des notifications applicatives et emails accompagnent la soumission, la validation N+1, le refus et la decision RH.

## Verifications

- Tests backend cibles: `npm test -- --runInBand employee/leave-requests/leave-requests.service.spec.ts rh/global-view/global-view.service.spec.ts rh/special-leaves/special-leaves.service.spec.ts employee/events/events.service.spec.ts employee/planning/planning.service.spec.ts`
- Build backend: `npm run build`
- Lint backend: `npm run lint`
- Build frontend: `npm run build`
- Lint frontend: `npm run lint`
- Tests backend manager/employe cibles: `npm test -- --runInBand manager/planning/planning.service.spec.ts employee/planning/planning.service.spec.ts manager/requests/requests.service.spec.ts`
- Tests frontend cibles: non disponibles actuellement dans `src`; la commande Vitest ciblee ne trouve aucun fichier de test correspondant.
- Tests backend permissions: `npm test -- --runInBand shared/permissions/permission-requests.service.spec.ts`
- Tests backend soldes/passif/dashboard: `npm test -- --runInBand rh/leave-balances/leave-balances.service.spec.ts rh/global-view/global-view.service.spec.ts employee/dashboard/dashboard.service.spec.ts manager/planning/planning.service.spec.ts manager/dashboard/dashboard.service.spec.ts`
- Verification patch: `git diff --check`
- Tests backend conges speciaux/evenements: `npm test -- --runInBand employee/leave-requests/leave-requests.service.spec.ts employee/events/events.service.spec.ts rh/special-leaves/special-leaves.service.spec.ts employee/balances/balances.service.spec.ts`
- Lint frontend apres corrections permissions/import/evenements: `npm run lint`
- Tests backend synchronisation soldes/historique: `npm test -- --runInBand shared/leave-balances/leave-balance-sync.service.spec.ts employee/events/events.service.spec.ts rh/special-leaves/special-leaves.service.spec.ts`
