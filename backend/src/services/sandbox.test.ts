import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { SandboxService } from './sandbox.js';

const createdDirs: string[] = [];

function createWorkspaceFixture(initialFiles: Record<string, string>) {
  const fixtureName = `sandbox-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const relativeDir = fixtureName;
  const absoluteDir = path.resolve('workspace', fixtureName);
  fs.mkdirSync(absoluteDir, { recursive: true });

  for (const [relativePath, content] of Object.entries(initialFiles)) {
    const fullPath = path.join(absoluteDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }

  createdDirs.push(absoluteDir);

  return {
    service: new SandboxService(),
    relativeDir,
    absoluteDir
  };
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('SandboxService', () => {
  it('supports read_file from specified start position', async () => {
    const { service, relativeDir } = createWorkspaceFixture({
      'sliding.txt': 'line1\nline2\nline3\nline4\nline5'
    });

    const result = await service.execute({
      toolName: 'read_file',
      parameters: { path: `${relativeDir}/sliding.txt`, startLine: 3, lineCount: 2 }
    });

    expect(result.success).toBe(true);
    const payload = JSON.parse(result.output || '{}');
    expect(payload.content).toBe('line3\nline4');
    expect(payload.startLine).toBe(3);
    expect(payload.lineCount).toBe(2);
    expect(payload.hasMore).toBe(true);
  });

  it('supports read_file from specified offset position', async () => {
    const { service, relativeDir } = createWorkspaceFixture({
      'offset.txt': 'ABCDEFGHIJ'
    });

    const result = await service.execute({
      toolName: 'read_file',
      parameters: { path: `${relativeDir}/offset.txt`, startOffset: 3, length: 4 }
    });

    expect(result.success).toBe(true);
    const payload = JSON.parse(result.output || '{}');
    expect(payload.mode).toBe('offset');
    expect(payload.content).toBe('DEFG');
    expect(payload.startOffset).toBe(3);
    expect(payload.length).toBe(4);
    expect(payload.hasMore).toBe(true);
  });

  it('supports edit_file range replacement by line/column', async () => {
    const { service, relativeDir, absoluteDir } = createWorkspaceFixture({
      'range.txt': 'hello\nworld\n!'
    });

    const result = await service.execute({
      toolName: 'edit_file',
      parameters: {
        path: `${relativeDir}/range.txt`,
        startLine: 2,
        startColumn: 1,
        endLine: 2,
        endColumn: 6,
        newText: 'earth'
      }
    });

    expect(result.success).toBe(true);
    const payload = JSON.parse(result.output || '{}');
    expect(payload.mode).toBe('range');

    const updated = fs.readFileSync(path.join(absoluteDir, 'range.txt'), 'utf-8');
    expect(updated).toBe('hello\nearth\n!');
  });

  it('returns TOOL_INVALID_ARGUMENT for non-position edit mode', async () => {
    const { service, relativeDir, absoluteDir } = createWorkspaceFixture({
      'chunk.txt': 'abcXYZ'
    });

    const result = await service.execute({
      toolName: 'edit_file',
      parameters: {
        path: `${relativeDir}/chunk.txt`,
        newText: '123'
      }
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('TOOL_INVALID_ARGUMENT');

    const updated = fs.readFileSync(path.join(absoluteDir, 'chunk.txt'), 'utf-8');
    expect(updated).toBe('abcXYZ');
  });

  it('returns TOOL_RANGE_INVALID for invalid read/edit ranges', async () => {
    const { service, relativeDir } = createWorkspaceFixture({
      'invalid-range.txt': 'a\nb\nc'
    });

    const badRead = await service.execute({
      toolName: 'read_file',
      parameters: { path: `${relativeDir}/invalid-range.txt`, startLine: 0, lineCount: 2 }
    });

    expect(badRead.success).toBe(false);
    expect(badRead.error).toContain('TOOL_RANGE_INVALID');

    const badEdit = await service.execute({
      toolName: 'edit_file',
      parameters: {
        path: `${relativeDir}/invalid-range.txt`,
        startLine: 2,
        startColumn: 999,
        endLine: 2,
        endColumn: 999,
        newText: 'x'
      }
    });

    expect(badEdit.success).toBe(false);
    expect(badEdit.error).toContain('TOOL_RANGE_INVALID');
  });

  it('returns TOOL_RANGE_INVALID when startOffset and startLine are both provided', async () => {
    const { service, relativeDir } = createWorkspaceFixture({
      'offset-conflict.txt': 'abcdef'
    });

    const result = await service.execute({
      toolName: 'read_file',
      parameters: {
        path: `${relativeDir}/offset-conflict.txt`,
        startOffset: 2,
        startLine: 1,
        length: 2
      }
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('TOOL_RANGE_INVALID');
  });

  it('returns TOOL_RANGE_INVALID when startOffset exceeds file length', async () => {
    const { service, relativeDir } = createWorkspaceFixture({
      'offset-overflow.txt': 'abc'
    });

    const result = await service.execute({
      toolName: 'read_file',
      parameters: {
        path: `${relativeDir}/offset-overflow.txt`,
        startOffset: 99,
        length: 1
      }
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('TOOL_RANGE_INVALID');
  });

  it('returns TOOL_RANGE_INVALID when start is after end', async () => {
    const { service, relativeDir } = createWorkspaceFixture({
      'range-order.txt': 'abc\ndef\nghi'
    });

    const invalidOrder = await service.execute({
      toolName: 'edit_file',
      parameters: {
        path: `${relativeDir}/range-order.txt`,
        startLine: 3,
        startColumn: 1,
        endLine: 2,
        endColumn: 1,
        newText: 'x'
      }
    });

    expect(invalidOrder.success).toBe(false);
    expect(invalidOrder.error).toContain('TOOL_RANGE_INVALID');
  });
});
