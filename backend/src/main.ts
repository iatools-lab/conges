import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { configureApp } from './app.setup';
import { AppModule } from './app.module';

const RESOURCE_NAMES: Record<string, string> = {
  alerts: 'les alertes',
  audit: "le journal d'audit",
  balances: 'les soldes de congés',
  calendar: 'le calendrier',
  children: 'les enfants à charge',
  conflicts: 'les conflits',
  dashboard: 'le tableau de bord',
  departments: 'les services',
  events: 'les événements',
  employees: 'les employés',
  exports: 'les exports',
  'global-view': 'la vue RH globale',
  history: "l'historique",
  holidays: 'les jours fériés',
  hierarchy: 'la hiérarchie',
  analytics: 'les indicateurs RH',
  'leave-balances': 'les soldes de congés',
  'leave-liabilities': 'les provisions de congés',
  'leave-requests': 'les demandes de congé',
  'leave-types': 'les types de congé',
  notifications: 'les notifications',
  overtime: 'les heures supplémentaires',
  permissions: 'les demandes d’autorisation',
  planning: 'le planning',
  profile: 'le profil',
  requests: 'les demandes',
  roles: 'les rôles',
  settings: 'les paramètres',
  'special-leaves': 'les congés spéciaux',
  users: 'les utilisateurs',
  workflows: 'les circuits de validation',
};

const ACTION_SUMMARIES: Record<string, string> = {
  cancel: 'Annuler',
  cancelProcessedRequest: 'Annuler',
  create: 'Créer',
  createDefaultLeaveTypes: 'Initialiser',
  decide: 'Statuer sur',
  decideRequest: 'Statuer sur',
  deactivate: 'Désactiver',
  deleteLeaveType: 'Supprimer',
  findDepartments: 'Lister',
  findUsers: 'Lister',
  findBalances: 'Consulter',
  findAll: 'Lister',
  findMany: 'Rechercher',
  findOne: 'Consulter',
  findSummary: 'Consulter',
  generate: 'Générer',
  importEmployees: 'Importer',
  importHistory: 'Importer',
  importPaidBalances: 'Importer',
  importRows: 'Importer',
  initializeBalances: 'Initialiser',
  markAllRead: 'Marquer comme lues',
  markRead: 'Marquer comme lue',
  profile: 'Consulter',
  review: 'Examiner',
  remove: 'Supprimer',
  submit: 'Soumettre',
  updateDepartment: 'Modifier',
  updateLeaveType: 'Modifier',
  updateRule: 'Modifier',
  updateStatus: 'Modifier',
  update: 'Modifier',
};

const SPECIFIC_SUMMARIES: Record<string, string> = {
  forgotPassword: 'Demander la réinitialisation du mot de passe',
  getHealth: "Vérifier l'état de santé de l'API",
  googleLogin: 'Se connecter avec un compte Google',
  importHistory: "Importer l'historique des demandes de congé",
  login: 'Se connecter avec une adresse e-mail et un mot de passe',
  resetPassword: 'Réinitialiser le mot de passe avec un code',
  signup: 'Créer un compte utilisateur',
  verifyOtp: 'Vérifier le code de récupération à usage unique',
};

function getSwaggerTag(path: string) {
  if (path.includes('/admin/')) return 'Administration';
  if (path.includes('/rh/')) return 'Ressources humaines';
  if (path.includes('/manager/')) return 'Management';
  if (path.includes('/employee/')) return 'Espace collaborateur';
  if (path.includes('/notifications')) return 'Notifications';
  if (path.includes('/auth/')) return 'Authentification';
  return 'Système';
}

function documentOperations(
  document: ReturnType<typeof SwaggerModule.createDocument>,
) {
  for (const [path, pathItem] of Object.entries(document.paths)) {
    const resource = path
      .split('/')
      .reverse()
      .find((part) => RESOURCE_NAMES[part]);
    const operationResource = resource
      ? RESOURCE_NAMES[resource]
      : 'cette ressource';

    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = pathItem[method];
      if (!operation) continue;

      operation.tags = [getSwaggerTag(path)];
      const methodName = operation.operationId?.split('_').at(-1) ?? method;
      const action = ACTION_SUMMARIES[methodName];
      if (!operation.summary) {
        operation.summary =
          SPECIFIC_SUMMARIES[methodName] ??
          (action
            ? `${action} ${operationResource}`
            : `${method === 'get' ? 'Consulter' : method === 'post' ? 'Créer ou lancer' : method === 'delete' ? 'Supprimer' : 'Mettre à jour'} ${operationResource}`);
      }

      const publicAuthRoute =
        path.startsWith('/api/v1/auth/') && !path.endsWith('/profile');
      if (publicAuthRoute || path.endsWith('/healthz')) {
        operation.security = [];
      }
    }
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  configureApp(app, configService);

  const shouldExposeSwagger =
    process.env.NODE_ENV !== 'production' ||
    configService.get<string>('ENABLE_SWAGGER')?.trim().toLowerCase() ===
      'true';

  if (shouldExposeSwagger) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('API Congés upOwa')
      .setDescription(
        [
          "Référence de l'API de gestion des congés. Toutes les routes métier utilisent le préfixe `/api/v1`.",
          '',
          '**Authentification** : les routes protégées attendent un jeton de session dans `Authorization: Bearer <jeton>`. Utilisez le bouton **Authorize** pour le fournir. Les routes de connexion, de récupération de mot de passe et de santé sont publiques.',
          '',
          '**Rôles** : Administration = admin ; Ressources humaines = RH ou admin ; Management = manager ou admin ; Espace collaborateur = tout utilisateur connecté. Les autorisations sont vérifiées par le serveur, même si Swagger permet de préparer une requête.',
          '',
          '**Validation** : les corps inconnus sont refusés. Les champs, formats et contraintes des DTO sont exposés dans les schémas de requête. Les dates sont des chaînes ISO 8601.',
        ].join('\n'),
      )
      .setVersion('1.0')
      .addTag(
        'Authentification',
        'Inscription, connexion et gestion de session.',
      )
      .addTag('Administration', 'Routes réservées au rôle admin.')
      .addTag('Ressources humaines', 'Routes réservées aux rôles RH et admin.')
      .addTag('Management', 'Routes réservées aux rôles manager et admin.')
      .addTag(
        'Espace collaborateur',
        'Routes accessibles à tout utilisateur connecté.',
      )
      .addTag('Notifications', 'Notifications du compte connecté.')
      .addTag('Système', 'Santé et informations générales de l’API.')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Jeton de session renvoyé par une route de connexion.',
        },
        'session-bearer',
      )
      .addSecurityRequirements('session-bearer')
      .build();

    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    documentOperations(swaggerDocument);
    SwaggerModule.setup('docs', app, swaggerDocument);
  }

  await app.listen(configService.get<number>('PORT') ?? 3000);
}
void bootstrap();
