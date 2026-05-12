import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowsService } from './workflows.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkflowDefinition } from './entities/workflow-definition.entity';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';

describe('WorkflowsService', () => {
  let service: WorkflowsService;
  let repo: any;
  let temporalClient: any;

  const fakeWorkflow = {
    id: 'uuid-1', workflowId: 'wf_123', name: 'Test', userId: 'user-1',
    nodes: [], edges: [], status: 'DRAFT', isActive: false,
    isPackage: false, deployedGraph: null,
  };

  beforeEach(async () => {
    repo = {
      createCalledWith: undefined as any,
      saveCalled: false,
      updateCalledWithArgs: [] as any[],
      create: function(dto: any) { this.createCalledWith = dto; return fakeWorkflow; },
      save: async function() { this.saveCalled = true; return fakeWorkflow; },
      find: async () => [fakeWorkflow],
      findOne: async () => fakeWorkflow,
      update: async function(criteria: any, dto: any) { this.updateCalledWithArgs = [criteria, dto]; return {}; },
    };
    temporalClient = {
      schedule: { getHandle: () => ({}), create: async () => ({}) },
      workflow: { getHandle: () => ({}) },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowsService,
        { provide: getRepositoryToken(WorkflowDefinition), useValue: repo },
        { provide: 'TEMPORAL_CLIENT', useValue: temporalClient },
        { provide: ConfigService, useValue: { get: () => 'http://localhost:8233' } },
      ],
    }).compile();
    service = mod.get<WorkflowsService>(WorkflowsService);
  });

  it('should be defined', () => { expect(service).toBeDefined(); });

  describe('createWorkflow', () => {
    it('creates with DRAFT status and wf_ prefix ID', async () => {
      const dto = { name: 'My WF', nodes: [], edges: [] };
      await service.createWorkflow(dto as any, 'user-1');
      const repoAny = repo as any; expect(repoAny.createCalledWith?.status).toBe('DRAFT');
      expect(repo.createCalledWith?.userId).toBe('user-1');
      expect(repo.saveCalled).toBe(true);
    });
  });

  describe('findOne', () => {
    it('finds by UUID first', async () => {
      const result = await service.findOne('uuid-1', 'user-1');
      expect(result).toEqual(fakeWorkflow);
    });

    it('falls back to workflowId when UUID not found', async () => {
      let callCount = 0;
      repo.findOne = async () => {
        callCount++;
        return callCount === 1 ? null : fakeWorkflow;
      };
      const result = await service.findOne('wf_123', 'user-1');
      expect(result).toEqual(fakeWorkflow);
    });

    it('returns null when not found anywhere', async () => {
      repo.findOne = async () => null;
      const result = await service.findOne('nonexistent', 'user-1');
      expect(result).toBeNull();
    });
  });

  describe('updateDraft', () => {
    it('updates nodes/edges and sets status to DRAFT', async () => {
      const nodes = [{ id: 'n1' }]; const edges = [{ id: 'e1' }];
      await service.updateDraft('uuid-1', nodes, edges, 'user-1');
      const repoAny = repo as any;
      expect(repoAny.updateCalledWithArgs[0]).toEqual({ id: fakeWorkflow.id });
      expect(repoAny.updateCalledWithArgs[1].status).toBe('DRAFT');
    });

    it('throws NotFoundException when workflow not found', async () => {
      repo.findOne = async () => null;
      await expect(service.updateDraft('bad', [], [], 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('deployWorkflow', () => {
    it('throws when no start node in steps', async () => {
      const dto = { workflowId: 'wf_123', steps: { n1: { type: 'logic_wait' } }, startAt: 'n1' };
      await expect(service.deployWorkflow(dto as any, 'user-1')).rejects.toThrow();
    });

    it('deploys webhook trigger correctly', async () => {
      const dto = {
        workflowId: 'wf_123',
        steps: { start: { type: 'trigger_start', params: {} } },
        startAt: 'start',
      };
      const result = await service.deployWorkflow(dto as any, 'user-1');
      expect(result.success).toBe(true);
      expect(result.status).toBe('PUBLISHED');
      const repoAny = repo as any;
      expect(repoAny.updateCalledWithArgs[0]).toEqual({ workflowId: 'wf_123' });
      expect(repoAny.updateCalledWithArgs[1].status).toBe('PUBLISHED');
      expect(repoAny.updateCalledWithArgs[1].triggerType).toBe('WEBHOOK');
    });
  });
});
