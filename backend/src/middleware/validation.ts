import { Request, Response, NextFunction } from 'express';

export interface ValidationRule {
  field: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  enum?: any[];
  items?: ValidationRule;
}

export interface ValidationSchema {
  body?: ValidationRule[];
  query?: ValidationRule[];
  params?: ValidationRule[];
}

export class ValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function validateValue(value: any, rule: ValidationRule): string | null {
  if (value === undefined || value === null) {
    if (rule.required) {
      return `${rule.field} is required`;
    }
    return null;
  }

  if (rule.type === 'string') {
    if (typeof value !== 'string') {
      return `${rule.field} must be a string`;
    }
    if (rule.minLength !== undefined && value.length < rule.minLength) {
      return `${rule.field} must be at least ${rule.minLength} characters`;
    }
    if (rule.maxLength !== undefined && value.length > rule.maxLength) {
      return `${rule.field} must be at most ${rule.maxLength} characters`;
    }
    if (rule.pattern && !rule.pattern.test(value)) {
      return `${rule.field} has invalid format`;
    }
    if (rule.enum && !rule.enum.includes(value)) {
      return `${rule.field} must be one of: ${rule.enum.join(', ')}`;
    }
  }

  if (rule.type === 'number') {
    const num = Number(value);
    if (isNaN(num)) {
      return `${rule.field} must be a number`;
    }
    if (rule.min !== undefined && num < rule.min) {
      return `${rule.field} must be at least ${rule.min}`;
    }
    if (rule.max !== undefined && num > rule.max) {
      return `${rule.field} must be at most ${rule.max}`;
    }
  }

  if (rule.type === 'boolean') {
    if (typeof value !== 'boolean') {
      return `${rule.field} must be a boolean`;
    }
  }

  if (rule.type === 'array') {
    if (!Array.isArray(value)) {
      return `${rule.field} must be an array`;
    }
    if (rule.items) {
      for (let i = 0; i < value.length; i++) {
        const error = validateValue(value[i], rule.items);
        if (error) {
          return `${rule.field}[${i}]: ${error}`;
        }
      }
    }
  }

  if (rule.type === 'object') {
    if (typeof value !== 'object' || Array.isArray(value)) {
      return `${rule.field} must be an object`;
    }
  }

  return null;
}

export function validate(schema: ValidationSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: string[] = [];

    if (schema.params) {
      for (const rule of schema.params) {
        const error = validateValue(req.params[rule.field], rule);
        if (error) errors.push(error);
      }
    }

    if (schema.query) {
      for (const rule of schema.query) {
        const error = validateValue(req.query[rule.field], rule);
        if (error) errors.push(error);
      }
    }

    if (schema.body) {
      for (const rule of schema.body) {
        const error = validateValue(req.body[rule.field], rule);
        if (error) errors.push(error);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: errors.join('; ')
        }
      });
    }

    next();
  };
}

export const commonSchemas = {
  idParam: {
    params: [{ field: 'id', type: 'string', required: true, minLength: 1 }]
  },
  paginationQuery: {
    query: [
      { field: 'limit', type: 'number', required: false, min: 1, max: 1000 },
      { field: 'offset', type: 'number', required: false, min: 0 }
    ]
  },
  createMessage: {
    body: [
      { field: 'content', type: 'string', required: true, minLength: 1, maxLength: 100000 }
    ]
  },
  createTask: {
    body: [
      { field: 'input', type: 'string', required: true, minLength: 1, maxLength: 100000 }
    ]
  },
  createAgent: {
    body: [
      { field: 'name', type: 'string', required: true, minLength: 1, maxLength: 100 },
      { field: 'type', type: 'string', required: true, enum: ['coordinator', 'executor'] },
      { field: 'role', type: 'string', required: false, maxLength: 1000 },
      { field: 'model', type: 'string', required: false, maxLength: 100 },
      { field: 'temperature', type: 'number', required: false, min: 0, max: 2 }
    ]
  },
  createSkill: {
    body: [
      { field: 'name', type: 'string', required: true, minLength: 1, maxLength: 100 },
      { field: 'description', type: 'string', required: false, maxLength: 2000 },
      { field: 'instructions', type: 'string', required: false, maxLength: 10000 }
    ]
  },
  createKnowledge: {
    body: [
      { field: 'title', type: 'string', required: true, minLength: 1, maxLength: 500 },
      { field: 'content', type: 'string', required: true, minLength: 1 },
      { field: 'sourceType', type: 'string', required: false, enum: ['manual', 'file', 'web'] }
    ]
  },
  createMemory: {
    body: [
      { field: 'type', type: 'string', required: true, enum: ['task', 'conversation', 'user'] },
      { field: 'content', type: 'string', required: true, minLength: 1 },
      { field: 'importance', type: 'number', required: false, min: 0, max: 10 }
    ]
  },
  createPolicy: {
    body: [
      { field: 'name', type: 'string', required: true, minLength: 1, maxLength: 100 },
      { field: 'priority', type: 'number', required: false, min: 0, max: 100 },
      { field: 'readAction', type: 'string', required: false, enum: ['allow', 'deny', 'prompt'] },
      { field: 'writeAction', type: 'string', required: false, enum: ['allow', 'deny', 'prompt'] },
      { field: 'executeAction', type: 'string', required: false, enum: ['allow', 'deny', 'prompt'] }
    ]
  },
  decision: {
    body: [
      { field: 'decidedBy', type: 'string', required: true, minLength: 1 },
      { field: 'reason', type: 'string', required: false, maxLength: 1000 }
    ]
  },
  cancelTask: {
    body: [
      { field: 'reason', type: 'string', required: false, maxLength: 1000 }
    ]
  },
  search: {
    body: [
      { field: 'query', type: 'string', required: true, minLength: 1, maxLength: 1000 }
    ]
  }
};
