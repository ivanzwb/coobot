import { v4 as uuidv4 } from 'uuid';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
  variables: PromptVariable[];
  tags: string[];
}

export interface PromptVariable {
  name: string;
  description: string;
  required: boolean;
  defaultValue?: string;
}

export class PromptTemplateService {
  async createTemplate(data: {
    name: string;
    description?: string;
    content: string;
    variables?: PromptVariable[];
    tags?: string[];
  }): Promise<PromptTemplate> {
    const id = uuidv4();
    const template: PromptTemplate = {
      id,
      name: data.name,
      description: data.description || '',
      content: data.content,
      variables: data.variables || [],
      tags: data.tags || [],
    };

    await db.insert(schema.prompts).values({
      id: template.id,
      name: template.name,
      description: template.description,
      content: template.content,
      variablesJson: JSON.stringify(template.variables),
      tags: template.tags.join(','),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return template;
  }

  async getTemplate(id: string): Promise<PromptTemplate | null> {
    const results = await db.select()
      .from(schema.prompts)
      .where(eq(schema.prompts.id, id));

    if (results.length === 0) return null;

    const row = results[0];
    return {
      id: row.id,
      name: row.name,
      description: row.description || '',
      content: row.content,
      variables: row.variablesJson ? JSON.parse(row.variablesJson) : [],
      tags: row.tags ? row.tags.split(',').filter(t => t) : [],
    };
  }

  async getAllTemplates(): Promise<PromptTemplate[]> {
    const results = await db.select().from(schema.prompts);

    return results.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description || '',
      content: row.content,
      variables: row.variablesJson ? JSON.parse(row.variablesJson) : [],
      tags: row.tags ? row.tags.split(',').filter(t => t) : [],
    }));
  }

  async updateTemplate(id: string, data: Partial<PromptTemplate>): Promise<void> {
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (data.name) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.content) updateData.content = data.content;
    if (data.variables) updateData.variablesJson = JSON.stringify(data.variables);
    if (data.tags) updateData.tags = data.tags.join(',');

    await db.update(schema.prompts)
      .set(updateData)
      .where(eq(schema.prompts.id, id));
  }

  async deleteTemplate(id: string): Promise<void> {
    await db.delete(schema.prompts)
      .where(eq(schema.prompts.id, id));
  }

  async renderTemplate(id: string, variables: Record<string, unknown>): Promise<string> {
    const template = await this.getTemplate(id);
    if (!template) {
      throw new Error(`Template ${id} not found`);
    }

    let rendered = template.content;

    for (const variable of template.variables) {
      const value = variables[variable.name] ?? variable.defaultValue ?? '';
      rendered = rendered.replace(new RegExp(`{{${variable.name}}}`, 'g'), String(value));
      rendered = rendered.replace(new RegExp(`\\{\\{${variable.name}\\}\\}`, 'g'), String(value));
    }

    return rendered;
  }

  async searchTemplates(query: string): Promise<PromptTemplate[]> {
    const all = await this.getAllTemplates();
    const lowerQuery = query.toLowerCase();

    return all.filter(t =>
      t.name.toLowerCase().includes(lowerQuery) ||
      t.description.toLowerCase().includes(lowerQuery) ||
      t.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }
}

export const promptTemplateService = new PromptTemplateService();