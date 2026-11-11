"use client";

import Image from "next/image";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useSiteContent } from "@/components/content/SiteContent";
import { configuredFaqs, validFacebookChatUrl } from "@/lib/chatbot/config";

type ChatMessage = {
  role: "assistant" | "user";
  content: string;
  supportLink?: { label: string; url: string };
};

const CHATBOT_ENABLED = true;
const quickQuestions = ["Show me services", "How do I book?", "What are your swimming rates?", "How do payments work?", "Can I reschedule?"];

export default function ChatBotMars() {
  const settings = useSiteContent();
  const faqQuestions = [...new Set([...quickQuestions, ...Object.keys(configuredFaqs(settings))])];
  const [showSupportForm, setShowSupportForm] = useState(false);
  const [supportReason, setSupportReason] = useState("");
  const [supportReference, setSupportReference] = useState("");
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [viewport, setViewport] = useState<{ height: number; top: number } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hi, I’m ChatBot Mars. I can help with booking steps, rates, payments, and resort policies. What would you like to know?",
    },
  ]);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const transcript = messagesRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [messages, open, loading, showSupportForm, viewport?.height]);

  useEffect(() => {
    if (!open) return;
    const visualViewport = window.visualViewport;
    if (!visualViewport) return;
    const updateViewport = () => setViewport({ height: visualViewport.height, top: visualViewport.offsetTop });
    updateViewport();
    visualViewport.addEventListener("resize", updateViewport);
    visualViewport.addEventListener("scroll", updateViewport);
    return () => {
      visualViewport.removeEventListener("resize", updateViewport);
      visualViewport.removeEventListener("scroll", updateViewport);
    };
  }, [open]);

  if (!CHATBOT_ENABLED) {
    return null;
  }

  const sendMessage = async (question: string) => {
    const trimmedInput = question.trim();
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
        body: JSON.stringify({ message: trimmedInput, history: messages.slice(1).slice(-8) }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to get a reply.");
      }

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: "assistant",
          ...(data.supportLink?.url && validFacebookChatUrl(data.supportLink.url) ? { supportLink: data.supportLink } : {}),
          content:
            data.reply ||
            "I’m not sure how to answer that yet, but I can help with bookings, rooms, and resort info.",
        },
      ]);
    } catch (error) {
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: "assistant",
          content:
            error instanceof Error ? error.message : "Sorry, I’m having trouble connecting right now. Please try again in a moment.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendMessage(input);
  };

  return (
    <div
      className={open
        ? "pointer-events-none fixed inset-x-0 top-0 z-50 flex h-dvh items-end justify-end p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-5"
        : "fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-3 z-50 sm:bottom-5 sm:right-5"}
      style={open && viewport ? { height: viewport.height, top: viewport.top } : undefined}
    >
      {open && (
        <section aria-label="ChatBot Mars conversation" className="pointer-events-auto flex h-full max-h-[42rem] w-full max-w-96 min-w-0 flex-col overflow-hidden rounded-3xl border border-white/20 bg-neutral/95 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-linear-to-r from-primary to-secondary px-4 py-2 text-base">
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-base/70 [@media(max-height:500px)]:hidden">MarVille Assistant</p>
              <h2 className="text-xl font-bold text-base">ChatBot Mars</h2>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-11 rounded-full bg-base/15 px-3 py-1 text-sm font-semibold text-base transition hover:bg-base/25"
              aria-label="Close ChatBot Mars"
            >
              Close
            </button>
          </div>

          <div ref={messagesRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4" role="log" aria-label="Chat messages" aria-live="polite" aria-busy={loading}>
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[90%] wrap-anywhere rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    message.role === "user"
                      ? "bg-primary text-base"
                      : "bg-white/10 text-white"
                  } whitespace-pre-wrap`}
                >
                  {message.content}
                  {message.supportLink && <a href={message.supportLink.url} target="_blank" rel="noopener noreferrer" className="mt-3 block rounded-lg border border-white/40 bg-primary px-3 py-2 font-semibold text-white underline hover:bg-primary/80">{message.supportLink.label}</a>}
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
            {showSupportForm && <form id="chatbot-human-support" className="space-y-2 rounded-2xl border border-white/20 p-3 text-sm text-white" onSubmit={event => {
              event.preventDefault(); if (loading || supportReason.trim().length < 5) return;
              const question = `I need human support. Reason: ${supportReason.trim()}${supportReference.trim() ? ` Booking reference: ${supportReference.trim()}` : ""}`;
              setShowSupportForm(false); setSupportReason(""); setSupportReference(""); void sendMessage(question);
            }}>
              <label className="block text-xs">What do you need help with?<textarea required minLength={5} maxLength={700} value={supportReason} onChange={event => setSupportReason(event.target.value)} className="mt-1 w-full rounded-lg border border-white/30 bg-white/10 p-2 text-white" /></label>
              <label className="block text-xs">Booking reference (optional)<input maxLength={40} value={supportReference} onChange={event => setSupportReference(event.target.value)} className="mt-1 w-full rounded-lg border border-white/30 bg-white/10 p-2 text-white" /></label>
              <button type="submit" disabled={loading || supportReason.trim().length < 5} className="min-h-11 rounded-lg bg-primary px-3 font-semibold disabled:opacity-50">Request human support</button>
            </form>}
          </div>

          <div role="group" aria-label="FAQ shortcuts" tabIndex={0} className="flex shrink-0 gap-2 overflow-x-auto overscroll-x-contain border-t border-white/10 px-3 py-2 text-xs text-white/85">
            <button type="button" disabled={loading} aria-expanded={showSupportForm} aria-controls="chatbot-human-support" onClick={() => setShowSupportForm(value => !value)} className="min-h-11 shrink-0 whitespace-nowrap rounded-full border border-white/30 px-3 font-semibold hover:bg-white/10 disabled:opacity-50">Talk to a resort employee</button>
            {faqQuestions.map((question) => (
              <button key={question} type="button" disabled={loading} onClick={() => void sendMessage(question)} className="min-h-11 shrink-0 whitespace-nowrap rounded-full border border-white/20 px-3 hover:bg-white/10 disabled:opacity-50">
                {question}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="shrink-0 border-t border-white/10 p-3">
            <label htmlFor="chatbot-message" className="sr-only">
              Ask ChatBot Mars
            </label>
            <div className="flex gap-2">
              <input
                id="chatbot-message"
                type="text"
                value={input}
                maxLength={1000}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask about rooms, rates, or booking..."
                className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/10 px-4 py-3 text-base text-white placeholder:text-white/40 outline-none transition focus:border-accent sm:text-sm"
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
        </section>
      )}

      {!open && <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="group flex items-center gap-3 rounded-full bg-linear-to-r from-primary via-secondary to-accent px-5 py-4 text-base shadow-[0_18px_40px_rgba(0,0,0,0.28)] transition-transform hover:scale-[1.03]"
        aria-label="Open ChatBot Mars"
      >
        <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-base/20 bg-base/90">
          <Image
            src="/chatbot-icon/mars_chatbot.png"
            alt="ChatBot Mars avatar"
            width={44}
            height={44}
            className="h-full w-full object-cover"
          />
        </span>
        <span className="text-left">
          <span className="block text-xs uppercase tracking-[0.22em] text-base/70">
            Resort AI
          </span>
          <span className="block text-lg font-bold text-base">ChatBot Mars</span>
        </span>
      </button>}
    </div>
  );
}
