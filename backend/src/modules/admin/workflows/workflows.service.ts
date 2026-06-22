import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class AdminWorkflowsService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany() {
    const rows = await this.prisma.workflow.findMany({
      include: { steps: true },
      orderBy: { name: 'asc' },
    });
    return { rows };
  }

  async findOne(id: string) {
    const wf = await this.prisma.workflow.findUnique({
      where: { id },
      include: { steps: true },
    });
    if (!wf) throw new NotFoundException('Workflow not found');
    return wf;
  }

  async create(dto: CreateWorkflowDto) {
    const created = await this.prisma.workflow.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        steps: dto.steps
          ? {
              create: dto.steps.map((s) => ({
                order: s.order,
                validator: s.validator,
                slaHours: s.slaHours ?? null,
                required: typeof s.required === 'undefined' ? true : s.required,
              })),
            }
          : undefined,
      },
      include: { steps: true },
    });
    return created;
  }

  async update(id: string, dto: UpdateWorkflowDto) {
    const exists = await this.prisma.workflow.findUnique({
      where: { id },
      include: { steps: true },
    });
    if (!exists) throw new NotFoundException('Workflow not found');

    const data: Prisma.WorkflowUpdateInput = {};
    if (dto.name) data.name = dto.name;
    if (dto.description) data.description = dto.description;

    // simple strategy: if steps provided, delete existing and recreate
    if (dto.steps) {
      await this.prisma.workflowStep.deleteMany({ where: { workflowId: id } });
      data.steps = {
        create: dto.steps.map((s) => ({
          order: s.order ?? 1,
          validator: s.validator,
          slaHours: s.slaHours ?? null,
          required: typeof s.required === 'undefined' ? true : s.required,
        })),
      };
    }

    const updated = await this.prisma.workflow.update({
      where: { id },
      data,
      include: { steps: true },
    });
    return updated;
  }

  async remove(id: string) {
    const exists = await this.prisma.workflow.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Workflow not found');
    await this.prisma.workflow.delete({ where: { id } });
    return { deleted: true };
  }
}
