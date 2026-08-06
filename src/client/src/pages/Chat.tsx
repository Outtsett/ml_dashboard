/**
 * Chat — top-level page wrapping the existing ChatTab panel.
 *
 * Promoted from the Market Data IntegratedTabs "Chat" sub-tab so the LLM
 * chat is reachable from anywhere in the app via /chat.
 */
import { ChatTab } from '@/portfolio/components/chat/ChatTab';
import { useBreadcrumbs } from '@/shared/hooks/useBreadcrumbs';

export default function Chat() {
  useBreadcrumbs([{ label: 'Chat' }]);
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <ChatTab />
    </div>
  );
}
