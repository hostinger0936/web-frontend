// src/components/layout/MobileBottomNav.tsx
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { createPortal } from "react-dom";

/**
 * MobileBottomNav.tsx — ALWAYS FIXED (REAL DEVICE SAFE)
 *
 * Fixes real-device behavior where bottom bar appears to hide/show while scrolling
 * due to mobile browser UI (visual viewport) changes.
 *
 * - Renders into document.body (portal) to escape transformed parents
 * - Uses visualViewport to keep nav pinned to *visible* bottom during scroll
 * - Safe-area padding for iOS
 */

type Item = { label: string; path: string; icon: string; end?: boolean };

const items: Item[] = [
  { label: "Home", path: "/", icon: "▦", end: true },
  { label: "Devices", path: "/devices", icon: "📱" },
  { label: "Forms", path: "/forms", icon: "🧾" },
  { label: "SMS", path: "/sms", icon: "💬" },
  { label: "More", path: "/settings", icon: "⚙️" },
];

export default function MobileBottomNav() {
  const [mounted, setMounted] = useState(false);
  const [vvShift, setVvShift] = useState(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Keep bar pinned to the visible viewport bottom (real device scroll UI hide/show fix)
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    let raf = 0;

    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // When browser UI shows/hides, visualViewport height/offset changes.
        // Shift the bar up by the "hidden" portion so it stays visible.
        const bottomInset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        setVvShift(bottomInset);
      });
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);

    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  if (!mounted) return null;

  return createPortal(
    <nav
      className={[
        "md:hidden",
        "fixed inset-x-0 bottom-0 z-[9999]",
        "bg-white/95 backdrop-blur-xl",
        "border-t border-black/10",
        "shadow-[0_-10px_30px_rgba(0,0,0,0.08)]",
        "touch-manipulation",
      ].join(" ")}
      style={{
        // iOS safe area
        paddingBottom: "env(safe-area-inset-bottom)",
        // shift up when browser UI overlaps the bottom area (real device fix)
        transform: `translate3d(0, ${-vvShift}px, 0)`,
        WebkitTransform: `translate3d(0, ${-vvShift}px, 0)`,
        willChange: "transform",
      }}
    >
      <div className="grid grid-cols-5 px-1">
        {items.map((it) => (
          <NavLink
            key={it.path}
            to={it.path}
            end={!!it.end}
            className={({ isActive }) =>
              [
                "flex flex-col items-center justify-center",
                "py-2",
                "text-xs select-none",
                isActive ? "text-[var(--brand)] font-medium" : "text-gray-600",
              ].join(" ")
            }
          >
            <div className="text-base leading-none">{it.icon}</div>
            <div className="mt-1 leading-none">{it.label}</div>
          </NavLink>
        ))}
      </div>
    </nav>,
    document.body
  );
}