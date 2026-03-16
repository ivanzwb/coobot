import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface FileOperationResult {
  success: boolean;
  path?: string;
  content?: string;
  error?: string;
}

export interface FileMetadata {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  isFile: boolean;
  extension: string;
  modifiedAt: Date;
  createdAt: Date;
}

export async function readFile(filePath: string): Promise<FileOperationResult> {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { success: true, path: filePath, content };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function writeFile(filePath: string, content: string): Promise<FileOperationResult> {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true, path: filePath };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function deleteFile(filePath: string): Promise<FileOperationResult> {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return { success: true, path: filePath };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function copyFile(src: string, dest: string): Promise<FileOperationResult> {
  try {
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
    return { success: true, path: dest };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function moveFile(src: string, dest: string): Promise<FileOperationResult> {
  try {
    const result = await copyFile(src, dest);
    if (result.success) {
      await deleteFile(src);
    }
    return result;
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function listDirectory(dirPath: string): Promise<FileMetadata[]> {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.map(entry => {
      const fullPath = path.join(dirPath, entry.name);
      const stats = fs.statSync(fullPath);
      return {
        name: entry.name,
        path: fullPath,
        size: stats.size,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
        extension: path.extname(entry.name),
        modifiedAt: stats.mtime,
        createdAt: stats.birthtime
      };
    });
  } catch (error: any) {
    return [];
  }
}

export async function getFileMetadata(filePath: string): Promise<FileMetadata | null> {
  try {
    const stats = fs.statSync(filePath);
    return {
      name: path.basename(filePath),
      path: filePath,
      size: stats.size,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      extension: path.extname(filePath),
      modifiedAt: stats.mtime,
      createdAt: stats.birthtime
    };
  } catch (error: any) {
    return null;
  }
}

export async function searchFiles(
  dirPath: string,
  pattern: RegExp,
  maxDepth: number = 5
): Promise<string[]> {
  const results: string[] = [];

  function search(currentPath: string, depth: number) {
    if (depth > maxDepth) return;

    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
            search(fullPath, depth + 1);
          }
        } else if (entry.isFile()) {
          if (pattern.test(entry.name) || pattern.test(fullPath)) {
            results.push(fullPath);
          }
        }
      }
    } catch (error) {
    }
  }

  search(dirPath, 0);
  return results;
}

export async function createDirectory(dirPath: string): Promise<FileOperationResult> {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    return { success: true, path: dirPath };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function deleteDirectory(dirPath: string): Promise<FileOperationResult> {
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true });
    }
    return { success: true, path: dirPath };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export const fileSkill = {
  name: 'file-skill',
  version: '1.0.0',
  description: 'Skill for file operations',
  readFile,
  writeFile,
  deleteFile,
  copyFile,
  moveFile,
  listDirectory,
  getFileMetadata,
  searchFiles,
  createDirectory,
  deleteDirectory
};

export default fileSkill;
