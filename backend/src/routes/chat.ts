import { Router, Request, Response } from 'express';
import { memoryEngine, taskOrchestrator, logger } from '../services/index.js';
import { provideBrainUserInput } from '../services/agentBrain/brainUserInputBridge.js';
import type { Attachment } from '../types/index.js';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const { content, attachments, brainReplyTaskId } = req.body as {
      content?: string;
      attachments?: unknown[];
      brainReplyTaskId?: string;
    };

    const safeAttachments = (attachments ?? []) as Record<string, unknown>[];

    if (
      typeof brainReplyTaskId === 'string' &&
      brainReplyTaskId.length > 0 &&
      typeof content === 'string' &&
      content.trim() !== ''
    ) {
      if (provideBrainUserInput(brainReplyTaskId, content)) {
        const messageId = await memoryEngine.appendMessage(
          'user',
          content.trim(),
          safeAttachments,
          brainReplyTaskId
        );
        logger.info('Chat', 'Delivered message to AgentBrain ask_user', { brainReplyTaskId });
        return res.status(200).json({
          messageId,
          taskId: brainReplyTaskId,
          deliveredBrainInput: true,
        });
      }
    }

    if (typeof content !== 'string' || content.trim() === '') {
      return res.status(400).json({ error: 'CONTENT_REQUIRED' });
    }

    logger.info('Chat', 'User input received', { content, attachments });

    const task = await taskOrchestrator.createTask(
      {
        content,
        attachments: safeAttachments as unknown as Attachment[],
      },
      'immediate'
    );

    const messageId = await memoryEngine.appendMessage('user', content, safeAttachments, task.id);

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