'use client';

import { useState, useEffect } from 'react';
import { HeaderBar } from './HeaderBar';
import { SideNav } from './SideNav';
import { ToastProvider, useToast } from '@/components/shared/Toast';
import { useWebSocket } from '@/lib/hooks';

interface AppLayoutProps {
  children: React.ReactNode;
}

// Component that listens for socket events and shows toasts
function SocketToastListener() {
  const { showToast } = useToast();
  const { onCommitmentCreated, onReminderCreated } = useWebSocket();

  useEffect(() => {
    const unsubCommitment = onCommitmentCreated((data) => {
      showToast(`Scheduled: ${data.title}`, 'success', 6000);
    });

    const unsubReminder = onReminderCreated((data) => {
      showToast(`Reminder set: ${data.title}`, 'info', 6000);
    });

    return () => {
      unsubCommitment();
      unsubReminder();
    };
  }, [onCommitmentCreated, onReminderCreated, showToast]);

  return null;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [isSideNavOpen, setIsSideNavOpen] = useState(false);
  const [isSideNavCollapsed, setIsSideNavCollapsed] = useState(false);

  // Close mobile nav on resize to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setIsSideNavOpen(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Prevent body scroll when mobile nav is open
  useEffect(() => {
    if (isSideNavOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isSideNavOpen]);

  return (
    <ToastProvider>
      <SocketToastListener />
      <div className="h-screen flex flex-col bg-background overflow-hidden">
        {/* Header */}
        <HeaderBar
          onMenuToggle={() => setIsSideNavOpen(!isSideNavOpen)}
          isSideNavOpen={isSideNavOpen}
        />

        {/* Main content area with sidebar */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
          <SideNav
            isOpen={isSideNavOpen}
            onClose={() => setIsSideNavOpen(false)}
            isCollapsed={isSideNavCollapsed}
            onToggleCollapse={() => setIsSideNavCollapsed(!isSideNavCollapsed)}
          />

          {/* Page content */}
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
