import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { db } from '../db/index.js';
import { attachments } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import config from 'config';

export interface AttachmentParseResult {
  text?: string;
  confidence?: number;
  method: string;
  summary: string;
}

export class AttachmentService {
  private workspacePath: string;

  constructor() {
    this.workspacePath = config.get('workspace.path') || './workspace';
    if (!fs.existsSync(this.workspacePath)) {
      fs.mkdirSync(this.workspacePath, { recursive: true });
    }
  }

  async uploadAttachment(
    conversationId: string,
    file: { name: string; size: number; mimeType: string; buffer: Buffer }
  ): Promise<string> {
    const id = uuidv4();
    const ext = path.extname(file.name);
    const storagePath = path.join(this.workspacePath, `${id}${ext}`);

    fs.writeFileSync(storagePath, file.buffer);

    await db.insert(attachments).values({
      id,
      conversationId,
      fileName: file.name,
      mimeType: file.mimeType,
      fileSize: file.size,
      storagePath,
      uploadStatus: 'completed',
      parseStatus: 'pending'
    });

    return id;
  }

  async getAttachment(id: string) {
    return db.query.attachments.findFirst({
      where: eq(attachments.id, id)
    });
  }

  async parseAttachment(id: string): Promise<AttachmentParseResult> {
    const attachment = await this.getAttachment(id);
    if (!attachment) {
      throw new Error('Attachment not found');
    }

    const result = await this.processFile(attachment);
    
    await db.update(attachments)
      .set({
        parseStatus: result ? 'success' : 'failed',
        parseMethod: result.method,
        parseSummary: result.summary,
        parseConfidence: result.confidence
      })
      .where(eq(attachments.id, id));

    return result;
  }

  private async processFile(attachment: any): Promise<AttachmentParseResult> {
    const ext = path.extname(attachment.fileName).toLowerCase();
    const storagePath = attachment.storagePath;

    if (!fs.existsSync(storagePath)) {
      return { method: 'none', summary: 'File not found', confidence: 0 };
    }

    try {
      if (ext === '.pdf') {
        return await this.parsePdf(storagePath);
      } else if (ext === '.doc' || ext === '.docx') {
        return await this.parseDocx(storagePath);
      } else if (ext === '.txt') {
        return await this.parseText(storagePath);
      } else if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
        return await this.parseImage(storagePath);
      }
      return { method: 'none', summary: 'Unsupported file type', confidence: 0 };
    } catch (error) {
      return { method: 'none', summary: `Parse error: ${error}`, confidence: 0 };
    }
  }

  private async parsePdf(filePath: string): Promise<AttachmentParseResult> {
    try {
      const pdf = await import('pdf-parse');
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdf.default(dataBuffer);
      return {
        text: data.text,
        confidence: 0.9,
        method: 'pdf-parse',
        summary: `PDF解析完成，提取${data.numpages}页内容`
      };
    } catch (error) {
      return { method: 'pdf-parse', summary: `PDF解析失败: ${error}`, confidence: 0 };
    }
  }

  private async parseDocx(filePath: string): Promise<AttachmentParseResult> {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return {
        text: result.value,
        confidence: 0.85,
        method: 'mammoth',
        summary: 'Word文档解析完成'
      };
    } catch (error) {
      return { method: 'mammoth', summary: `Word文档解析失败: ${error}`, confidence: 0 };
    }
  }

  private async parseText(filePath: string): Promise<AttachmentParseResult> {
    const content = fs.readFileSync(filePath, 'utf-8');
    return {
      text: content,
      confidence: 1.0,
      method: 'text',
      summary: '文本文件读取完成'
    };
  }

  private async parseImage(filePath: string): Promise<AttachmentParseResult> {
    return {
      text: '[图片内容，需要OCR处理]',
      confidence: 0.5,
      method: 'image',
      summary: '图片文件，需要OCR处理'
    };
  }

  async reparseAttachment(id: string): Promise<AttachmentParseResult> {
    await db.update(attachments)
      .set({ parseStatus: 'pending' })
      .where(eq(attachments.id, id));
    return this.parseAttachment(id);
  }

  async deleteAttachment(id: string) {
    const attachment = await this.getAttachment(id);
    if (attachment && fs.existsSync(attachment.storagePath)) {
      fs.unlinkSync(attachment.storagePath);
    }
    await db.delete(attachments).where(eq(attachments.id, id));
  }
}

export const attachmentService = new AttachmentService();