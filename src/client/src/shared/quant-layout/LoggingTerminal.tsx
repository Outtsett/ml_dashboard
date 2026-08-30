import { useEffect, useRef } from 'react';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

interface LoggingTerminalProps {
  logs: LogEntry[];
  title?: string;
}

export function LoggingTerminal({ logs, title = "System Logs" }: LoggingTerminalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a] border border-neutral-800 rounded shadow-sm overflow-hidden font-mono">
      <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 bg-[#111111]">
        <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">{title}</h3>
        <div className="flex gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-neutral-700"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-neutral-600"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-neutral-500"></div>
        </div>
      </div>
      
      <div ref={scrollRef} className="flex-grow p-4 overflow-y-auto text-xs leading-relaxed">
        {logs.length === 0 ? (
          <div className="text-neutral-600 italic">Waiting for events...</div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex mb-1.5 gap-3 hover:bg-[#1a1a1a] px-1 py-0.5 rounded transition-colors break-all">
              <span className="text-neutral-500 shrink-0 select-none">
                {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 })}
              </span>
              <span className={`shrink-0 w-12 font-semibold select-none ${
                log.level === 'error' ? 'text-(--color-data-cat-6)' :
                log.level === 'warn' ? 'text-(--color-data-warn)' :
                log.level === 'debug' ? 'text-neutral-500' :
                'text-(--color-data-cat-5)'
              }`}>
                [{log.level.toUpperCase()}]
              </span>
              <span className="text-neutral-300 whitespace-pre-wrap">
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
