import { EventType, LeaveCategory, Prisma, Sexe } from '@prisma/client';

export type ExceptionalPermissionCode =
  | 'MAR_TRAV'
  | 'PAT'
  | 'BAP_ENF'
  | 'MAR_ENF'
  | 'DEC_CONJ'
  | 'DEC_ENF'
  | 'DEC_PARENT'
  | 'DEC_PARENT_CONJ'
  | 'DEC_FRERE_SOEUR';

export type ExceptionalPermissionRule = {
  code: ExceptionalPermissionCode;
  name: string;
  eventType: EventType;
  defaultDays: number;
  category: LeaveCategory;
  color: string;
  description: string;
  sex?: Sexe;
  aliases?: string[];
};

const EXCEPTIONAL_PERMISSION_RULE_DEFINITIONS: readonly ExceptionalPermissionRule[] =
  [
    {
      code: 'MAR_TRAV',
      name: 'Mariage du travailleur',
      eventType: EventType.MARRIAGE,
      defaultDays: 4,
      category: LeaveCategory.CONGE_SPECIAL,
      color: '#EA580C',
      description: 'Permission exceptionnelle payee: mariage du travailleur.',
    },
    {
      code: 'PAT',
      name: 'Conge paternite',
      eventType: EventType.BIRTH,
      defaultDays: 3,
      category: LeaveCategory.CONGE_PATERNITE,
      color: '#7C3AED',
      description: 'Permission exceptionnelle payee: conge paternite.',
      sex: Sexe.M,
      aliases: ['ACC_EPOUSE', "Accouchement de l'epouse du travailleur"],
    },
    {
      code: 'BAP_ENF',
      name: "Bapteme d'un enfant du travailleur",
      eventType: EventType.OTHER,
      defaultDays: 1,
      category: LeaveCategory.CONGE_SPECIAL,
      color: '#0EA5E9',
      description:
        "Permission exceptionnelle payee: bapteme d'un enfant du travailleur.",
    },
    {
      code: 'MAR_ENF',
      name: "Mariage d'un enfant du travailleur",
      eventType: EventType.MARRIAGE,
      defaultDays: 2,
      category: LeaveCategory.CONGE_SPECIAL,
      color: '#F59E0B',
      description:
        "Permission exceptionnelle payee: mariage d'un enfant du travailleur.",
    },
    {
      code: 'DEC_CONJ',
      name: 'Deces du conjoint du travailleur',
      eventType: EventType.DEATH,
      defaultDays: 5,
      category: LeaveCategory.CONGE_SPECIAL,
      color: '#475569',
      description:
        'Permission exceptionnelle payee: deces du conjoint du travailleur.',
    },
    {
      code: 'DEC_ENF',
      name: "Deces d'un enfant du travailleur",
      eventType: EventType.DEATH,
      defaultDays: 3,
      category: LeaveCategory.CONGE_SPECIAL,
      color: '#334155',
      description:
        "Permission exceptionnelle payee: deces d'un enfant du travailleur.",
    },
    {
      code: 'DEC_PARENT',
      name: 'Deces du pere ou de la mere du travailleur',
      eventType: EventType.DEATH,
      defaultDays: 5,
      category: LeaveCategory.CONGE_SPECIAL,
      color: '#1F2937',
      description:
        'Permission exceptionnelle payee: deces du pere ou de la mere du travailleur.',
    },
    {
      code: 'DEC_PARENT_CONJ',
      name: 'Deces du pere ou de la mere du conjoint legitime',
      eventType: EventType.DEATH,
      defaultDays: 3,
      category: LeaveCategory.CONGE_SPECIAL,
      color: '#4B5563',
      description:
        'Permission exceptionnelle payee: deces du pere ou de la mere du conjoint legitime.',
    },
    {
      code: 'DEC_FRERE_SOEUR',
      name: 'Deces du frere ou de la soeur du travailleur',
      eventType: EventType.DEATH,
      defaultDays: 3,
      category: LeaveCategory.CONGE_SPECIAL,
      color: '#64748B',
      description:
        'Permission exceptionnelle payee: deces du frere ou de la soeur du travailleur.',
    },
  ] as const;

export const EXCEPTIONAL_PERMISSION_RULES =
  EXCEPTIONAL_PERMISSION_RULE_DEFINITIONS;

export const EXCEPTIONAL_PERMISSION_CODES = new Set(
  EXCEPTIONAL_PERMISSION_RULES.flatMap((rule) => [
    rule.code,
    ...(rule.aliases ?? []),
  ]),
);

export function exceptionalPermissionDefaults(): Prisma.LeaveTypeCreateManyInput[] {
  return EXCEPTIONAL_PERMISSION_RULES.map((rule) => ({
    code: rule.code,
    name: rule.name,
    category: rule.category,
    defaultDays: rule.defaultDays,
    requiresProof: false,
    paid: true,
    color: rule.color,
    description: rule.description,
  }));
}

export function findExceptionalPermissionRule(
  codeOrName: string | null | undefined,
) {
  const normalized = normalizeExceptionalText(codeOrName);
  if (!normalized) return null;

  return (
    EXCEPTIONAL_PERMISSION_RULES.find(
      (rule) =>
        normalizeExceptionalText(rule.code) === normalized ||
        normalizeExceptionalText(rule.name) === normalized ||
        (rule.aliases ?? []).some(
          (alias) => normalizeExceptionalText(alias) === normalized,
        ),
    ) ?? null
  );
}

export function eventDescriptionIncludesExceptionalRule(
  description: string | null | undefined,
  rule: { code: string; name: string; aliases?: string[] },
) {
  const normalized = normalizeExceptionalText(description);
  if (!normalized) return false;
  const canonicalRule = findExceptionalPermissionRule(rule.code) ?? rule;
  const aliases = [
    ...(rule.aliases ?? []),
    ...((canonicalRule as { aliases?: string[] }).aliases ?? []),
  ];

  return (
    normalized.includes(normalizeExceptionalText(canonicalRule.code)) ||
    normalized.includes(normalizeExceptionalText(canonicalRule.name)) ||
    aliases.some((alias) =>
      normalized.includes(normalizeExceptionalText(alias)),
    )
  );
}

export function normalizeExceptionalText(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}
