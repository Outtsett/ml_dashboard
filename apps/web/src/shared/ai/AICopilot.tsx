import React, { useState, useRef, useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Bot, X, MessageSquare, Send } from "lucide-react";
import { ScrollArea } from "@/shared/ui/scroll-area";
import ReactMarkdown from 'react-markdown';
import { markdownComponents } from '../../claude/markdown';
import { cn } from "@/shared/utils/utils";

export function AICopilot() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  
  // @ts-expect-error - Vercel AI SDK signature mismatch
  const { messages, append, status } = useChat({
    // Vercel AI SDK 4.x useChat usage
    initialMessages: [
      {
        id: '1',
        role: 'assistant',
        content: 'Hello! I am your AI Copilot. How can I assist you with your quant data or dashboard today?'
      }
    ]
    // `initialMessages` is not on the hook's declared options type in this SDK
    // version, but the runtime still honours it, so the object is asserted
    // rather than the seed message being dropped.
  } as unknown as Parameters<typeof useChat>[0]);

  const isLoading = status === 'submitted' || status === 'streaming';
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    
    // In @ai-sdk/react v4, append accepts a message object
    append({ role: 'user', content: input });
    setInput("");
  };

  return (
    <>
      {/* Floating Action Button */}
      {!isOpen && (
        <Button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg border border-primary/50 bg-background hover:bg-muted p-0 flex items-center justify-center z-50 transition-all duration-300"
          title="Open AI Copilot"
        >
          <Bot className="h-6 w-6 text-primary" />
        </Button>
      )}

      {/* Chat Widget */}
      {isOpen && (
        <Card className="fixed bottom-6 right-6 w-[400px] h-[600px] shadow-2xl flex flex-col z-50 glass border border-white/10 animate-in slide-in-from-bottom-5 fade-in-50">
          <CardHeader className="flex flex-row items-center justify-between py-3 px-4 border-b border-white/10 bg-black/40 backdrop-blur-md">
            <div className="flex items-center space-x-2">
              <Bot className="h-5 w-5 text-primary" />
              <CardTitle className="text-sm font-mono tracking-wider">AI Copilot</CardTitle>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          
          <CardContent className="flex-1 p-0 overflow-hidden flex flex-col">
            <ScrollArea className="flex-1 p-4 custom-scrollbar" ref={scrollRef}>
              <div className="space-y-4">
                {messages.map((m) => {
                  // The SDK carries a turn's text under `parts` in this version
                  // and under `content` in the one the server streams for, so
                  // the field is read defensively rather than assumed.
                  const content = (m as { content?: unknown }).content;
                  return (
                  <div
                    key={m.id}
                    className={cn(
                      "flex w-max max-w-[85%] flex-col gap-2 rounded-lg px-3 py-2 text-sm",
                      m.role === 'user' 
                        ? "ml-auto bg-primary text-primary-foreground font-sans" 
                        : "bg-muted/50 border border-white/5 font-sans"
                    )}
                  >
                    <div className="flex items-center space-x-2 opacity-70 mb-1">
                      {m.role === 'user' ? (
                        <MessageSquare className="h-3 w-3" />
                      ) : (
                        <Bot className="h-3 w-3" />
                      )}
                      <span className="text-[10px] uppercase font-mono tracking-wider">
                        {m.role === 'user' ? 'You' : 'Copilot'}
                      </span>
                    </div>
                    <div className="prose prose-invert prose-sm max-w-none">
                      {typeof content === 'string' && content ? (
                        <ReactMarkdown components={markdownComponents}>{content}</ReactMarkdown>
                      ) : (
                        <ReactMarkdown components={markdownComponents}>{JSON.stringify(content ?? "")}</ReactMarkdown>
                      )}
                    </div>
                  </div>
                  );
                })}
                {isLoading && (
                  <div className="flex w-max max-w-[85%] flex-col gap-2 rounded-lg px-3 py-2 text-sm bg-muted/50 border border-white/5">
                    <div className="flex items-center space-x-2 text-muted-foreground">
                      <div className="h-2 w-2 bg-primary rounded-full animate-bounce" />
                      <div className="h-2 w-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                      <div className="h-2 w-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
          
          <CardFooter className="p-3 border-t border-white/10 bg-black/40 backdrop-blur-md">
            <form onSubmit={handleSubmit} className="flex w-full items-center space-x-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about your data..."
                className="flex-1 bg-background/50 font-sans"
                disabled={isLoading}
              />
              <Button type="submit" size="icon" disabled={isLoading || !input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </CardFooter>
        </Card>
      )}
    </>
  );
}
