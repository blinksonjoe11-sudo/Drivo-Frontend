import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mail,
  Lock,
  User,
  Phone,
  ArrowRight,
  Eye,
  EyeOff,
  Car,
  KeyRound,
  Zap,
  ChevronLeft,
  CheckCircle,
} from "lucide-react";
import { authAPI } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { Btn, Input, Divider } from "../components/ui";
import InstallPWA from "../components/InstallPWA";
import toast from "react-hot-toast";

// Modes: login | register | verify | forgot | reset
export default function Auth() {
  const [mode, setMode] = useState("login");
  const [type, setType] = useState("rider");
  const [showPass, setShowPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    otp: "",
    newPassword: "",
    token: "",
  });

  const { login } = useAuth();
  const { isDark, toggle } = useTheme();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();

  // ── Deep-link / URL token handling ──────────────────────────────────────────
  // When the user taps the reset link in email, the app opens via deep link.
  // Capacitor catches the URL and the app reads ?token= from it.
  // On web the normal URL ?token= param works the same way.
  useEffect(() => {
    const token = searchParams.get("token");
    const resetType = searchParams.get("type"); // "driver" or undefined
    if (token) {
      setForm((f) => ({ ...f, token }));
      if (resetType === "driver") setType("driver");
      setMode("reset");
    }
  }, [searchParams]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // ── Register ─────────────────────────────────────────────────────────────────
  const handleRegister = async () => {
    if (!form.name || !form.email || !form.phone || !form.password)
      return toast.error("Please fill all fields");
    setLoading(true);
    try {
      const fn =
        type === "rider" ? authAPI.registerUser : authAPI.registerDriver;
      await fn({
        name: form.name,
        email: form.email,
        phone: form.phone,
        password: form.password,
      });
      toast.success("OTP sent to your email!");
      setMode("verify");
    } catch (e) {
      toast.error(e.response?.data?.error || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  // ── Verify OTP ────────────────────────────────────────────────────────────────
  const handleVerify = async () => {
    if (!form.otp) return toast.error("Enter the OTP");
    setLoading(true);
    try {
      const fn = type === "rider" ? authAPI.verifyUser : authAPI.verifyDriver;
      await fn({ email: form.email, otp: form.otp });
      toast.success("Email verified! Please log in.");
      setMode("login");
    } catch (e) {
      toast.error(e.response?.data?.error || "Invalid OTP");
    } finally {
      setLoading(false);
    }
  };

  // ── Login ─────────────────────────────────────────────────────────────────────
  const handleLogin = async () => {
    if (!form.email || !form.password)
      return toast.error("Enter email and password");
    setLoading(true);
    try {
      const fn = type === "rider" ? authAPI.loginUser : authAPI.loginDriver;
      const res = await fn({ email: form.email, password: form.password });
      const d = res.data.message;
      const actualRole = d.user.Role || (type === "driver" ? "driver" : "user");
      login(d.user, d.token, actualRole);
      toast.success(`Welcome back, ${d.user.Name}!`);
      if (actualRole === "driver") nav("/driver");
      else if (actualRole === "admin") nav("/admin");
      else nav("/ride");
    } catch (e) {
      toast.error(e.response?.data?.error || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  // ── Forgot password — request reset email ────────────────────────────────────
  const handleForgot = async () => {
    if (!form.email) return toast.error("Enter your email");
    setLoading(true);
    try {
      const fn =
        type === "rider"
          ? authAPI.requestPasswordReset
          : authAPI.requestDriverPasswordReset;
      await fn({ email: form.email });
      toast.success("Reset link sent! Check your email.");
      // Show a confirmation screen — user needs to tap link in email
      setResetDone(true);
    } catch (e) {
      toast.error(e.response?.data?.error || "Email not found");
    } finally {
      setLoading(false);
    }
  };

  // ── Reset password — set new password via token ───────────────────────────────
  const handleReset = async () => {
    if (!form.token) return toast.error("Invalid or expired reset link");
    if (!form.newPassword || form.newPassword.length < 6)
      return toast.error("Password must be at least 6 characters");
    setLoading(true);
    try {
      const fn =
        type === "rider"
          ? authAPI.confirmPasswordReset
          : authAPI.confirmDriverPasswordReset;
      await fn({ token: form.token, new_password: form.newPassword });
      toast.success("Password reset! Please log in.");
      setForm((f) => ({ ...f, token: "", newPassword: "" }));
      setMode("login");
      // Clear token from URL without navigation
      window.history.replaceState({}, "", window.location.pathname);
    } catch (e) {
      toast.error(
        e.response?.data?.error || "Reset failed — link may have expired",
      );
    } finally {
      setLoading(false);
    }
  };

  const features = [
    [
      "🚀",
      "Instant Matching",
      "Get matched with the nearest driver in seconds",
    ],
    ["📍", "Live Tracking", "Watch your driver arrive in real time"],
    ["⭐", "Rated Drivers", "Only verified, top-rated drivers on the platform"],
  ];

  const isDark_ = isDark; // alias for inline styles

  return (
    <div
      className={`min-h-screen flex ${isDark ? "bg-[#0a0a0f]" : "bg-slate-50"} font-sans`}
    >
      {/* Left panel — desktop */}
      <div
        className="hidden lg:flex flex-col justify-between w-[460px] p-12 relative overflow-hidden flex-shrink-0"
        style={{ background: "#0f0f18" }}
      >
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-32 -left-24 w-72 h-72 rounded-full bg-brand/8 blur-3xl" />
          <div className="absolute bottom-32 -right-16 w-80 h-80 rounded-full bg-brand/5 blur-3xl" />
          {[...Array(5)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute w-1.5 h-1.5 rounded-full bg-brand/25"
              style={{ left: `${15 + i * 16}%`, top: `${25 + i * 9}%` }}
              animate={{ y: [-8, 8, -8], opacity: [0.2, 0.7, 0.2] }}
              transition={{
                duration: 2.5 + i * 0.4,
                repeat: Infinity,
                ease: "easeInOut",
                delay: i * 0.35,
              }}
            />
          ))}
        </div>
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-brand rounded-xl flex items-center justify-center">
              <Zap size={18} className="text-black" fill="black" />
            </div>
            <h1 className="text-3xl font-black text-white tracking-tight">
              driv<span className="text-brand">o</span>
            </h1>
          </div>
          <p className="text-zinc-500 mt-2 text-base font-medium ml-0.5">
            Ride Smarter.
          </p>
        </div>
        <div className="space-y-7">
          {features.map(([icon, title, desc], i) => (
            <motion.div
              key={title}
              className="flex gap-4"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 + i * 0.1 }}
            >
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0"
                style={{ background: "rgba(0,200,83,.1)" }}
              >
                {icon}
              </div>
              <div>
                <p className="text-white font-bold">{title}</p>
                <p className="text-zinc-500 text-sm mt-0.5 leading-relaxed">
                  {desc}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
        <p className="text-zinc-700 text-xs">© 2026 Drivo Technologies</p>
      </div>

      {/* Right form */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 min-h-screen overflow-y-auto relative">
        {/* Theme toggle */}
        <button
          onClick={toggle}
          className="absolute top-5 right-5 w-10 h-10 rounded-2xl flex items-center justify-center text-base transition-all"
          style={{
            background: isDark ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.05)",
          }}
        >
          {isDark ? "☀️" : "🌙"}
        </button>

        <InstallPWA className="absolute top-5 left-5" />

        <motion.div
          className="w-full max-w-[400px]"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <div className="flex items-center justify-center gap-2.5 mb-1">
              <div className="w-9 h-9 bg-brand rounded-xl flex items-center justify-center">
                <Zap size={18} className="text-black" fill="black" />
              </div>
              <h1
                className="text-3xl font-black tracking-tight"
                style={{ color: isDark ? "#fff" : "#0a0a0f" }}
              >
                driv<span className="text-brand">o</span>
              </h1>
            </div>
          </div>

          {/* Rider / Driver toggle — hide on reset page (token already sets type) */}
          {mode !== "reset" && (
            <div
              className="flex rounded-2xl p-1 mb-6"
              style={{
                background: isDark
                  ? "rgba(255,255,255,.06)"
                  : "rgba(0,0,0,.05)",
              }}
            >
              {[
                { k: "rider", icon: "🧑", label: "Rider" },
                { k: "driver", icon: "🚗", label: "Driver" },
              ].map(({ k, icon, label }) => (
                <button
                  key={k}
                  onClick={() => {
                    setType(k);
                    setResetDone(false);
                  }}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all ${type === k ? "shadow-sm" : ""}`}
                  style={
                    type === k
                      ? {
                          background: isDark ? "rgba(255,255,255,.08)" : "#fff",
                          color: isDark ? "#fff" : "#0a0a0f",
                        }
                      : {
                          color: isDark
                            ? "rgba(255,255,255,.35)"
                            : "rgba(0,0,0,.4)",
                        }
                  }
                >
                  <span>{icon}</span>
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Tabs: login / register — hide on verify/forgot/reset */}
          {(mode === "login" || mode === "register") && (
            <div
              className="flex gap-1 mb-6"
              style={{
                borderBottom: `1px solid ${isDark ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.07)"}`,
              }}
            >
              {["login", "register"].map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 pb-3 text-sm font-bold capitalize transition-all border-b-2 -mb-px ${mode === m ? "border-brand text-brand" : "border-transparent"}`}
                  style={
                    mode !== m
                      ? {
                          color: isDark
                            ? "rgba(255,255,255,.3)"
                            : "rgba(0,0,0,.35)",
                        }
                      : {}
                  }
                >
                  {m}
                </button>
              ))}
            </div>
          )}

          <AnimatePresence mode="wait">
            <motion.div
              key={mode + type}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.18 }}
              className="space-y-4"
            >
              {/* ── REGISTER ── */}
              {mode === "register" && (
                <>
                  <AuthInput
                    label="Full Name"
                    icon={User}
                    placeholder="John Doe"
                    value={form.name}
                    onChange={set("name")}
                    isDark={isDark}
                  />
                  <AuthInput
                    label="Email"
                    icon={Mail}
                    type="email"
                    placeholder="john@email.com"
                    value={form.email}
                    onChange={set("email")}
                    isDark={isDark}
                  />
                  <AuthInput
                    label="Phone"
                    icon={Phone}
                    placeholder="+2348012345678"
                    value={form.phone}
                    onChange={set("phone")}
                    isDark={isDark}
                  />
                  <PasswordInput
                    label="Password"
                    placeholder="Min 6 characters"
                    value={form.password}
                    onChange={set("password")}
                    show={showPass}
                    onToggle={() => setShowPass((s) => !s)}
                    isDark={isDark}
                  />
                  <Btn size="lg" loading={loading} onClick={handleRegister}>
                    Create Account <ArrowRight size={16} />
                  </Btn>
                </>
              )}

              {/* ── VERIFY OTP ── */}
              {mode === "verify" && (
                <>
                  <div className="text-center py-4">
                    <motion.div
                      className="text-6xl mb-4"
                      animate={{ scale: [1, 1.1, 1] }}
                      transition={{ repeat: 3, duration: 0.5 }}
                    >
                      📧
                    </motion.div>
                    <h2
                      className="text-xl font-black tracking-tight"
                      style={{ color: isDark ? "#fff" : "#0a0a0f" }}
                    >
                      Check your email
                    </h2>
                    <p
                      className="text-sm mt-1.5"
                      style={{
                        color: isDark
                          ? "rgba(255,255,255,.4)"
                          : "rgba(0,0,0,.45)",
                      }}
                    >
                      OTP sent to{" "}
                      <span className="text-brand font-semibold">
                        {form.email}
                      </span>
                    </p>
                  </div>
                  <input
                    className="w-full py-5 rounded-2xl text-center text-4xl tracking-[0.5em] font-bold border-2 border-transparent focus:border-brand focus:outline-none transition-all"
                    style={{
                      background: isDark
                        ? "rgba(255,255,255,.06)"
                        : "rgba(0,0,0,.04)",
                      color: isDark ? "#fff" : "#0a0a0f",
                    }}
                    placeholder="·····"
                    value={form.otp}
                    onChange={set("otp")}
                    maxLength={6}
                  />
                  <Btn size="lg" loading={loading} onClick={handleVerify}>
                    Verify Email <ArrowRight size={16} />
                  </Btn>
                  <BackBtn
                    onClick={() => setMode("register")}
                    label="Back to register"
                  />
                </>
              )}

              {/* ── LOGIN ── */}
              {mode === "login" && (
                <>
                  <AuthInput
                    label="Email"
                    icon={Mail}
                    type="email"
                    placeholder="john@email.com"
                    value={form.email}
                    onChange={set("email")}
                    isDark={isDark}
                  />
                  <div className="space-y-1">
                    <PasswordInput
                      label="Password"
                      placeholder="Your password"
                      value={form.password}
                      onChange={set("password")}
                      show={showPass}
                      onToggle={() => setShowPass((s) => !s)}
                      isDark={isDark}
                      onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                    />
                    <div className="flex justify-end">
                      <button
                        onClick={() => {
                          setMode("forgot");
                          setResetDone(false);
                        }}
                        className="text-xs font-semibold text-brand hover:text-brand/80 transition-colors px-1 py-1"
                      >
                        Forgot password?
                      </button>
                    </div>
                  </div>
                  <Btn size="lg" loading={loading} onClick={handleLogin}>
                    Sign In <ArrowRight size={16} />
                  </Btn>
                  {type === "driver" && (
                    <>
                      <Divider label="new driver?" />
                      <Btn
                        variant="secondary"
                        size="lg"
                        onClick={() => nav("/driver/onboarding")}
                      >
                        Complete Onboarding <Car size={16} />
                      </Btn>
                    </>
                  )}
                </>
              )}

              {/* ── FORGOT PASSWORD ── */}
              {mode === "forgot" && !resetDone && (
                <>
                  <div className="text-center pb-2">
                    <div
                      className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-3"
                      style={{
                        background: isDark
                          ? "rgba(255,255,255,.06)"
                          : "rgba(0,0,0,.04)",
                      }}
                    >
                      🔑
                    </div>
                    <h2
                      className="text-xl font-black tracking-tight"
                      style={{ color: isDark ? "#fff" : "#0a0a0f" }}
                    >
                      Forgot password?
                    </h2>
                    <p
                      className="text-sm mt-1.5"
                      style={{
                        color: isDark
                          ? "rgba(255,255,255,.4)"
                          : "rgba(0,0,0,.45)",
                      }}
                    >
                      Enter your {type === "driver" ? "driver" : "rider"}{" "}
                      account email
                    </p>
                  </div>
                  <AuthInput
                    label="Email"
                    icon={Mail}
                    type="email"
                    placeholder="john@email.com"
                    value={form.email}
                    onChange={set("email")}
                    isDark={isDark}
                  />
                  <Btn size="lg" loading={loading} onClick={handleForgot}>
                    Send Reset Link <ArrowRight size={16} />
                  </Btn>
                  <BackBtn
                    onClick={() => setMode("login")}
                    label="Back to login"
                  />
                </>
              )}

              {/* ── FORGOT — email sent confirmation ── */}
              {mode === "forgot" && resetDone && (
                <div className="text-center py-6 space-y-4">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 300 }}
                  >
                    <div className="w-20 h-20 bg-brand/10 rounded-full flex items-center justify-center text-4xl mx-auto">
                      📬
                    </div>
                  </motion.div>
                  <div>
                    <h2
                      className="text-xl font-black tracking-tight"
                      style={{ color: isDark ? "#fff" : "#0a0a0f" }}
                    >
                      Email sent!
                    </h2>
                    <p
                      className="text-sm mt-2 leading-relaxed"
                      style={{
                        color: isDark
                          ? "rgba(255,255,255,.4)"
                          : "rgba(0,0,0,.45)",
                      }}
                    >
                      Check{" "}
                      <span className="text-brand font-semibold">
                        {form.email}
                      </span>{" "}
                      for a reset link. Tap it and it will open the app
                      automatically.
                    </p>
                  </div>
                  <div
                    className="px-4 py-3 rounded-2xl text-xs leading-relaxed text-left"
                    style={{
                      background: isDark
                        ? "rgba(255,255,255,.04)"
                        : "rgba(0,0,0,.03)",
                      color: isDark ? "rgba(255,255,255,.4)" : "rgba(0,0,0,.5)",
                    }}
                  >
                    💡 The link opens the Drivo app directly via deep link. Make
                    sure the app is installed. The link expires in{" "}
                    <span className="font-semibold">1 hour</span>.
                  </div>
                  <BackBtn
                    onClick={() => setMode("login")}
                    label="Back to login"
                  />
                </div>
              )}

              {/* ── RESET PASSWORD ── */}
              {mode === "reset" && (
                <>
                  <div className="text-center pb-2">
                    <div
                      className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-3"
                      style={{
                        background: isDark
                          ? "rgba(255,255,255,.06)"
                          : "rgba(0,0,0,.04)",
                      }}
                    >
                      🔒
                    </div>
                    <h2
                      className="text-xl font-black tracking-tight"
                      style={{ color: isDark ? "#fff" : "#0a0a0f" }}
                    >
                      Set new password
                    </h2>
                    <p
                      className="text-sm mt-1.5"
                      style={{
                        color: isDark
                          ? "rgba(255,255,255,.4)"
                          : "rgba(0,0,0,.45)",
                      }}
                    >
                      {type === "driver" ? "Driver" : "Rider"} account · choose
                      a strong password
                    </p>
                  </div>

                  {/* Token field — editable in case auto-fill failed */}
                  <div className="space-y-1.5">
                    <label
                      className="text-[11px] font-bold uppercase tracking-widest"
                      style={{
                        color: isDark
                          ? "rgba(255,255,255,.35)"
                          : "rgba(0,0,0,.4)",
                      }}
                    >
                      Reset Token
                    </label>
                    <div
                      className="flex items-center gap-2 px-4 py-3 rounded-2xl border-2 border-transparent"
                      style={{
                        background: isDark
                          ? "rgba(255,255,255,.06)"
                          : "rgba(0,0,0,.04)",
                      }}
                    >
                      <KeyRound
                        size={15}
                        style={{
                          color: isDark
                            ? "rgba(255,255,255,.3)"
                            : "rgba(0,0,0,.3)",
                        }}
                        className="flex-shrink-0"
                      />
                      <input
                        value={form.token}
                        onChange={set("token")}
                        placeholder="Paste token from email"
                        className="flex-1 text-sm font-medium bg-transparent outline-none placeholder-zinc-500 font-mono"
                        style={{
                          color: isDark
                            ? "rgba(255,255,255,.6)"
                            : "rgba(0,0,0,.6)",
                        }}
                      />
                      {form.token && (
                        <CheckCircle
                          size={14}
                          className="text-brand flex-shrink-0"
                        />
                      )}
                    </div>
                  </div>

                  <PasswordInput
                    label="New Password"
                    placeholder="Min 6 characters"
                    value={form.newPassword}
                    onChange={set("newPassword")}
                    show={showNewPass}
                    onToggle={() => setShowNewPass((s) => !s)}
                    isDark={isDark}
                  />
                  <Btn
                    size="lg"
                    loading={loading}
                    onClick={handleReset}
                    disabled={!form.token}
                  >
                    Reset Password <ArrowRight size={16} />
                  </Btn>
                  <BackBtn
                    onClick={() => setMode("login")}
                    label="Back to login"
                  />
                </>
              )}
            </motion.div>
          </AnimatePresence>

          <p
            className="text-center text-xs mt-8"
            style={{
              color: isDark ? "rgba(255,255,255,.2)" : "rgba(0,0,0,.3)",
            }}
          >
            By continuing, you agree to Drivo's{" "}
            <span className="underline cursor-pointer">Terms of Service</span>
          </p>
        </motion.div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function AuthInput({
  label,
  icon: Icon,
  type = "text",
  placeholder,
  value,
  onChange,
  isDark,
  onKeyDown,
}) {
  return (
    <div className="space-y-1.5">
      <label
        className="text-[11px] font-bold uppercase tracking-widest"
        style={{ color: isDark ? "rgba(255,255,255,.35)" : "rgba(0,0,0,.4)" }}
      >
        {label}
      </label>
      <div className="relative">
        <Icon
          className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
          style={{ color: isDark ? "rgba(255,255,255,.25)" : "rgba(0,0,0,.3)" }}
        />
        <input
          type={type}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="w-full pl-11 pr-4 py-3.5 rounded-2xl text-sm font-medium border-2 border-transparent focus:border-brand focus:outline-none transition-all"
          style={{
            background: isDark ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.04)",
            color: isDark ? "#fff" : "#0a0a0f",
          }}
        />
      </div>
    </div>
  );
}

function PasswordInput({
  label,
  placeholder,
  value,
  onChange,
  show,
  onToggle,
  isDark,
  onKeyDown,
}) {
  return (
    <div className="space-y-1.5">
      <label
        className="text-[11px] font-bold uppercase tracking-widest"
        style={{ color: isDark ? "rgba(255,255,255,.35)" : "rgba(0,0,0,.4)" }}
      >
        {label}
      </label>
      <div className="relative">
        <Lock
          className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
          style={{ color: isDark ? "rgba(255,255,255,.25)" : "rgba(0,0,0,.3)" }}
        />
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="w-full pl-11 pr-11 py-3.5 rounded-2xl text-sm font-medium border-2 border-transparent focus:border-brand focus:outline-none transition-all"
          style={{
            background: isDark ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.04)",
            color: isDark ? "#fff" : "#0a0a0f",
          }}
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-4 top-1/2 -translate-y-1/2 transition-colors"
          style={{ color: isDark ? "rgba(255,255,255,.3)" : "rgba(0,0,0,.35)" }}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}

function BackBtn({ onClick, label }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors py-1"
    >
      <ChevronLeft size={14} /> {label}
    </button>
  );
}
