"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatResponse {
  success: boolean;
  conversationId: string;
  response: string;
  error?: string;
}

// Demo site token - public identifier for the Karta Demo Store
// This is NOT a secret - it's a public token that maps to the demo tenant
// It is safe to expose in browser code (like a public API key)
const DEMO_SITE_TOKEN = process.env.NEXT_PUBLIC_DEMO_SITE_TOKEN || "";

// Check if demo is configured
const isDemoConfigured = DEMO_SITE_TOKEN.length > 0;

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hi! I'm Karta, your AI shopping assistant. How can I help you find something today?",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string>("");
  const [error, setError] = useState<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setError("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversationId || undefined,
          message: userMessage,
        }),
      });

      const data: ChatResponse = await response.json();

      if (data.success) {
        setConversationId(data.conversationId);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.response },
        ]);
      } else {
        setError(data.error || data.response || "Something went wrong. Please try again.");
      }
    } catch {
      setError("Failed to connect. Please check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Show configuration error if demo is not configured
  if (!isDemoConfigured) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <div className="max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-yellow-100 flex items-center justify-center mx-auto mb-4">
            <span className="text-yellow-600 text-2xl">⚠️</span>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Demo Not Configured</h1>
          <p className="text-gray-600 mb-4">
            Demo site token is not configured.
          </p>
          <p className="text-sm text-gray-500">
            See <code className="bg-gray-100 px-1 rounded">docs/demo-setup.md</code> for setup instructions.
          </p>
        </div>
      </main>
    );
  }

  // Show configuration error if demo is not configured
  if (!isDemoConfigured) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <div className="max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-yellow-100 flex items-center justify-center mx-auto mb-4">
            <span className="text-yellow-600 text-2xl">⚠️</span>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Demo Not Configured</h1>
          <p className="text-gray-600 mb-4">
            The demo site token is not configured. Please set <code className="bg-gray-100 px-1 rounded">NEXT_PUBLIC_DEMO_SITE_TOKEN</code> in your environment.
          </p>
        </div>
      </main>
    );
  }

  // Show configuration error if demo is not configured
  if (!isDemoConfigured) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <div className="max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-yellow-100 flex items-center justify-center mx-auto mb-4">
            <span className="text-yellow-600 text-2xl">⚠️</span>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Demo Not Configured</h1>
          <p className="text-gray-600 mb-4">
            The demo site token is not configured. Please set <code className="bg-gray-100 px-1 rounded">NEXT_PUBLIC_DEMO_SITE_TOKEN</code> in your environment.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-col h-screen max-w-2xl mx-auto p-4">
      {/* Header */}
      <div className="flex items-center gap-3 py-4 border-b border-gray-200">
        <div className="w-10 h-10 rounded-full bg-karta-primary flex items-center justify-center">
          <span className="text-white font-bold text-lg">K</span>
        </div>
        <div>
          <h1 className="font-semibold text-gray-900">Karta AI</h1>
          <p className="text-xs text-gray-500">AI Shopping Assistant</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                msg.role === "user"
                  ? "bg-karta-primary text-white"
                  : "bg-gray-100 text-gray-900"
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-lg px-4 py-2">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.1s]" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.2s]" />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex justify-center">
            <div className="bg-red-50 text-red-600 rounded-lg px-4 py-2 text-sm">
              {error}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 pt-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about products, prices, availability..."
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-karta-primary"
            disabled={isLoading}
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
            className="rounded-lg bg-karta-primary px-4 py-2 text-white text-sm font-medium hover:bg-karta-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2 text-center">
          Powered by Karta AI — answers based on real product data
        </p>
      </div>
    </main>
  );
}
