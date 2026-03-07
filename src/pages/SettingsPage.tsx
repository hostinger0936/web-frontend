// src/pages/SettingsPage.tsx
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getGlobalPhone, setGlobalPhone, getAdminLogin, saveAdminLogin } from "../services/api/admin";
import { STORAGE_KEYS } from "../config/constants";
import pageBg from "../assets/login-bg.png";

/**
 * SettingsPage.tsx — TECH GLASS (UPDATED)
 * - Removed "Test Backend" button
 * - Removed API Base display
 * - Removed "Local Settings (Browser)" card
 * - Only: Global Admin Phone + Change Password
 * - "Clear" renamed to "Clear from Server"
 * - Clicking "Clear from Server" now saves empty value to server
 */

function safeTrim(v: any) {
  return (v ?? "").toString().trim();
}

function normalizePhone(raw: string) {
  const s = safeTrim(raw);
  if (!s) return "";
  const keepPlus = s.startsWith("+");
  const digits = s.replace(/[^0-9]/g, "");
  if (!digits) return "";
  return keepPlus ? `+${digits}` : digits;
}

function TechGlassCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-[26px] ${className}`}>
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -inset-6 rounded-[34px] bg-cyan-400/14 blur-3xl" />
      </div>

      <div className="pointer-events-none absolute inset-0 rounded-[26px] border border-white/14" />
      <div className="pointer-events-none absolute inset-0 rounded-[26px] border border-cyan-200/10" />

      <div className="pointer-events-none absolute left-3 top-3 h-6 w-6 rounded-tl-[10px] border-l-2 border-t-2 border-cyan-200/50" />
      <div className="pointer-events-none absolute right-3 top-3 h-6 w-6 rounded-tr-[10px] border-r-2 border-t-2 border-cyan-200/50" />
      <div className="pointer-events-none absolute bottom-3 left-3 h-6 w-6 rounded-bl-[10px] border-b-2 border-l-2 border-cyan-200/50" />
      <div className="pointer-events-none absolute bottom-3 right-3 h-6 w-6 rounded-bl-[10px] border-b-2 border-r-2 border-cyan-200/50" />

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

function GlassInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-[13px] font-extrabold text-white/80">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        type={type}
        disabled={disabled}
        className={[
          "h-11 w-full rounded-2xl px-4 text-[14px]",
          "border border-white/[0.14] bg-white/[0.06]",
          "text-white placeholder:text-white/35",
          "backdrop-blur-2xl outline-none",
          "focus:border-cyan-200/50 focus:ring-2 focus:ring-cyan-400/20",
          disabled ? "cursor-not-allowed opacity-70" : "",
        ].join(" ")}
      />
    </div>
  );
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(false);

  const [savingPhone, setSavingPhone] = useState(false);
  const [savingPass, setSavingPass] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [globalPhone, setGlobalPhoneVal] = useState("");

  const [storedUser, setStoredUser] = useState("");
  const [storedPass, setStoredPass] = useState("");

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const effectiveUsername = useMemo(() => {
    const localU = safeTrim(localStorage.getItem(STORAGE_KEYS.USERNAME) || "");
    return safeTrim(storedUser) || localU || "admin";
  }, [storedUser]);

  async function loadAll() {
    setLoading(true);
    setError(null);
    setOkMsg(null);

    try {
      const [phone, login] = await Promise.all([getGlobalPhone().catch(() => ""), getAdminLogin().catch(() => null)]);

      setGlobalPhoneVal(phone || "");

      const u = safeTrim((login as any)?.username);
      const p = safeTrim((login as any)?.password);
      setStoredUser(u);
      setStoredPass(p);
    } catch (e) {
      console.error("Settings load failed", e);
      setError("Failed to load settings from server.");
    } finally {
      setLoading(false);
    }
  }

  async function savePhone() {
    setSavingPhone(true);
    setError(null);
    setOkMsg(null);

    try {
      const cleaned = normalizePhone(globalPhone);
      await setGlobalPhone(cleaned);
      setGlobalPhoneVal(cleaned);
      setOkMsg("Global phone saved.");
    } catch (e: any) {
      console.error("save globalPhone failed", e);
      setError(e?.response?.data?.error || "Failed to save global phone.");
    } finally {
      setSavingPhone(false);
    }
  }

  async function clearPhoneFromServer() {
    setSavingPhone(true);
    setError(null);
    setOkMsg(null);

    try {
      await setGlobalPhone("");
      setGlobalPhoneVal("");
      setOkMsg("Global phone cleared from server.");
    } catch (e: any) {
      console.error("clear globalPhone failed", e);
      setError(e?.response?.data?.error || "Failed to clear global phone from server.");
    } finally {
      setSavingPhone(false);
    }
  }

  async function handleChangePassword() {
    setSavingPass(true);
    setError(null);
    setOkMsg(null);

    try {
      const oldP = safeTrim(oldPassword);
      const newP = safeTrim(newPassword);
      const confP = safeTrim(confirmPassword);

      if (!newP) {
        setError("New password required");
        return;
      }
      if (newP !== confP) {
        setError("Confirm password does not match");
        return;
      }

      const login = await getAdminLogin().catch(() => null);
      const u = safeTrim((login as any)?.username) || effectiveUsername;
      const p = safeTrim((login as any)?.password) || storedPass;

      if (!u) {
        setError("Admin username not found. Please login once, then try again.");
        return;
      }

      if (p) {
        if (!oldP) {
          setError("Old password required");
          return;
        }
        if (oldP !== p) {
          setError("Old password is incorrect");
          return;
        }
      }

      await saveAdminLogin(u, newP);

      setStoredUser(u);
      setStoredPass(newP);

      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");

      setOkMsg("Password updated.");
    } catch (e: any) {
      console.error("change password failed", e);
      setError(e?.response?.data?.error || "Failed to change password.");
    } finally {
      setSavingPass(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative min-h-[100svh] w-full overflow-x-hidden bg-black">
      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${pageBg})` }} />
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/15 to-black/45" />
      <div className="absolute inset-0 shadow-[inset_0_0_240px_rgba(0,0,0,0.60)]" />

      <div className="pointer-events-none absolute inset-0 opacity-35">
        <div className="absolute left-1/2 top-[-96px] h-[460px] w-[460px] -translate-x-1/2 rounded-full bg-cyan-400/16 blur-3xl" />
        <div className="absolute left-[-120px] top-[35%] h-[360px] w-[360px] rounded-full bg-blue-400/10 blur-3xl" />
        <div className="absolute bottom-[-140px] right-[-140px] h-[420px] w-[420px] rounded-full bg-cyan-300/12 blur-3xl" />
      </div>

      <div className="relative mx-auto w-full max-w-[420px] px-3 pb-24 pt-4">
        <TechGlassCard>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[22px] font-extrabold tracking-tight text-white">Settings</div>
              <div className="text-[12px] text-white/60">Global number + password</div>
            </div>

            <button
              onClick={loadAll}
              className="h-10 rounded-2xl border border-white/14 bg-white/[0.06] px-4 text-white/85 backdrop-blur-2xl hover:bg-white/[0.09]"
              type="button"
              title="Refresh"
            >
              ↻
            </button>
          </div>

          {(error || okMsg) && (
            <div className="mt-4">
              {error ? (
                <div className="rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-2 text-sm text-red-100">
                  {error}
                </div>
              ) : null}
              {okMsg ? (
                <div className="mt-2 rounded-2xl border border-green-400/25 bg-green-500/10 px-4 py-2 text-sm text-green-100">
                  {okMsg}
                </div>
              ) : null}
            </div>
          )}

          {loading ? (
            <div className="mt-4 rounded-3xl border border-white/14 bg-white/[0.05] p-5 text-center text-white/70 backdrop-blur-2xl">
              Loading…
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="rounded-3xl border border-white/12 bg-white/[0.04] p-4 backdrop-blur-2xl">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[14px] font-extrabold text-white">Global Admin Phone</div>
                    <div className="mt-1 text-[12px] text-white/60">Used for renew / global admin updates</div>
                  </div>
                </div>

                <div className="mt-4">
                  <GlassInput
                    label="Phone"
                    value={globalPhone}
                    onChange={setGlobalPhoneVal}
                    placeholder="+919876543210"
                  />
                  <div className="mt-2 text-[11px] text-white/40">
                    Tip: You can paste with or without spaces. It will be normalized.
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <button
                    onClick={savePhone}
                    disabled={savingPhone}
                    className={[
                      "h-11 flex-1 rounded-2xl border border-cyan-200 bg-cyan-400/90 text-[15px] font-extrabold text-black",
                      "shadow-[0_10px_30px_rgba(34,211,238,0.18)]",
                      "disabled:opacity-60",
                    ].join(" ")}
                    type="button"
                  >
                    {savingPhone ? "Saving…" : "Save"}
                  </button>

                  <button
                    onClick={clearPhoneFromServer}
                    disabled={savingPhone}
                    className="h-11 rounded-2xl border border-red-400/25 bg-red-500/10 px-4 text-white/90 hover:bg-red-500/14 disabled:opacity-60"
                    type="button"
                    title="Clear value from server"
                  >
                    {savingPhone ? "Please wait…" : "Clear from Server"}
                  </button>
                </div>
              </div>

              <div className="rounded-3xl border border-white/12 bg-white/[0.04] p-4 backdrop-blur-2xl">
                <div className="text-[14px] font-extrabold text-white">Change Password</div>
                <div className="mt-1 text-[12px] text-white/60">Username stays same</div>

                <div className="mt-4 space-y-3">
                  <GlassInput label="Username" value={effectiveUsername} disabled />

                  <GlassInput
                    label="Old Password"
                    value={oldPassword}
                    onChange={setOldPassword}
                    placeholder="Enter old password"
                    type="password"
                  />

                  <GlassInput
                    label="New Password"
                    value={newPassword}
                    onChange={setNewPassword}
                    placeholder="Enter new password"
                    type="password"
                  />

                  <GlassInput
                    label="Confirm Password"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    placeholder="Re-enter new password"
                    type="password"
                  />
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <button
                    onClick={handleChangePassword}
                    disabled={savingPass}
                    className={[
                      "h-11 flex-1 rounded-2xl border border-cyan-200 bg-cyan-400/90 text-[15px] font-extrabold text-black",
                      "shadow-[0_10px_30px_rgba(34,211,238,0.18)]",
                      "disabled:opacity-60",
                    ].join(" ")}
                    type="button"
                  >
                    {savingPass ? "Updating…" : "Update Password"}
                  </button>

                  <button
                    onClick={() => {
                      setOldPassword("");
                      setNewPassword("");
                      setConfirmPassword("");
                      setError(null);
                      setOkMsg(null);
                    }}
                    className="h-11 rounded-2xl border border-white/14 bg-white/[0.06] px-4 text-white/85 hover:bg-white/[0.09]"
                    type="button"
                  >
                    Clear
                  </button>
                </div>

                <div className="mt-2 text-[11px] text-white/40">
                  Note: If server has no saved password yet, old password is not required.
                </div>
              </div>
            </div>
          )}
        </TechGlassCard>
      </div>
    </div>
  );
}