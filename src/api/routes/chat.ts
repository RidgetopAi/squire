/**
 * Chat API Routes (P1-T4)
 *
 * POST /api/chat - Send a message and get a response
 * POST /api/chat/simple - Quick chat without memory context
 */

import { Router, Request, Response } from 'express';
import { chat, chatSimple, type ChatMessage, type ChatRequest } from '../../services/chat.js';
import { checkLLMHealth, getLLMInfo } from '../../providers/llm.js';

const router = Router();

// === Request/Response Types ===

interface ChatApiRequest {
  message: string;
  history?: ChatMessage[];
  includeContext?: boolean;
  contextQuery?: string;
  contextProfile?: string;
  maxContextTokens?: number;
}

interface SimpleChatApiRequest {
  message: string;
  history?: ChatMessage[];
}

// === Routes ===

/**
 * POST /api/chat
 * Full-featured chat with memory context
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as ChatApiRequest;

    // Validate request
    if (!body.message || typeof body.message !== 'string') {
      res.status(400).json({ error: 'Message is required and must be a string' });
      return;
    }

    if (body.message.trim().length === 0) {
      res.status(400).json({ error: 'Message cannot be empty' });
      return;
    }

    // Build chat request
    const chatRequest: ChatRequest = {
      message: body.message.trim(),
      conversationHistory: body.history ?? [],
      includeContext: body.includeContext !== false, // Default true
      contextQuery: body.contextQuery,
      contextProfile: body.contextProfile,
      maxContextTokens: body.maxContextTokens,
    };

    // Process chat
    const response = await chat(chatRequest);

    res.json({
      success: true,
      data: response,
    });
  } catch (error) {
    console.error('Chat error:', error);

    const message = error instanceof Error ? error.message : 'Unknown error';

    // Handle specific errors
    if (message.includes('GROQ_API_KEY')) {
      res.status(503).json({
        success: false,
        error: 'LLM service not configured',
        details: 'GROQ_API_KEY environment variable is not set',
      });
      return;
    }

    if (message.includes('Groq API error')) {
      res.status(502).json({
        success: false,
        error: 'LLM service error',
        details: message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'Failed to process chat message',
      details: message,
    });
  }
});

/**
 * POST /api/chat/simple
 * Quick chat without memory context
 */
router.post('/simple', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as SimpleChatApiRequest;

    // Validate request
    if (!body.message || typeof body.message !== 'string') {
      res.status(400).json({ error: 'Message is required and must be a string' });
      return;
    }

    if (body.message.trim().length === 0) {
      res.status(400).json({ error: 'Message cannot be empty' });
      return;
    }

    // Process simple chat
    const response = await chatSimple(body.message.trim(), body.history ?? []);

    res.json({
      success: true,
      data: {
        message: response,
        role: 'assistant',
      },
    });
  } catch (error) {
    console.error('Simple chat error:', error);

    const message = error instanceof Error ? error.message : 'Unknown error';

    res.status(500).json({
      success: false,
      error: 'Failed to process chat message',
      details: message,
    });
  }
});

/**
 * GET /api/chat/health
 * Check if chat service is available
 */
router.get('/health', async (_req: Request, res: Response): Promise<void> => {
  try {
    const [llmHealthy, llmInfo] = await Promise.all([
      checkLLMHealth(),
      Promise.resolve(getLLMInfo()),
    ]);

    res.json({
      success: true,
      data: {
        status: llmHealthy ? 'healthy' : 'unavailable',
        llm: {
          provider: llmInfo.provider,
          model: llmInfo.model,
          configured: llmInfo.configured,
          available: llmHealthy,
        },
      },
    });
  } catch (error) {
    console.error('Chat health check error:', error);

    res.status(500).json({
      success: false,
      error: 'Health check failed',
    });
  }
});

export default router;
