import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, Share, X, PlusSquare } from "lucide-react";
import { useInstallPrompt } from "../hooks/useInstallPrompt";
import toast from "react-hot-toast";

// Drop this anywhere — it hides itself automatically once the app is
// already installed, or on a browser that never offers an install prompt.
export default function InstallPWA({ className = "" }) {
  const { isInstallable, isInstalled, isIOSSafari, promptInstall } = useInstallPrompt();
  const [showIOSSheet, setShowIOSSheet] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (isInstalled || dismissed) return null;
  if (!isInstallable && !isIOSSafari) return null;

  const handleClick = async () => {
    if (isIOSSafari) {
      setShowIOSSheet(true);
      return;
    }
    const outcome = await promptInstall();
    if (outcome === "accepted") toast.success("Drivo installed!");
  };

  return (
    <>
      <button
        onClick={handleClick}
        className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-semibold
          bg-zinc-100 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300
          border border-zinc-200 dark:border-zinc-700
          hover:border-brand dark:hover:border-brand hover:text-brand
          transition-all duration-200 active:scale-[0.97] ${className}`}
      >
        <Download className="w-4 h-4" />
        Install app
      </button>

      <AnimatePresence>
        {showIOSSheet && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center sm:justify-center"
            onClick={() => setShowIOSSheet(false)}
          >
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full sm:w-96 sm:rounded-3xl rounded-t-3xl bg-white dark:bg-zinc-900 p-6 pb-8"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-700 text-lg text-zinc-900 dark:text-white">
                  Install Drivo
                </h3>
                <button onClick={() => setShowIOSSheet(false)}>
                  <X className="w-5 h-5 text-zinc-400" />
                </button>
              </div>
              <ol className="space-y-4 text-sm text-zinc-600 dark:text-zinc-300">
                <li className="flex items-center gap-3">
                  <span className="flex-shrink-0 w-7 h-7 rounded-full bg-brand-light dark:bg-brand/15 text-brand flex items-center justify-center text-xs font-bold">1</span>
                  Tap the <Share className="inline w-4 h-4 mx-1" /> Share icon in Safari's toolbar
                </li>
                <li className="flex items-center gap-3">
                  <span className="flex-shrink-0 w-7 h-7 rounded-full bg-brand-light dark:bg-brand/15 text-brand flex items-center justify-center text-xs font-bold">2</span>
                  Scroll down and tap <PlusSquare className="inline w-4 h-4 mx-1" /> "Add to Home Screen"
                </li>
                <li className="flex items-center gap-3">
                  <span className="flex-shrink-0 w-7 h-7 rounded-full bg-brand-light dark:bg-brand/15 text-brand flex items-center justify-center text-xs font-bold">3</span>
                  Tap "Add" — Drivo will appear on your home screen
                </li>
              </ol>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}