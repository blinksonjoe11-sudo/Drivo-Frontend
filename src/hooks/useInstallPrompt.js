import { useEffect, useState, useCallback } from "react";

// Wraps the browser's native "Add to Home Screen" flow.
//
// The browser fires `beforeinstallprompt` only when the app qualifies as
// installable (served over HTTPS, has a manifest + service worker, not
// already installed). We stash that event so we can trigger the native
// install dialog later, from our own button, instead of a browser toolbar icon.
export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Already running as an installed PWA (standalone display mode)?
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      window.navigator.standalone === true; // iOS Safari
    setIsInstalled(standalone);

    const onBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    };

    const onAppInstalled = () => {
      setIsInstalled(true);
      setIsInstallable(false);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return null;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setIsInstallable(false);
    return outcome; // "accepted" | "dismissed"
  }, [deferredPrompt]);

  // iOS Safari never fires beforeinstallprompt — there's no programmatic
  // install API there, so the UI has to show manual "Share → Add to Home
  // Screen" instructions instead of a one-tap button.
  const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  const isIOSSafari =
    isIOS && /safari/i.test(window.navigator.userAgent) && !/crios|fxios/i.test(window.navigator.userAgent);

  return {
    isInstallable,
    isInstalled,
    isIOSSafari,
    promptInstall,
  };
}