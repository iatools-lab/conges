import { Sexe, UserStatus } from '@prisma/client';
import { RhChildrenService } from './children.service';

const makeChild = (parentSexe: Sexe) => ({
  id: `child-${parentSexe}`,
  parentId: `parent-${parentSexe}`,
  nom: 'TEST',
  prenom: 'Enfant',
  dateNaissance: new Date('2024-01-10T00:00:00.000Z'),
  sexe: Sexe.F,
  parent: {
    id: `parent-${parentSexe}`,
    matricule: `EMP-${parentSexe}`,
    nom: 'Parent',
    prenom: 'Test',
    sexe: parentSexe,
    status: UserStatus.ACTIVE,
    department: { name: 'RH' },
  },
});

describe('RhChildrenService', () => {
  const prisma = {
    child: { findMany: jest.fn() },
  } as any;
  const service = new RhChildrenService(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('returns an eligibility date for a female employee child', async () => {
    prisma.child.findMany.mockResolvedValue([makeChild(Sexe.F)]);

    const [child] = await service.findAll();

    expect(child).toEqual(
      expect.objectContaining({
        eligibleUntil: '2030-01-10',
        status: 'valid',
        statusLabel: 'Validé',
        bonusDays: 2,
      }),
    );
  });

  it('does not expose eligibility for a male employee child', async () => {
    prisma.child.findMany.mockResolvedValue([makeChild(Sexe.M)]);

    const [child] = await service.findAll();

    expect(child).toEqual(
      expect.objectContaining({
        eligibleUntil: null,
        status: 'not_eligible',
        statusLabel: 'Non éligible',
        bonusDays: 0,
      }),
    );
  });
});
