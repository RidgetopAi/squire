'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChatWindowV2 } from '@/components/chat-v2';
import { useChatStore } from '@/lib/stores/chatStore';

function ConversationDeepLink() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestedId = searchParams.get('conversationId');
  const lastHandledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!requestedId || lastHandledRef.current === requestedId) return;
    lastHandledRef.current = requestedId;
    useChatStore.getState().loadConversation(requestedId);
    router.replace('/app/chat', { scroll: false });
  }, [requestedId, router]);

  return null;
}

export default function ChatPage() {
  return (
    <>
      <Suspense fallback={null}>
        <ConversationDeepLink />
      </Suspense>
      <ChatWindowV2 />
    </>
  );
}
