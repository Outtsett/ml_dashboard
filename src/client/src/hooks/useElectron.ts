import { useEffect, useRef } from 'react';

export function useElectron() {
  return window.electronAPI ?? null;
}

export function useIsElectron(): boolean {
  return !!window.electronAPI?.isElectron;
}

/** Hook to listen for menu actions dispatched from the native menu. */
export function useMenuAction(handler: (action: string) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    return api.onMenuAction((action) => handlerRef.current(action));
  }, []);
}

/** Hook to listen for global shortcut triggers. */
export function useShortcutListener(handler: (id: string) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    return api.onShortcut((id) => handlerRef.current(id));
  }, []);
}

/** Hook to listen for system power events (suspend, resume, shutdown). */
export function usePowerEvents(handler: (event: 'suspend' | 'resume' | 'shutdown') => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    return api.onPowerEvent((event) => handlerRef.current(event));
  }, []);
}
