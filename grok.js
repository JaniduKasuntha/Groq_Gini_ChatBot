import { Groq } from 'groq-sdk';
import dotenv from 'dotenv';

import readline from 'readline';

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const messages = [
  {
    role: "system",
    content: "You are a ChatBot named Genie created by Janidu Kasuntha for simple tasks. To save tokens, keep your answers highly concise, brief, and directly to the point. Avoid verbose explanations or unnecessary fluff.",
  }
];

const MODEL = "openai/gpt-oss-20b";

export async function main() {
  console.log("=========================================");
  console.log("   Grok ChatBot - Created by Janidu      ");
  console.log("   Type 'exit' or 'quit' to end the chat. ");
  console.log("=========================================\n");
  console.log("Bot : Hi, I'm Grok. How can I help you?\n");
  askQuestion();
}

function askQuestion() {
  rl.question('You: ', async (userInput) => {
    if (userInput.trim().toLowerCase() === 'exit' || userInput.trim().toLowerCase() === 'quit') {
      console.log('Goodbye!');
      rl.close();
      return;
    }

    if (!userInput.trim()) {
      askQuestion();
      return;
    }

    messages.push({ role: 'user', content: userInput });

    process.stdout.write('Bot: ');
    // Only send the system prompt (index 0) and the last 10 messages of the conversation history to save tokens
    const userAndAssistantHistory = messages.slice(1).slice(-10);
    const messagesToSend = [messages[0], ...userAndAssistantHistory];

    try {
      const chatCompletion = await groq.chat.completions.create({
        messages: messagesToSend,
        model: MODEL,
        stream: true,
        max_tokens: 1024
      });

      let fullResponse = '';
      for await (const chunk of chatCompletion) {
        const content = chunk.choices[0]?.delta?.content || '';
        process.stdout.write(content);
        fullResponse += content;
      }
      process.stdout.write('\n\n');

      messages.push({ role: 'assistant', content: fullResponse });
    } catch (error) {
      console.error('\nError:', error.message || error);
      console.log();
    }

    askQuestion();
  });
}

main();
