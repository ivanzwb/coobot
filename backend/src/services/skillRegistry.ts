import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { configManager } from './configManager';

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  runtimeLanguage?: string;
  tools: SkillTool[];
  configSchema?: Record<string, unknown>;
}

export interface SkillTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface SkillInstallResult {
  success: boolean;
  skillId: string;
  error?: string;
}

export class SkillRegistry {
  private skillsDir: string;

  constructor() {
    this.skillsDir = path.join(configManager.getWorkspacePath(), 'skills');
  }

  async listInstalled(): Promise<SkillMeta[]> {
    const results = await db.select()
      .from(schema.skills)
      .where(eq(schema.skills.enabled, true));

    return results.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      version: row.version || undefined,
      author: row.author || undefined,
      runtimeLanguage: row.runtimeLanguage || undefined,
      tools: row.toolManifestJson ? JSON.parse(row.toolManifestJson) : [],
      configSchema: row.configSchemaJson ? JSON.parse(row.configSchemaJson) : undefined,
    }));
  }

  async previewPackage(zipPath: string): Promise<{ name: string; description: string; version: string }> {
    const skillMdPath = path.join(path.dirname(zipPath), 'SKILL.md');
    
    if (!fs.existsSync(skillMdPath)) {
      throw new Error('SKILL.md not found in package');
    }

    const content = fs.readFileSync(skillMdPath, 'utf-8');
    
    const nameMatch = content.match(/^#\s+(.+)$/m);
    const descMatch = content.match(/^description:\s*(.+)$/m);
    const versionMatch = content.match(/^version:\s*(.+)$/m);

    return {
      name: nameMatch ? nameMatch[1].trim() : 'Unknown Skill',
      description: descMatch ? descMatch[1].trim() : '',
      version: versionMatch ? versionMatch[1].trim() : '1.0.0',
    };
  }

  async install(skillPath: string, config?: Record<string, unknown>): Promise<SkillInstallResult> {
    try {
      const skillId = uuidv4();
      const skillDir = path.join(this.skillsDir, skillId);

      if (!fs.existsSync(this.skillsDir)) {
        fs.mkdirSync(this.skillsDir, { recursive: true });
      }

      if (!fs.existsSync(skillDir)) {
        fs.mkdirSync(skillDir, { recursive: true });
      }

      const files = fs.readdirSync(skillPath);
      for (const file of files) {
        const srcPath = path.join(skillPath, file);
        const destPath = path.join(skillDir, file);
        
        if (fs.statSync(srcPath).isDirectory()) {
          fs.mkdirSync(destPath, { recursive: true });
          this.copyRecursive(srcPath, destPath);
        } else {
          fs.copyFileSync(srcPath, destPath);
        }
      }

      const skillMdPath = path.join(skillDir, 'SKILL.md');
      let name = 'Unknown Skill';
      let description = '';
      let version = '1.0.0';
      let runtimeLanguage: string | undefined;
      let tools: SkillTool[] = [];
      let configSchema: Record<string, unknown> = {};

      if (fs.existsSync(skillMdPath)) {
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        
        const nameMatch = content.match(/^#\s+(.+)$/m);
        const descMatch = content.match(/description:\s*(.+)$/m);
        const versionMatch = content.match(/version:\s*(.+)$/m);
        const runtimeMatch = content.match(/runtime:\s*(.+)$/m);
        const toolsMatch = content.match(/```tools\n([\s\S]*?)```/);
        const configMatch = content.match(/```config-schema\n([\s\S]*?)```/);

        name = nameMatch ? nameMatch[1].trim() : name;
        description = descMatch ? descMatch[1].trim() : description;
        version = versionMatch ? versionMatch[1].trim() : version;
        runtimeLanguage = runtimeMatch ? runtimeMatch[1].trim() : undefined;
        
        if (toolsMatch) {
          try {
            tools = JSON.parse(toolsMatch[1]);
          } catch {
            tools = [];
          }
        }

        if (configMatch) {
          try {
            configSchema = JSON.parse(configMatch[1]);
          } catch {
            configSchema = {};
          }
        }
      }

      await db.insert(schema.skills).values({
        id: skillId,
        name,
        description,
        version,
        author: undefined,
        runtimeLanguage,
        detectedLanguage: undefined,
        installMode: 'copy_only',
        rootDir: skillDir,
        entrypoint: undefined,
        configSchemaJson: JSON.stringify(configSchema),
        toolManifestJson: JSON.stringify(tools),
        compatibility: undefined,
        installedAt: new Date(),
        updatedAt: new Date(),
        enabled: true,
      });

      return { success: true, skillId };
    } catch (error) {
      return {
        success: false,
        skillId: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async uninstall(id: string): Promise<void> {
    const results = await db.select()
      .from(schema.skills)
      .where(eq(schema.skills.id, id));

    if (results.length > 0) {
      const rootDir = results[0].rootDir;
      if (fs.existsSync(rootDir)) {
        fs.rmSync(rootDir, { recursive: true, force: true });
      }
    }

    await db.delete(schema.skills)
      .where(eq(schema.skills.id, id));
  }

  async getAvailableTools(agentId: string): Promise<SkillTool[]> {
    const agentSkills = await db.select()
      .from(schema.agentSkills)
      .where(eq(schema.agentSkills.agentId, agentId));

    const allTools: SkillTool[] = [];

    for (const as of agentSkills) {
      const skill = await db.select()
        .from(schema.skills)
        .where(eq(schema.skills.id, as.skillId));

      if (skill.length > 0 && skill[0].toolManifestJson) {
        const tools = JSON.parse(skill[0].toolManifestJson) as SkillTool[];
        allTools.push(...tools.map(t => ({
          ...t,
          name: `skill:${skill[0].id}:${t.name}`,
        })));
      }
    }

    return allTools;
  }

  private copyRecursive(src: string, dest: string): void {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    
    const entries = fs.readdirSync(src, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory()) {
        this.copyRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  async checkSkillInUse(skillId: string): Promise<boolean> {
    const inUse = await db.select()
      .from(schema.agentSkills)
      .where(eq(schema.agentSkills.skillId, skillId));

    return inUse.length > 0;
  }
}

export const skillRegistry = new SkillRegistry();