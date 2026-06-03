import React, { useState, useEffect, useRef } from 'react';

export default function App() {
  // State for multiple chat sessions
  const [chats, setChats] = useState(() => {
    const saved = localStorage.getItem('grok_chats');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.length > 0) return parsed;
      } catch (e) {
        console.error('Failed to parse chats from localStorage', e);
      }
    }
    return [{ id: 'default', title: 'New Conversation', messages: [] }];
  });

  const [activeChatId, setActiveChatId] = useState(() => {
    const saved = localStorage.getItem('grok_active_chat_id');
    return saved || 'default';
  });

  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 768;
    }
    return false;
  });
  const [copiedId, setCopiedId] = useState(null);

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  // Sync chats to localStorage
  useEffect(() => {
    localStorage.setItem('grok_chats', JSON.stringify(chats));
  }, [chats]);

  // Sync activeChatId to localStorage
  useEffect(() => {
    localStorage.setItem('grok_active_chat_id', activeChatId);
  }, [activeChatId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chats, activeChatId]);

  // Auto-resize textarea as user types
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  // Handle sidebar collapse on window resize transitions
  useEffect(() => {
    let prevWidth = window.innerWidth;
    const handleResize = () => {
      const currentWidth = window.innerWidth;
      if (currentWidth < 768 && prevWidth >= 768) {
        setSidebarCollapsed(true);
      } else if (currentWidth >= 768 && prevWidth < 768) {
        setSidebarCollapsed(false);
      }
      prevWidth = currentWidth;
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const activeChat = chats.find(c => c.id === activeChatId) || chats[0];
  const messages = activeChat ? activeChat.messages : [];

  // Start a new chat session
  const startNewChat = () => {
    const newId = `chat_${Date.now()}`;
    const newChat = {
      id: newId,
      title: 'New Conversation',
      messages: []
    };
    setChats(prev => [newChat, ...prev]);
    setActiveChatId(newId);
    setInput('');
    if (window.innerWidth < 768) {
      setSidebarCollapsed(true);
    }
  };

  // Delete a chat session
  const deleteChat = (e, idToDelete) => {
    e.stopPropagation();
    
    // Don't delete if it's the last one, instead just clear it
    if (chats.length === 1) {
      setChats([{ id: 'default', title: 'New Conversation', messages: [] }]);
      setActiveChatId('default');
      return;
    }

    const updatedChats = chats.filter(c => c.id !== idToDelete);
    setChats(updatedChats);

    if (activeChatId === idToDelete) {
      setActiveChatId(updatedChats[0].id);
    }
  };

  // Copy code blocks to clipboard
  const handleCopy = (codeText, blockId) => {
    navigator.clipboard.writeText(codeText).then(() => {
      setCopiedId(blockId);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  // Submit message
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || isGenerating) return;

    const userMessageContent = input.trim();
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = '54px';

    const userMessage = { role: 'user', content: userMessageContent };
    
    // Update messages local state
    let updatedMessages = [...messages, userMessage];
    
    // Set dynamic chat title if first message
    let chatTitle = activeChat.title;
    if (messages.length === 0) {
      chatTitle = userMessageContent.length > 26 
        ? userMessageContent.substring(0, 24) + '...' 
        : userMessageContent;
    }

    setChats(prev => prev.map(c => 
      c.id === activeChatId 
        ? { ...c, title: chatTitle, messages: updatedMessages } 
        : c
    ));

    setIsGenerating(true);

    // Add temporary empty assistant message to stream into
    const assistantMessageId = `assistant_${Date.now()}`;
    const initialAssistantMessage = { 
      id: assistantMessageId, 
      role: 'assistant', 
      content: '' 
    };

    setChats(prev => prev.map(c => 
      c.id === activeChatId 
        ? { ...c, messages: [...updatedMessages, initialAssistantMessage] } 
        : c
    ));

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages })
      });

      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let finished = false;
      let accumulatedContent = '';

      while (!finished) {
        const { value, done } = await reader.read();
        if (done) {
          finished = true;
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        // Process SSE lines
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (dataStr === '[DONE]') {
              finished = true;
              break;
            }

            try {
              const data = JSON.parse(dataStr);
              if (data.error) {
                accumulatedContent += `\n\nError: ${data.error}`;
              } else if (data.content) {
                accumulatedContent += data.content;
              }

              // Update assistant message with streaming tokens
              setChats(prev => prev.map(c => {
                if (c.id === activeChatId) {
                  const newMsgs = c.messages.map(m => 
                    m.id === assistantMessageId 
                      ? { ...m, content: accumulatedContent } 
                      : m
                  );
                  return { ...c, messages: newMsgs };
                }
                return c;
              }));
            } catch (e) {
              // Sometimes chunks are fragmented, we ignore JSON parse errors of partial lines
            }
          }
        }
      }
    } catch (err) {
      console.error(err);
      setChats(prev => prev.map(c => {
        if (c.id === activeChatId) {
          const newMsgs = c.messages.map(m => 
            m.id === assistantMessageId 
              ? { ...m, content: m.content + `\n\n[Connection Error: ${err.message || 'Could not stream response'}]` } 
              : m
          );
          return { ...c, messages: newMsgs };
        }
        return c;
      }));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSuggestionClick = (prompt) => {
    setInput(prompt);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  // Helper parser for markdown-like code blocks and inline code
  const parseMessageContent = (content, messageId) => {
    if (!content) return null;
    
    const regex = /```(\w*)\n([\s\S]*?)```/g;
    const parts = [];
    let lastIndex = 0;
    let match;
    let blockCounter = 0;

    while ((match = regex.exec(content)) !== null) {
      const textBefore = content.substring(lastIndex, match.index);
      if (textBefore) {
        parts.push({ type: 'text', content: textBefore });
      }
      parts.push({ 
        type: 'code', 
        language: match[1] || 'code', 
        content: match[2],
        id: `${messageId}_code_${blockCounter++}`
      });
      lastIndex = regex.lastIndex;
    }

    const textAfter = content.substring(lastIndex);
    if (textAfter) {
      parts.push({ type: 'text', content: textAfter });
    }

    return parts.map((part, index) => {
      if (part.type === 'code') {
        return (
          <div key={part.id} className="code-container">
            <div className="code-header">
              <span>{part.language}</span>
              <button 
                type="button"
                className="copy-btn" 
                onClick={() => handleCopy(part.content, part.id)}
              >
                {copiedId === part.id ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    Copied
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    Copy
                  </>
                )}
              </button>
            </div>
            <pre>
              <code>{part.content.trim()}</code>
            </pre>
          </div>
        );
      } else {
        // Parse inline code like `code` inside text
        const textParts = part.content.split(/(`[^`\n]+`)/g);
        return (
          <p key={index}>
            {textParts.map((tPart, subIdx) => {
              if (tPart.startsWith('`') && tPart.endsWith('`')) {
                return (
                  <code key={subIdx} className="inline-code">
                    {tPart.slice(1, -1)}
                  </code>
                );
              }
              return tPart;
            })}
          </p>
        );
      }
    });
  };

  return (
    <div className="app-container">
      {/* Sidebar Overlay Backdrop for Mobile */}
      {!sidebarCollapsed && (
        <div 
          className="sidebar-overlay" 
          onClick={() => setSidebarCollapsed(true)}
        />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            Gini
          </div>
        </div>

        <button type="button" className="new-chat-btn" onClick={startNewChat}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          New Chat
        </button>

        <div className="sidebar-history">
          <div className="history-title">Conversations</div>
          {chats.map(chat => (
            <div 
              key={chat.id} 
              className={`history-item ${chat.id === activeChatId ? 'active' : ''}`}
              onClick={() => {
                setActiveChatId(chat.id);
                if (window.innerWidth < 768) {
                  setSidebarCollapsed(true);
                }
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
              <span>{chat.title}</span>
              <button 
                type="button"
                className="history-delete" 
                onClick={(e) => deleteChat(e, chat.id)}
                title="Delete Chat"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="dev-info">
            <div className="avatar">JK</div>
            <div className="dev-details">
              <span className="dev-name">Janidu Kasuntha</span>
              <span className="dev-role">Developer</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="chat-area">
        {/* Top Navbar */}
        <header className="chat-header">
          <button 
            type="button"
            className="toggle-sidebar-btn" 
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>
          <div className="chat-model-info">
            <span className="model-name">openai/gpt-oss-20b</span>
            <span className="model-status">
              <span className="status-dot"></span>
              groq Online
            </span>
          </div>
        </header>

        {/* Viewport */}
        <div className="messages-container">
          {messages.length === 0 ? (
            <div className="welcome-container">
              <div className="welcome-logo">🧞</div>
              <h1 className="welcome-title">Genie AI</h1>
              <p className="welcome-subtitle">
                A premium, real-time streaming chatbot application powered by Groq. Created by Janidu Kasuntha.
              </p>
            </div>
          ) : (
            <>
              {messages.map((message, index) => (
                <div key={message.id || index} className={`message-wrapper ${message.role}`}>
                  <div className={`message-avatar ${message.role}`}>
                    {message.role === 'user' ? 'U' : 'G'}
                  </div>
                  <div className="message-bubble">
                    {message.content ? (
                      parseMessageContent(message.content, message.id || index)
                    ) : (
                      <div className="typing-indicator">
                        <div className="typing-dot"></div>
                        <div className="typing-dot"></div>
                        <div className="typing-dot"></div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <footer className="chat-footer">
          <form onSubmit={handleSubmit} className="input-container">
            <textarea
              ref={textareaRef}
              rows="1"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder="Message Gini..."
              className="chat-input"
              disabled={isGenerating}
            />
            <button 
              type="submit" 
              className="send-btn" 
              disabled={!input.trim() || isGenerating}
              title="Send Message"  
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            </button>
          </form>
          <div className="footer-disclaimer">
            Genie is an AI assistant created for tasks. Responses stream live.
          </div>
        </footer>
      </main>
    </div>
  );
}
