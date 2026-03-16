export interface NormalizedInput {
  type: 'text' | 'image' | 'file' | 'mixed';
  text: string;
  attachments: NormalizedAttachment[];
  metadata: InputMetadata;
}

export interface NormalizedAttachment {
  id?: string;
  type: 'image' | 'document' | 'code' | 'data' | 'other';
  name: string;
  mimeType: string;
  size: number;
  content?: string;
  extractedText?: string;
}

export interface InputMetadata {
  source: 'web' | 'api' | 'websocket' | 'cli';
  clientId?: string;
  timestamp: Date;
  language?: string;
  intentConfidence?: number;
}

export class InputNormalizationService {
  private readonly maxTextLength = 100000;
  private readonly supportedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  private readonly supportedDocumentTypes = [
    'application/pdf',
    'text/plain',
    'text/html',
    'text/markdown',
    'application/json',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];
  private readonly supportedCodeTypes = [
    'text/javascript',
    'text/typescript',
    'text/python',
    'text/java',
    'text/csharp',
    'text/cpp',
    'text/go',
    'text/rust',
    'text/ruby',
    'text/php'
  ];

  normalize(rawInput: any): NormalizedInput {
    const attachments: NormalizedAttachment[] = [];
    let text = '';
    let primaryType: 'text' | 'image' | 'file' | 'mixed' = 'text';

    if (typeof rawInput === 'string') {
      text = this.truncateText(rawInput);
    } else if (rawInput && typeof rawInput === 'object') {
      text = this.truncateText(rawInput.content || rawInput.text || rawInput.message || '');

      if (rawInput.attachments && Array.isArray(rawInput.attachments)) {
        for (const att of rawInput.attachments) {
          const normalized = this.normalizeAttachment(att);
          if (normalized) {
            attachments.push(normalized);
          }
        }
      }

      if (rawInput.image || rawInput.images) {
        const images = rawInput.image ? [rawInput.image] : rawInput.images || [];
        for (const img of images) {
          attachments.push(this.normalizeAttachment(img) || {
            type: 'image',
            name: 'image',
            mimeType: 'image/unknown',
            size: 0
          });
        }
      }
    }

    if (attachments.length > 0) {
      if (text.trim()) {
        primaryType = 'mixed';
      } else if (attachments.every(a => a.type === 'image')) {
        primaryType = 'image';
      } else {
        primaryType = 'file';
      }
    }

    return {
      type: primaryType,
      text,
      attachments,
      metadata: {
        source: rawInput?.source || 'web',
        clientId: rawInput?.clientId,
        timestamp: new Date(),
        language: this.detectLanguage(text),
        intentConfidence: rawInput?.confidence
      }
    };
  }

  private truncateText(text: string): string {
    if (text.length > this.maxTextLength) {
      return text.substring(0, this.maxTextLength) + '\n...[truncated]';
    }
    return text;
  }

  private normalizeAttachment(att: any): NormalizedAttachment | null {
    if (!att) return null;

    const name = att.name || att.fileName || att.filename || 'unknown';
    const mimeType = att.mimeType || att.mime_type || att.type || 'application/octet-stream';
    const size = att.size || att.fileSize || 0;

    let type: NormalizedAttachment['type'] = 'other';
    if (this.supportedImageTypes.includes(mimeType)) {
      type = 'image';
    } else if (this.supportedDocumentTypes.includes(mimeType)) {
      type = 'document';
    } else if (this.supportedCodeTypes.some(t => mimeType.includes(t) || name.endsWith(this.getExtension(t)))) {
      type = 'code';
    } else if (mimeType.startsWith('text/')) {
      type = 'document';
    }

    return {
      id: att.id,
      type,
      name,
      mimeType,
      size,
      content: att.content,
      extractedText: att.extractedText || att.extracted_text
    };
  }

  private getExtension(mimeType: string): string {
    const map: Record<string, string> = {
      'text/javascript': '.js',
      'text/typescript': '.ts',
      'text/python': '.py',
      'text/java': '.java',
      'text/csharp': '.cs',
      'text/cpp': '.cpp',
      'text/go': '.go',
      'text/rust': '.rs',
      'text/ruby': '.rb',
      'text/php': '.php'
    };
    return map[mimeType] || '';
  }

  private detectLanguage(text: string): string {
    if (!text || text.length < 10) return 'unknown';

    const patterns: Record<string, RegExp[]> = {
      en: [/\bthe\b/i, /\band\b/i, /\bor\b/i, /\bis\b/i, /\bwas\b/i],
      zh: [/\u4e00-\u9fff/],
      ja: [/\u3040-\u309f/, /\u30a0-\u30ff/],
      ko: [/\uac00-\ud7af/]
    };

    for (const [lang, regexes] of Object.entries(patterns)) {
      let matchCount = 0;
      for (const regex of regexes) {
        if (regex.test(text)) matchCount++;
      }
      if (matchCount > 0) return lang;
    }

    return 'unknown';
  }

  validateInput(input: NormalizedInput): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!input.text && input.attachments.length === 0) {
      errors.push('Input must contain text or attachments');
    }

    if (input.text && input.text.length > this.maxTextLength) {
      errors.push(`Text exceeds maximum length of ${this.maxTextLength}`);
    }

    for (const att of input.attachments) {
      if (!att.name) {
        errors.push('Attachment missing name');
      }
      if (att.size > 50 * 1024 * 1024) {
        errors.push(`Attachment ${att.name} exceeds 50MB limit`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

export const inputNormalizationService = new InputNormalizationService();
