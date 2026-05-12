import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  // 👇 Import specific exceptions
  NotFoundException,
  BadRequestException,
  Request,
  UseGuards,
} from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { WorkflowsService } from './workflows.service';
import { DeployWorkflowDto } from './dto/deploy-workflow.dto';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { UpdateDraftDto } from './dto/update-draft.dto';
import { AuthGuard } from '../auth/auth.guard';

@UseGuards(AuthGuard)
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  /**
   * 1. CREATE
   */
  @Post()
  async create(
    @Body() createWorkflowDto: CreateWorkflowDto,
    @Request() req: any,
  ) {
    return this.workflowsService.createWorkflow(
      createWorkflowDto,
      req.user.sub,
    );
  }

  /**
   * 2. LIST
   */
  @Get()
  async findAll(@Request() req: any) {
    return this.workflowsService.findAll(req.user.sub);
  }

  @Get('packages')
  async findPackages() {
    return this.workflowsService.findPackages();
  }

  /**
   * 3. GET LOCAL WORKFLOWS
   * Note: Must be before :id to prevent 'local' being matched as an id
   */
  @Get('local')
  async getLocalWorkflows() {
    try {
      const workspaceDir =
        process.env.LOCAL_WORKSPACE_DIR || '/app/workspace';

      // Check if directory exists
      try {
        await fs.access(workspaceDir);
      } catch {
        return []; // Return empty array if directory doesn't exist yet
      }

      const files = await fs.readdir(workspaceDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));

      const workflows = await Promise.all(
        jsonFiles.map(async (file) => {
          const filePath = path.join(workspaceDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          try {
            const parsed = JSON.parse(content);
            const stat = await fs.stat(filePath);
            return {
              id: file, // Use filename as ID for local files
              workflowId: file, // Keep it consistent
              name: parsed.name || file,
              updatedAt: stat.mtime.toISOString(), // Use file modification time
              nodes: parsed.nodes || [],
              edges: parsed.edges || [],
              isLocal: true, // Flag to identify local workflows
            };
          } catch (e) {
            console.error(`Failed to parse local workflow file ${file}:`, e);
            return null;
          }
        }),
      );

      // Filter out nulls from parse errors and return
      return workflows.filter((w) => w !== null);
    } catch (e) {
      console.error('Failed to list local workflows:', e);
      throw new BadRequestException('Failed to list local workflows');
    }
  }

  /**
   * 4. GET ONE
   */
  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req: any) {
    const workflow = await this.workflowsService.findOne(id, req.user.sub);
    if (!workflow) {
      // ✅ Use semantic exception
      throw new NotFoundException(`Workflow ${id} not found`);
    }
    return workflow;
  }

  /**
   * 5. UPDATE DRAFT
   */
  @Patch(':id')
  async updateDraft(
    @Param('id') id: string,
    @Body() updateDraftDto: UpdateDraftDto,
    @Request() req: any,
  ) {
    return await this.workflowsService.updateDraft(
      id,
      updateDraftDto.nodes || [],
      updateDraftDto.edges || [],
      req.user.sub,
    );
  }

  /**
   * 6. DEPLOY
   */
  @Post('deploy')
  async deploy(
    @Body() deployWorkflowDto: DeployWorkflowDto,
    @Request() req: any,
  ) {
    try {
      return await this.workflowsService.deployWorkflow(
        deployWorkflowDto,
        req.user.sub,
      );
    } catch (e: any) {
      if (e instanceof NotFoundException) throw e;
      console.error('[Deploy Error]', e.message || e);
      throw new BadRequestException(e.message || 'Validation Error');
    }
  }

  /**
   * 7. STATUS
   */
  @Get(':id/status')
  async getStatus(@Param('id') id: string, @Query('runId') runId?: string) {
    try {
      return await this.workflowsService.getWorkflowStatus(id, runId);
    } catch (e) {
      console.log(e);
      throw new NotFoundException('Execution not found');
    }
  }

  /**
   * 8. EXPORT LOCAL WORKSPACE
   */
  @Post('export-local')
  async exportLocal(
    @Body() body: { name: string; nodes: any[]; edges: any[] },
  ) {
    try {
      const workspaceDir =
        process.env.LOCAL_WORKSPACE_DIR || '/app/workspace';

      // Ensure directory exists
      await fs.mkdir(workspaceDir, { recursive: true });

      // Sanitize filename
      const safeName = (body.name || 'Untitled_Workflow')
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase();
      const fileName = `${safeName}_${Date.now()}.json`;
      const filePath = path.join(workspaceDir, fileName);

      // Write JSON definition
      await fs.writeFile(filePath, JSON.stringify(body, null, 2), 'utf-8');

      return { success: true, path: filePath };
    } catch (e) {
      console.error('Failed to export locally:', e);
      throw new BadRequestException('Local Export failed');
    }
  }
}
