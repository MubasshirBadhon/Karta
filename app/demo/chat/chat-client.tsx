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
}

export function ChatClient({ siteToken }: { siteToken: string }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: siteToken
        ? "Hi! I'm Karta, your AI shopping assistant. How can I help you find something today?"
        : "Karta AI is not configured for this demo tenant yet. Connect a WooCommerce store in the dashboard first.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading || !siteToken) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          conversationId: conversationId || undefined,
          siteToken,
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
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Sorry, something went wrong. Please try again." },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Failed to connect. Please check your connection and try again." },
      ]);
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
            disabled={isLoading || !siteToken}
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || !input.trim() || !siteToken}
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
