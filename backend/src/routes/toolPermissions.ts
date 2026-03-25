import { Router, Request, Response } from 'express';
import { db, schema } from '../db/index.js';
import { eq, and } from 'drizzle-orm';

const router = Router();

router.get('/:agentId', async (req: Request, res: Response) => {
  try {
    const permissions = await db.select()
      .from(schema.agentToolPermissions)
      .where(eq(schema.agentToolPermissions.agentId, req.params.agentId));

    const defaultTools = [
      { toolName: 'read_file', policy: 'ASK', description: '读取本地文件' },
      { toolName: 'write_file', policy: 'ASK', description: '写入本地文件' },
      { toolName: 'edit_file', policy: 'ASK', description: '编辑本地文件' },
      { toolName: 'list_directory', policy: 'ALLOW', description: '列出目录内容' },
      { toolName: 'exec_shell', policy: 'DENY', description: '执行 Shell 命令' },
      { toolName: 'http_request', policy: 'ASK', description: '发送 HTTP 请求' },
      { toolName: 'clipboard', policy: 'ASK', description: '操作剪贴板' },
      { toolName: 'system_info', policy: 'ALLOW', description: '获取系统信息' },
    ];

    const result = defaultTools.map(tool => {
      const customPerm = permissions.find(p => p.toolName === tool.toolName);
      return {
        toolName: tool.toolName,
        description: tool.description,
        policy: customPerm?.policy || tool.policy,
      };
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.put('/:agentId', async (req: Request, res: Response) => {
  try {
    const { toolName, policy } = req.body;
    const agentId = req.params.agentId;

    if (!['DENY', 'ASK', 'ALLOW'].includes(policy)) {
      return res.status(400).json({ error: 'Invalid policy' });
    }

    await db.insert(schema.agentToolPermissions)
      .values({
        agentId,
        toolName,
        policy,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.agentToolPermissions.agentId, schema.agentToolPermissions.toolName],
        set: { policy, updatedAt: new Date() },
      });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.delete('/:agentId/:toolName', async (req: Request, res: Response) => {
  try {
    await db.delete(schema.agentToolPermissions)
      .where(
        and(
          eq(schema.agentToolPermissions.agentId, req.params.agentId),
          eq(schema.agentToolPermissions.toolName, req.params.toolName)
        )
      );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;