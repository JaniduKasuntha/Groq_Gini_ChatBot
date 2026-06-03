import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Groq } from 'groq-sdk';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS for frontend development
app.use(cors());
app.use(express.json());

// Initialize Groq client
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = "openai/gpt-oss-20b"; // Keeping the original model as specified in grok.js

const SYSTEM_MESSAGE = {
  role: "system",
  content: "You are a ChatBot Named NIX created by Janidu Kasuntha for simple tasks. To save tokens, keep your answers highly concise, brief, and directly to the point. Avoid verbose explanations or unnecessary fluff."
};

// API endpoint for streaming chat completions
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages array is required' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Sanitize messages to only include role and content, avoiding api schema errors (like unsupported 'id' property)
  const sanitizedMessages = messages.map(msg => ({
    role: msg.role,
    content: msg.content
  }));

  // Limit conversation history to the last 10 messages (5 user-bot turns) to prevent massive context window usage
  const maxHistory = 10;
  const historyWindow = sanitizedMessages.slice(-maxHistory);
  const messagesToSend = [SYSTEM_MESSAGE, ...historyWindow];

  let stream;
  try {
    stream = await groq.chat.completions.create({
      messages: messagesToSend,
      model: MODEL,
      stream: true,
      max_tokens: 1024 // Cap response tokens to avoid runaways
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('Error generating chat completion:', error);
    res.write(`data: ${JSON.stringify({ error: error.message || 'An error occurred during generation' })}\n\n`);
    res.end();
  }

  // If client closes connection, stop the stream
  req.on('close', () => {
    if (stream && typeof stream.controller?.abort === 'function') {
      stream.controller.abort();
    }
  });
});

// Serve frontend static assets in production
const frontendDistPath = path.join(__dirname, 'frontend', 'dist');
app.use(express.static(frontendDistPath));

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(frontendDistPath, 'index.html'));
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

export default app;
