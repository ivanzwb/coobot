import { Router, Request, Response } from 'express';
import { memoryEngine, taskOrchestrator, logger } from '../services/index.js';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const { content, attachments } = req.body;

    logger.info('Chat', 'User input received', { content, attachments });

    const task = await taskOrchestrator.createTask({
      content,
      attachments,
    }, 'immediate');

    const messageId = await memoryEngine.appendMessage('user', content, attachments, task.id);

    res.status(201).json({
      messageId,
      taskId: task.id,
      status: task.status,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const history = await memoryEngine.getRecentChatHistory(limit, offset);

    const messages = history.map(msg => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      attachments: msg.attachmentsJson ? JSON.parse(msg.attachmentsJson) : [],
      taskId: msg.relatedTaskId,
      timestamp: msg.createdAt,
      isArchived: msg.isArchived,
    }));

    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/export', async (req: Request, res: Response) => {
  try {
    const format = req.query.format as 'markdown' | 'txt' || 'markdown';
    const includeArchived = req.query.includeArchived === 'true';

    const history = await memoryEngine.getAllSessionMessagesChronological();

    const filteredHistory = includeArchived
      ? history
      : history.filter(h => !h.isArchived);

    let content = '';

    const roleLabel = (role: string | null) =>
      role === 'user' ? 'User' : role === 'system' ? 'System' : 'Assistant';

    if (format === 'markdown') {
      for (const msg of filteredHistory) {
        const timestamp = msg.createdAt ? new Date(msg.createdAt).toLocaleString() : 'Unknown';
        content += `## ${roleLabel(msg.role)} - ${timestamp}\n\n`;
        content += `${msg.content}\n\n---\n\n`;
      }
    } else {
      for (const msg of filteredHistory) {
        const timestamp = msg.createdAt ? new Date(msg.createdAt).toLocaleString() : 'Unknown';
        content += `[${msg.role}] ${timestamp}\n${msg.content}\n\n`;
      }
    }

    res.setHeader('Content-Type', format === 'markdown' ? 'text/markdown' : 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="chat_export_${Date.now()}.${format === 'markdown' ? 'md' : 'txt'}"`);
    res.send(content);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/session-boundary', async (req: Request, res: Response) => {
  try {
    const boundary = req.body.boundary || '--- 新话题 ---';

    await memoryEngine.appendMessage('system', boundary, []);

    res.json({ success: true, boundary });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;