import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { db } from '../db/index.js';
import { attachments, attachmentEvents } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import config from 'config';
import { AttachmentParseStatus, AttachmentUploadStatus } from '../types/index.js';

export interface AttachmentParseResult {
  text?: string;
  confidence?: number;
  method: string;
  summary: string;
  slices?: InputSlice[];
}

export interface InputSlice {
  sliceId: string;
  attachmentId: string;
  sliceIndex: number;
  content: string;
  sourceRange?: {
    startLine: number;
    endLine: number;
    startChar: number;
    endChar: number;
  };
  type: 'paragraph' | 'table' | 'image_region' | 'section' | 'full_text';
  summary?: string;
  importance?: number;
}

export interface ParseProgress {
  attachmentId: string;
  status: 'pending' | 'parsing' | 'slicing' | 'completed' | 'failed' | 'parsed' | 'accepted' | 'skipped';
  progress: number;
  currentStep?: string;
  errorMessage?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export type AttachmentParseMethod = 'pdf-parse' | 'mammoth' | 'text' | 'ocr' | 'none';

export class AttachmentService {
  private workspacePath: string;
  private maxSliceLength: number;
  private sliceOverlap: number;

  constructor() {
    this.workspacePath = config.get('workspace.path') || './workspace';
    this.maxSliceLength = config.get('attachment.maxSliceLength') || 2000;
    this.sliceOverlap = config.get('attachment.sliceOverlap') || 100;
    
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
      uploadStatus: AttachmentUploadStatus.COMPLETED,
      parseStatus: AttachmentParseStatus.PENDING
    });

    await this.addEvent(id, 'AttachmentUploaded', {
      fileName: file.name,
      mimeType: file.mimeType,
      fileSize: file.size
    });

    return id;
  }

  async getAttachment(id: string) {
    return db.query.attachments.findFirst({
      where: eq(attachments.id, id)
    });
  }

  async getParseProgress(attachmentId: string): Promise<ParseProgress> {
    const attachment = await this.getAttachment(attachmentId);
    if (!attachment) {
      throw new Error('Attachment not found');
    }

    const statusMap: Record<string, ParseProgress['status']> = {
      [AttachmentParseStatus.PENDING]: 'pending',
      [AttachmentParseStatus.PARSING]: 'parsing',
      [AttachmentParseStatus.SLICING]: 'slicing',
      [AttachmentParseStatus.PARSED]: 'parsed',
      [AttachmentParseStatus.PARSE_FAILED]: 'failed'
    };

    return {
      attachmentId,
      status: statusMap[attachment.parseStatus || ''] || 'pending',
      progress: attachment.parseStatus === AttachmentParseStatus.PARSED ? 100 : 
               attachment.parseStatus === AttachmentParseStatus.PARSE_FAILED ? 0 : 50,
      currentStep: attachment.parseMethod || undefined,
      startedAt: attachment.createdAt
    };
  }

  async parseAttachment(id: string): Promise<AttachmentParseResult> {
    const attachment = await this.getAttachment(id);
    if (!attachment) {
      throw new Error('Attachment not found');
    }

    await db.update(attachments)
      .set({ parseStatus: AttachmentParseStatus.PARSING })
      .where(eq(attachments.id, id));
    
    await this.addEvent(id, 'ParsingStarted', { method: 'auto-detect' });

    let result: AttachmentParseResult;
    try {
      result = await this.processFile(attachment);
      
      if (!result.text) {
        await db.update(attachments)
          .set({
            parseStatus: AttachmentParseStatus.PARSE_FAILED,
            parseMethod: result.method,
            parseSummary: result.summary,
            parseConfidence: result.confidence
          })
          .where(eq(attachments.id, id));

        await this.addEvent(id, 'ParsingFailed', {
          method: result.method,
          error: result.summary
        });
        
        return result;
      }

      await db.update(attachments)
        .set({
          parseStatus: AttachmentParseStatus.SLICING,
          parseMethod: result.method,
          parseSummary: result.summary,
          parseConfidence: result.confidence
        })
        .where(eq(attachments.id, id));

      await this.addEvent(id, 'ParsingCompleted', {
        method: result.method,
        confidence: result.confidence,
        hasText: true
      });

      const slices = await this.generateInputSlices(id, result.text);
      result.slices = slices;
      
      await db.update(attachments)
        .set({ 
          parseStatus: AttachmentParseStatus.PARSED
        })
        .where(eq(attachments.id, id));

      await this.addEvent(id, 'SlicingCompleted', {
        sliceCount: slices.length,
        totalCharacters: result.text.length
      });

      await this.addEvent(id, 'AttachmentAccepted', {
        attachmentId: id,
        sliceCount: slices.length
      });

    } catch (error: any) {
      await db.update(attachments)
        .set({ parseStatus: AttachmentParseStatus.PARSE_FAILED })
        .where(eq(attachments.id, id));
      
      await this.addEvent(id, 'ParsingFailed', { error: error.message });
      throw error;
    }

    return result;
  }

  private async generateInputSlices(attachmentId: string, text: string): Promise<InputSlice[]> {
    const slices: InputSlice[] = [];
    
    if (!text || text.trim().length === 0) {
      slices.push({
        sliceId: uuidv4(),
        attachmentId,
        sliceIndex: 0,
        content: text || '',
        type: 'full_text',
        summary: '空内容',
        importance: 0
      });
      return slices;
    }

    const paragraphs = this.splitIntoParagraphs(text);
    let currentSlice = '';
    let sliceIndex = 0;
    let startChar = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i];
      
      if (currentSlice.length + paragraph.length > this.maxSliceLength && currentSlice.length > 0) {
        slices.push(this.createSlice(attachmentId, sliceIndex, currentSlice, startChar, paragraphs, i));
        sliceIndex++;
        startChar = startChar + currentSlice.length + 1;
        
        if (this.sliceOverlap > 0 && currentSlice.length >= this.sliceOverlap) {
          currentSlice = currentSlice.slice(-this.sliceOverlap);
          startChar = startChar - (currentSlice.length);
        } else {
          currentSlice = '';
        }
      }
      
      currentSlice += paragraph + '\n';
    }

    if (currentSlice.trim().length > 0) {
      slices.push(this.createSlice(attachmentId, sliceIndex, currentSlice, startChar, paragraphs, paragraphs.length));
    }

    if (slices.length === 0 && text.trim().length > 0) {
      slices.push({
        sliceId: uuidv4(),
        attachmentId,
        sliceIndex: 0,
        content: text,
        type: 'full_text',
        summary: text.slice(0, 100) + (text.length > 100 ? '...' : ''),
        importance: 1.0
      });
    }

    return slices;
  }

  private splitIntoParagraphs(text: string): string[] {
    return text
      .split(/\n{2,}/)
      .map(p => p.trim())
      .filter(p => p.length > 0);
  }

  private createSlice(
    attachmentId: string,
    sliceIndex: number,
    content: string,
    startChar: number,
    allParagraphs: string[],
    processedParagraphs: number
  ): InputSlice {
    const isTable = this.detectTableContent(content);
    const isSection = this.detectSectionHeader(content);
    
    let type: InputSlice['type'] = 'paragraph';
    if (isTable) type = 'table';
    else if (isSection) type = 'section';

    const summary = this.generateSliceSummary(content, type);
    const importance = this.calculateSliceImportance(content, type);

    return {
      sliceId: uuidv4(),
      attachmentId,
      sliceIndex,
      content,
      sourceRange: {
        startLine: this.countLines(content.substring(0, startChar)) + 1,
        endLine: this.countLines(content) + this.countLines(content.substring(0, startChar)),
        startChar,
        endChar: startChar + content.length
      },
      type,
      summary,
      importance
    };
  }

  private detectTableContent(content: string): boolean {
    const lines = content.split('\n');
    if (lines.length < 2) return false;
    
    const tabCount = lines[0].split('\t').length;
    const commaCount = lines[0].split(',').length;
    
    return lines.every(line => {
      const t = line.split('\t').length;
      const c = line.split(',').length;
      return t === tabCount || c === commaCount;
    }) && (tabCount > 1 || commaCount > 1);
  }

  private detectSectionHeader(content: string): boolean {
    return /^(第[一二三四五六七八九十\d]+[章节条段]|^#{1,6}\s|^[A-Z][A-Z\s]+:$)/m.test(content);
  }

  private generateSliceSummary(content: string, type: InputSlice['type']): string {
    const firstLine = content.split('\n')[0];
    const preview = firstLine.slice(0, 80);
    
    if (content.length <= 80) return content;
    return preview + '...';
  }

  private calculateSliceImportance(content: string, type: InputSlice['type']): number {
    let importance = 0.5;

    if (type === 'section') importance = 0.8;
    if (type === 'table') importance = 0.7;

    if (content.includes('关键') || content.includes('重要') || content.includes('总结')) {
      importance += 0.2;
    }
    if (content.includes('代码') || content.includes('函数') || content.includes('变量')) {
      importance += 0.1;
    }

    return Math.min(importance, 1.0);
  }

  private countLines(text: string): number {
    return (text.match(/\n/g) || []).length;
  }

  async getInputSlices(attachmentId: string): Promise<InputSlice[]> {
    const slices = await db.select().from(attachmentEvents)
      .where(eq(attachmentEvents.attachmentId, attachmentId));
    
    const sliceEvents = slices.filter(e => e.eventType === 'SliceCreated');
    
    return sliceEvents.map(e => {
      try {
        const details = e.details ? JSON.parse(e.details) : {};
        return {
          sliceId: details.sliceId || e.id,
          attachmentId: e.attachmentId,
          sliceIndex: details.sliceIndex || 0,
          content: details.content || '',
          type: details.type || 'paragraph',
          summary: details.summary,
          importance: details.importance,
          sourceRange: details.sourceRange
        } as InputSlice;
      } catch {
        return null;
      }
    }).filter(Boolean) as InputSlice[];
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
      } else if (ext === '.txt' || ext === '.md' || ext === '.json' || ext === '.xml' || ext === '.csv') {
        return await this.parseText(storagePath);
      } else if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) {
        return await this.parseImageWithOCR(storagePath);
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
      
      await db.update(attachments)
        .set({ pageCount: data.numpages })
        .where(eq(attachments.id, (await this.getAttachmentByPath(filePath))?.id || ''));

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

  private async parseImageWithOCR(filePath: string): Promise<AttachmentParseResult> {
    try {
      const ocrResult = await this.performOCR(filePath);
      return {
        text: ocrResult.text,
        confidence: ocrResult.confidence,
        method: 'ocr',
        summary: `OCR识别完成，识别${ocrResult.wordCount}个词汇`
      };
    } catch (error) {
      return {
        text: '[图片内容，OCR识别失败]',
        confidence: 0.1,
        method: 'ocr',
        summary: `OCR识别失败: ${error}`
      };
    }
  }

  private async performOCR(filePath: string): Promise<{ text: string; confidence: number; wordCount: number }> {
    const ocrEnabled = config.get('attachment.ocr.enabled') as boolean;
    
    if (!ocrEnabled) {
      return {
        text: '[图片内容，OCR未启用]',
        confidence: 0,
        wordCount: 0
      };
    }

    try {
      const ocrApi = config.get('attachment.ocr.api') as string;
      
      if (ocrApi === 'tesseract') {
        return await this.performTesseractOCR(filePath);
      } else if (ocrApi === 'openai') {
        return await this.performOpenAIVisionOCR(filePath);
      }
      
      return {
        text: '[图片内容，配置的OCR服务不可用]',
        confidence: 0,
        wordCount: 0
      };
    } catch (error) {
      throw new Error(`OCR processing failed: ${error}`);
    }
  }

  private async performTesseractOCR(filePath: string): Promise<{ text: string; confidence: number; wordCount: number }> {
    const tesseract = await import('tesseract.js');
    
    const result = await tesseract.recognize(filePath, 'eng+chi_sim', {
      logger: (m: any) => {
        if (m.status === 'recognizing text') {
          console.log(`[OCR] Progress: ${Math.round(m.progress * 100)}%`);
        }
      }
    });

    return {
      text: result.data.text,
      confidence: result.data.confidence / 100,
      wordCount: result.data.words?.length || 0
    };
  }

  private async performOpenAIVisionOCR(filePath: string): Promise<{ text: string; confidence: number; wordCount: number }> {
    const openai = await import('openai');
    
    const apiKey = config.get('llm.openaiApiKey') as string;
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const client = new openai.default({ apiKey });
    const imageBuffer = fs.readFileSync(filePath);
    const base64Image = imageBuffer.toString('base64');

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '请识别图片中的所有文字，并以纯文本格式输出。如果图片中没有文字，请回复"未检测到文字"。'
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`
              }
            }
          ]
        }
      ],
      max_tokens: 4096
    });

    const text = response.choices[0]?.message?.content || '';
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

    return {
      text,
      confidence: 0.85,
      wordCount
    };
  }

  async reparseAttachment(id: string): Promise<AttachmentParseResult> {
    await db.update(attachments)
      .set({ parseStatus: AttachmentParseStatus.PENDING, parseMethod: null, parseSummary: null, parseConfidence: null })
      .where(eq(attachments.id, id));
    
    await this.addEvent(id, 'ReparseRequested', {});
    return this.parseAttachment(id);
  }

  async deleteAttachment(id: string) {
    const attachment = await this.getAttachment(id);
    if (attachment && fs.existsSync(attachment.storagePath)) {
      fs.unlinkSync(attachment.storagePath);
    }
    
    await this.addEvent(id, 'AttachmentDeleted', {});
    await db.delete(attachments).where(eq(attachments.id, id));
  }

  private async getAttachmentByPath(filePath: string): Promise<any | null> {
    const allAttachments = await db.select().from(attachments);
    return allAttachments.find(a => a.storagePath === filePath) || null;
  }

  private async addEvent(attachmentId: string, eventType: string, details: object) {
    await db.insert(attachmentEvents).values({
      id: uuidv4(),
      attachmentId,
      eventType,
      details: JSON.stringify(details),
      createdAt: new Date()
    });
  }

  async getAttachmentEvents(attachmentId: string) {
    return db.select()
      .from(attachmentEvents)
      .where(eq(attachmentEvents.attachmentId, attachmentId))
      .orderBy(attachmentEvents.createdAt);
  }
}

export const attachmentService = new AttachmentService();