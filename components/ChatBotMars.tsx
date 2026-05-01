"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type ChatMessage = {
  role: "assistant" | "user";
  content: string;
};

const CHATBOT_ENABLED = false;

export default function ChatBotMars() {
  if (!CHATBOT_ENABLED) {
    return null;
  }

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hi, I’m ChatBot Mars. Ask me about rooms, booking, amenities, dining, or resort activities.",
    },
  ]);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedInput = input.trim();
    if (!trimmedInput || loading) {
      return;
    }

    setInput("");
    setMessages((currentMessages) => [
      ...currentMessages,
      { role: "user", content: trimmedInput },
    ]);
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: trimmedInput }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to get a reply.");
      }

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: "assistant",
          content:
            data.reply ||
            "I’m not sure how to answer that yet, but I can help with bookings, rooms, and resort info.",
        },
      ]);
    } catch {
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: "assistant",
          content:
            "Sorry, I’m having trouble connecting right now. Please try again in a moment.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="w-[min(92vw,24rem)] overflow-hidden rounded-3xl border border-white/20 bg-neutral/95 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-white/10 bg-linear-to-r from-primary to-secondary px-5 py-4 text-base">
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-base/70">MarVille Assistant</p>
              <h2 className="text-xl font-bold text-base">ChatBot Mars</h2>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full bg-base/15 px-3 py-1 text-sm font-semibold text-base transition hover:bg-base/25"
              aria-label="Close ChatBot Mars"
            >
              Close
            </button>
          </div>

          <div className="max-h-112 space-y-4 overflow-y-auto px-4 py-5">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    message.role === "user"
                      ? "bg-primary text-base"
                      : "bg-white/10 text-white"
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-white/10 px-4 py-3 text-sm text-white/70">
                  Typing...
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={handleSubmit} className="border-t border-white/10 p-4">
            <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-white/50">
              Ask ChatBot Mars
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask about rooms, rates, or booking..."
                className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/40 outline-none transition focus:border-accent"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="rounded-full bg-accent px-5 py-3 text-sm font-semibold text-base transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Send
              </button>
            </div>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="group flex items-center gap-3 rounded-full bg-linear-to-r from-primary via-secondary to-accent px-5 py-4 text-base shadow-[0_18px_40px_rgba(0,0,0,0.28)] transition-transform hover:scale-[1.03]"
        aria-label="Open ChatBot Mars"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-base/15 text-xl font-black text-base">
          M
        </span>
        <span className="text-left">
          <span className="block text-xs uppercase tracking-[0.22em] text-base/70">
            Resort AI
          </span>
          <span className="block text-lg font-bold text-base">ChatBot Mars</span>
        </span>
      </button>
    </div>
  );
}
