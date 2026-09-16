import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  MapPin,
  Navigation,
  CheckCircle,
  XCircle,
  LogOut,
  Menu,
  Wifi,
  WifiOff,
  Crosshair,
  Users,
  Plus,
  Clock,
  Zap,
  TrendingUp,
} from "lucide-react";
import { rideAPI, driverAPI } from "../services/api";
import { driverWS } from "../services/websocket";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { Btn, Badge, EmptyState, Card, Modal } from "../components/ui";
import DrivoMap from "../components/map/DrivoMap";
import ChatBox from "../components/ChatBox";
import toast from "react-hot-toast";
import { BackgroundGeolocation } from "@capgo/background-geolocation";
import { Network } from "@capacitor/network";
import { Capacitor } from "@capacitor/core";

const S = {
  idle: "idle",
  requested: "requested",
  accepted: "accepted",
  arrived: "arrived",
  ongoing: "ongoing",
  completed: "completed",
};
const KEY = import.meta.env.VITE_MAPTILER_KEY || "";

export default function Driver() {
  const { user, logout } = useAuth();
  const { isDark, toggle } = useTheme();
  const nav = useNavigate();

  const [checkingOnboarding, setCheckingOnboarding] = useState(true);
  const [stage, setStage] = useState(S.idle);
  const [isOnline, setIsOnline] = useState(false);
  const [ride, setRide] = useState(null);
  const [driverPos, setDriverPos] = useState(null);
  const [speed, setSpeed] = useState(null);
  const [profile, setProfile] = useState(null);
  const [history, setHistory] = useState([]);
  const [scheduledRides, setScheduledRides] = useState([]);
  const [panel, setPanel] = useState("ride");
  const [wsOk, setWsOk] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [timeLeft, setTimeLeft] = useState(20);
  const [todayEarnings, setTodayEarnings] = useState(0);
  const [chatActive, setChatActive] = useState(false);
  const [poolModalOpen, setPoolModalOpen] = useState(false);
  const [myPool, setMyPool] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const watchId = useRef(null);
  const countdown = useRef(null);
  const firstFix = useRef(false);
  const bgRunning = useRef(false);

  // Onboarding
  useEffect(() => {
    const check = async () => {
      try {
        const r = await driverAPI.getProfile();
        const p = r.data.driver;
        if (!p.IsOnboardingCompleted) {
          toast("Complete onboarding to start driving 🚗", { icon: "📋" });
          setTimeout(() => nav("/driver/onboarding", { replace: true }), 100);
          return;
        }
        setProfile(p);
      } catch {
      } finally {
        setCheckingOnboarding(false);
      }
    };
    check();
  }, []);

  // Persist
  useEffect(() => {
    const ss = localStorage.getItem("drivo_driver_stage");
    const sr = localStorage.getItem("drivo_driver_ride");
    if (ss && ss !== "idle") setStage(ss);
    try {
      if (sr) setRide(JSON.parse(sr));
    } catch {}
  }, []);

  useEffect(() => {
    if (stage === "idle") {
      localStorage.removeItem("drivo_driver_stage");
      localStorage.removeItem("drivo_driver_ride");
    } else {
      localStorage.setItem("drivo_driver_stage", stage);
      if (ride) localStorage.setItem("drivo_driver_ride", JSON.stringify(ride));
    }
  }, [stage, ride]);

  // WS
  useEffect(() => {
    driverWS.connect("/ws/driver");
    const u = [
      driverWS.on("connected", () => {
        setWsOk(true);
        setIsOnline(true);
        startLocation();
      }),
      driverWS.on("disconnected", () => {
        setWsOk(false);
        setIsOnline(false);
      }),
      driverWS.on("ride_request", (p) => {
        setRide(p);
        setStage(S.requested);
        setTimeLeft(20);
        startCountdown();
        toast.success("🔔 New ride request!", { duration: 5000 });
      }),
      driverWS.on("ride_cancelled_by_rider", (p) => {
        toast.error(p?.message || "Rider cancelled");
        setStage(S.idle);
        setRide(null);
        setChatActive(false);
        clearInterval(countdown.current);
      }),
      driverWS.on("pool_rider_joined", (p) => {
        toast(`👥 Rider joined! (${p.riders_count} total)`, {
          icon: "🚌",
          duration: 5000,
        });
        setMyPool((prev) =>
          prev ? { ...prev, current_size: p.riders_count } : prev,
        );
      }),
    ];
    return () => {
      u.forEach((f) => f());
      driverWS.disconnect();
      stopLocation();
      clearInterval(countdown.current);
    };
  }, []);

  const startCountdown = () => {
    clearInterval(countdown.current);
    setTimeLeft(20);
    countdown.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(countdown.current);
          setStage(S.idle);
          setRide(null);
          toast("⏱ Request timed out", { icon: "⏰" });
          return 20;
        }
        return t - 1;
      });
    }, 1000);
  };

  const loadProfile = async () => {
    try {
      const r = await driverAPI.getProfile();
      setProfile(r.data.driver);
    } catch {}
  };
  const loadHistory = async () => {
    try {
      const r = await rideAPI.driverHistory();
      const list = Array.isArray(r.data.rides) ? r.data.rides : [];
      setHistory(list);
      setScheduledRides(list.filter((r) => r.Status === "scheduled"));
      const today = new Date().toDateString();
      setTodayEarnings(
        list
          .filter(
            (r) =>
              r.Status === "completed" &&
              new Date(r.CreatedAt).toDateString() === today,
          )
          .reduce((s, r) => s + (r.ActualFare || r.EstimatedFare || 0), 0),
      );
    } catch {}
  };
  useEffect(() => {
    if (panel === "history" || panel === "scheduled") loadHistory();
  }, [panel]);
  useEffect(() => {
    loadHistory();
  }, []);

  // Network — reconnect when internet comes back, keep location running
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      Network.addListener("networkStatusChange", (s) => {
        if (s.connected) {
          toast("Back online 🟢", { duration: 2000 });
          setTimeout(() => driverWS.connect("/ws/driver"), 1000);
        } else toast("No internet", { icon: "🔴" });
      });
      return () => Network.removeAllListeners();
    }
    const onOnline = () => {
      toast("Back online 🟢", { duration: 2000 });
      setTimeout(() => driverWS.connect("/ws/driver"), 500);
    };
    const onOffline = () => toast("No internet — offline", { icon: "🔴" });
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // GPS — @capgo/background-geolocation — never stops on WS drop, continues via HTTP
  const startLocation = useCallback(async () => {
    if (Capacitor.isNativePlatform()) {
      if (bgRunning.current) return;
      bgRunning.current = true;
      await BackgroundGeolocation.start(
        {
          backgroundMessage:
            "Drivo is running. You are online and receiving ride requests.",
          backgroundTitle: "Drivo Driver — Online",
          requestPermissions: true,
          stale: false,
          distanceFilter: 10,
        },
        async (location, error) => {
          if (error) {
            bgRunning.current = false;
            if (
              error.code === "NOT_AUTHORIZED" &&
              window.confirm("Drivo needs location.\n\nOpen settings?")
            )
              BackgroundGeolocation.openSettings();
            return;
          }
          if (!location) return;
          const loc = { lat: location.latitude, lng: location.longitude };
          const kmh =
            location.speed != null ? Math.round(location.speed * 3.6) : null;
          setDriverPos(loc);
          setSpeed(kmh);
          if (!firstFix.current) {
            firstFix.current = true;
            window._drivoMapFlyTo?.(loc);
          }
          // WS first, fallback to HTTP — works in background too
          if (driverWS.isConnected())
            driverWS.send("location_update", {
              latitude: loc.lat,
              longitude: loc.lng,
            });
          else await sendLocationHTTP(loc.lat, loc.lng);
        },
      );
    } else {
      if (watchId.current) return;
      firstFix.current = false;
      watchId.current = navigator.geolocation.watchPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          const kmh =
            pos.coords.speed != null
              ? Math.round(pos.coords.speed * 3.6)
              : null;
          setDriverPos(loc);
          setSpeed(kmh);
          if (!firstFix.current) {
            firstFix.current = true;
            window._drivoMapFlyTo?.(loc);
          }
          if (driverWS.isConnected())
            driverWS.send("location_update", {
              latitude: loc.lat,
              longitude: loc.lng,
            });
          else sendLocationHTTP(loc.lat, loc.lng);
        },
        (err) => {
          if (err.code === 1) toast.error("Please enable GPS");
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
    }
  }, []);

  const stopLocation = useCallback(async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        await BackgroundGeolocation.stop();
        bgRunning.current = false;
      } catch {}
    } else {
      if (watchId.current != null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
    }
    setSpeed(null);
  }, []);

  const sendLocationHTTP = async (lat, lng) => {
    try {
      const token = localStorage.getItem("drivo_token");
      if (!token) return;
      await fetch(`${import.meta.env.VITE_API_URL}/driver/location/update`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ latitude: lat, longitude: lng }),
      });
    } catch {}
  };

  const recenterMap = () => {
    if (driverPos) window._drivoMapFlyTo?.(driverPos);
    else toast("Waiting for GPS...", { icon: "📡" });
  };

  const accept = () => {
    if (!ride) return;
    clearInterval(countdown.current);
    driverWS.send("ride_response", { ride_id: ride.ride_id, action: "accept" });
    setStage(S.accepted);
    setChatActive(true);
    toast.success("Ride accepted!");
  };
  const reject = () => {
    if (!ride) return;
    clearInterval(countdown.current);
    driverWS.send("ride_response", { ride_id: ride.ride_id, action: "reject" });
    setStage(S.idle);
    setRide(null);
    toast("Rejected", { icon: "❌" });
  };
  const markArrived = () => {
    if (!ride) return;
    driverWS.send("driver_arrived", { ride_id: ride.ride_id });
    setStage(S.arrived);
    toast.success("Marked as arrived!");
  };
  const startTrip = () => {
    if (!ride) return;
    if (ride.ride_mode === "pool" && ride.pool_id)
      driverWS.send("pool_ride_started", { pool_id: ride.pool_id });
    else driverWS.send("start_trip", { ride_id: ride.ride_id });
    setStage(S.ongoing);
    toast.success("Trip started!");
  };
  const endTrip = () => {
    if (!ride) return;
    if (ride.ride_mode === "pool" && ride.pool_id)
      driverWS.send("pool_ride_completed", { pool_id: ride.pool_id });
    else driverWS.send("end_trip", { ride_id: ride.ride_id });
    setStage(S.completed);
    setChatActive(false);
  };
  const cancelRide = async () => {
    if (!ride) return;
    try {
      await rideAPI.driverCancel({ ride_id: ride.ride_id });
      setStage(S.idle);
      setRide(null);
      setChatActive(false);
      clearInterval(countdown.current);
      toast("Cancelled", { icon: "❌" });
    } catch {
      toast.error("Cancel failed");
    }
  };
  const onDone = () => {
    setStage(S.idle);
    setRide(null);
    setChatActive(false);
    setMyPool(null);
    localStorage.removeItem("drivo_driver_stage");
    localStorage.removeItem("drivo_driver_ride");
    loadProfile();
    loadHistory();
  };
  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    driverWS.connect("/ws/driver");
    await Promise.all([loadHistory(), loadProfile()]).catch(() => {});
    setTimeout(() => setRefreshing(false), 1200);
  };

  const fmt = (f) => (f ? `₦${Number(f).toLocaleString()}` : "—");

  if (checkingOnboarding)
    return (
      <div
        className={`h-screen w-screen flex items-center justify-center ${isDark ? "bg-[#0a0a0f]" : "bg-slate-50"}`}
      >
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 border-2 border-brand/20 rounded-full" />
            <div className="absolute inset-0 border-2 border-transparent border-t-brand rounded-full animate-spin" />
          </div>
          <p className="text-zinc-500 text-sm font-medium">Loading...</p>
        </div>
      </div>
    );

  const isActiveRide = [S.accepted, S.arrived, S.ongoing].includes(stage);
  const rideId = ride?.ride_id || ride?.ID || ride?.id;
  const mapPickup =
    ride && [S.requested, S.accepted, S.arrived, S.ongoing].includes(stage)
      ? { lat: ride.pickup_lat, lng: ride.pickup_lng }
      : null;
  const mapDropoff =
    ride && [S.accepted, S.arrived, S.ongoing].includes(stage)
      ? { lat: ride.dropoff_lat, lng: ride.dropoff_lng }
      : null;

  const sideProps = {
    user,
    panel,
    setPanel,
    isDark,
    toggle,
    wsOk,
    logout,
    stage,
    ride,
    profile,
    history,
    scheduledRides,
    isOnline,
    speed,
    todayEarnings,
    accept,
    reject,
    markArrived,
    startTrip,
    endTrip,
    cancelRide,
    fmt,
    timeLeft,
    onDone,
    myPool,
    onCreatePool: () => setPoolModalOpen(true),
    onRefresh: handleRefresh,
    refreshing,
  };

  return (
    <div
      className={`flex h-screen w-screen overflow-hidden ${isDark ? "bg-[#0a0a0f]" : "bg-slate-50"} font-sans`}
    >
      <AnimatePresence>
        {sideOpen && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 lg:hidden"
              onClick={() => setSideOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.div
              className="fixed left-0 top-0 bottom-0 w-[340px] z-40 lg:hidden flex flex-col"
              style={{ background: isDark ? "#0f0f18" : "#fff" }}
              initial={{ x: -340 }}
              animate={{ x: 0 }}
              exit={{ x: -340 }}
              transition={{ type: "spring", damping: 28, stiffness: 280 }}
            >
              <SideContent {...sideProps} onClose={() => setSideOpen(false)} />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <div
        className="hidden lg:flex w-[390px] flex-shrink-0 flex-col border-r z-10"
        style={{
          background: isDark ? "#0f0f18" : "#fff",
          borderColor: isDark ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.07)",
        }}
      >
        <SideContent {...sideProps} />
      </div>

      <div className="flex-1 relative overflow-hidden">
        <DrivoMap
          driverLoc={driverPos}
          pickupLoc={mapPickup}
          dropoffLoc={mapDropoff}
          stage={stage}
        />

        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 safe-top pointer-events-none">
          <button
            onClick={() => setSideOpen(true)}
            className="lg:hidden pointer-events-auto w-11 h-11 rounded-2xl flex items-center justify-center shadow-lg border border-white/20 text-zinc-700 dark:text-zinc-100 active:scale-95"
            style={{
              background: isDark
                ? "rgba(15,15,24,.85)"
                : "rgba(255,255,255,.85)",
              backdropFilter: "blur(20px)",
            }}
          >
            <Menu size={20} />
          </button>
          <div className="ml-auto pointer-events-auto flex items-center gap-2">
            {speed != null && speed > 2 && (
              <div
                className="px-3 py-1.5 rounded-full text-xs font-black border border-white/20"
                style={{
                  background: isDark
                    ? "rgba(15,15,24,.85)"
                    : "rgba(255,255,255,.85)",
                  backdropFilter: "blur(20px)",
                  color: isDark ? "#fff" : "#0a0a0f",
                }}
              >
                {speed} km/h
              </div>
            )}
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border border-white/20 ${isOnline ? "text-brand" : "text-zinc-400"}`}
              style={{
                background: isDark
                  ? "rgba(15,15,24,.85)"
                  : "rgba(255,255,255,.85)",
                backdropFilter: "blur(20px)",
              }}
            >
              <span
                className={`w-2 h-2 rounded-full ${isOnline ? "bg-brand animate-pulse" : "bg-zinc-400"}`}
              />
              {isOnline ? "Online" : "Offline"}
            </div>
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center border border-white/20 ${wsOk ? "text-brand" : "text-red-400"}`}
              style={{
                background: isDark
                  ? "rgba(15,15,24,.85)"
                  : "rgba(255,255,255,.85)",
                backdropFilter: "blur(20px)",
              }}
            >
              {wsOk ? <Wifi size={14} /> : <WifiOff size={14} />}
            </div>
          </div>
        </div>

        {/* Map controls */}
        <div className="absolute bottom-6 right-4 flex flex-col gap-2">
          <AnimatePresence>
            {isActiveRide && ride?.ride_mode !== "pool" && rideId && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
              >
                <ChatBox
                  rideId={rideId}
                  senderType="driver"
                  ws={driverWS}
                  otherName={ride?.rider_name || "Rider"}
                  isActive={chatActive}
                />
              </motion.div>
            )}
          </AnimatePresence>
          <button
            onClick={recenterMap}
            className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-float border border-white/20 text-brand active:scale-95 transition-all"
            style={{
              background: isDark ? "rgba(15,15,24,.9)" : "rgba(255,255,255,.9)",
              backdropFilter: "blur(20px)",
            }}
          >
            <Crosshair size={20} />
          </button>
        </div>

        {/* GPS acquiring */}
        <AnimatePresence>
          {isOnline && !driverPos && (
            <motion.div
              className="absolute top-20 left-1/2 -translate-x-1/2 rounded-2xl px-4 py-2.5 shadow-float flex items-center gap-2 text-xs font-medium pointer-events-none border border-white/10"
              style={{
                background: isDark
                  ? "rgba(15,15,24,.9)"
                  : "rgba(255,255,255,.9)",
                backdropFilter: "blur(20px)",
                color: isDark ? "rgba(255,255,255,.7)" : "rgba(0,0,0,.7)",
              }}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <div className="w-3 h-3 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
              Acquiring GPS location...
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mobile request sheet */}
        <AnimatePresence>
          {stage === S.requested && ride && (
            <motion.div
              className="absolute bottom-0 left-0 right-0 lg:hidden rounded-t-3xl p-5 safe-bottom z-10 border-t border-white/10"
              style={{
                background: isDark
                  ? "rgba(15,15,24,.97)"
                  : "rgba(255,255,255,.97)",
                backdropFilter: "blur(24px)",
              }}
              initial={{ y: 300 }}
              animate={{ y: 0 }}
              exit={{ y: 300 }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
            >
              <div
                className="w-10 h-1 rounded-full mx-auto mb-4"
                style={{ background: "rgba(255,255,255,.15)" }}
              />
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p
                    className="font-black text-lg"
                    style={{ color: isDark ? "#fff" : "#0a0a0f" }}
                  >
                    New Ride!
                  </p>
                  <p className="text-brand font-black text-2xl">
                    {fmt(ride.estimated_fare)}
                  </p>
                </div>
                <div
                  className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-black ${timeLeft <= 5 ? "bg-red-500 text-white animate-pulse" : "bg-brand/10 text-brand"}`}
                >
                  {timeLeft}s
                </div>
              </div>
              <div className="space-y-2 mb-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-brand flex-shrink-0" />
                  <span
                    className="truncate"
                    style={{
                      color: isDark
                        ? "rgba(255,255,255,.65)"
                        : "rgba(0,0,0,.6)",
                    }}
                  >
                    {ride.pickup_address}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                  <span
                    className="truncate"
                    style={{
                      color: isDark
                        ? "rgba(255,255,255,.65)"
                        : "rgba(0,0,0,.6)",
                    }}
                  >
                    {ride.dropoff_address}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Btn variant="danger" onClick={reject}>
                  <XCircle size={16} /> Reject
                </Btn>
                <Btn onClick={accept}>
                  <CheckCircle size={16} /> Accept
                </Btn>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mobile trip sheet */}
        <AnimatePresence>
          {[S.accepted, S.arrived, S.ongoing, S.completed].includes(stage) && (
            <motion.div
              className="absolute bottom-0 left-0 right-0 lg:hidden rounded-t-3xl p-5 safe-bottom z-10 border-t border-white/10"
              style={{
                background: isDark
                  ? "rgba(15,15,24,.97)"
                  : "rgba(255,255,255,.97)",
                backdropFilter: "blur(24px)",
              }}
              initial={{ y: 300 }}
              animate={{ y: 0 }}
              exit={{ y: 300 }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
            >
              <div
                className="w-10 h-1 rounded-full mx-auto mb-4"
                style={{ background: "rgba(255,255,255,.15)" }}
              />
              <MobileTripStatus
                stage={stage}
                ride={ride}
                fmt={fmt}
                markArrived={markArrived}
                startTrip={startTrip}
                endTrip={endTrip}
                cancelRide={cancelRide}
                onDone={onDone}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <PoolCreateModal
        open={poolModalOpen}
        onClose={() => setPoolModalOpen(false)}
        driverPos={driverPos}
        isDark={isDark}
        onCreated={(pool) => {
          setMyPool(pool);
          setPoolModalOpen(false);
        }}
      />
    </div>
  );
}

function PoolCreateModal({ open, onClose, driverPos, isDark, onCreated }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(
          `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json?key=${KEY}&limit=5&country=ng`,
        );
        const d = await r.json();
        setResults(
          (d.features || []).map((f) => ({
            id: f.id,
            name: f.text || f.place_name?.split(",")[0],
            address: f.place_name,
            lat: f.center[1],
            lng: f.center[0],
          })),
        );
      } catch {}
      setSearching(false);
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  const handleCreate = async () => {
    if (!driverPos || !selected) return toast.error("Need GPS and destination");
    setLoading(true);
    try {
      const r = await driverAPI.createPool({
        pickup_lat: driverPos.lat,
        pickup_lng: driverPos.lng,
        dropoff_lat: selected.lat,
        dropoff_lng: selected.lng,
        pickup_address: "Current location",
        dropoff_address: selected.address,
      });
      toast.success("Pool created! Riders notified 🚌");
      onCreated(r.data.pool);
      setQuery("");
      setSelected(null);
      setResults([]);
    } catch (e) {
      toast.error(e.response?.data?.error || "Failed");
    }
    setLoading(false);
  };

  return (
    <Modal open={open} onClose={onClose} title="Create Pool Ride">
      <div className="space-y-4">
        <div
          className="flex items-center gap-3 p-3.5 rounded-2xl border border-brand/20"
          style={{ background: "rgba(0,200,83,.07)" }}
        >
          <div className="w-9 h-9 bg-brand/15 rounded-xl flex items-center justify-center flex-shrink-0">
            <Users size={15} className="text-brand" />
          </div>
          <div>
            <p
              className="text-sm font-bold"
              style={{ color: isDark ? "#fff" : "#0a0a0f" }}
            >
              Start a pool ride
            </p>
            <p
              className="text-xs"
              style={{
                color: isDark ? "rgba(255,255,255,.4)" : "rgba(0,0,0,.45)",
              }}
            >
              Nearby riders going your way notified
            </p>
          </div>
        </div>
        <div
          className="p-3.5 rounded-2xl border"
          style={{
            background: isDark ? "rgba(255,255,255,.04)" : "rgba(0,0,0,.03)",
            borderColor: isDark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.07)",
          }}
        >
          <p
            className="text-[10px] font-semibold mb-0.5"
            style={{
              color: isDark ? "rgba(255,255,255,.35)" : "rgba(0,0,0,.4)",
            }}
          >
            PICKUP (YOUR LOCATION)
          </p>
          <p
            className="text-sm font-semibold"
            style={{ color: isDark ? "#fff" : "#0a0a0f" }}
          >
            {driverPos
              ? `${driverPos.lat.toFixed(4)}, ${driverPos.lng.toFixed(4)}`
              : "Waiting for GPS..."}
          </p>
        </div>
        <div className="relative">
          <div
            className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 border-transparent focus-within:border-brand transition-colors"
            style={{
              background: isDark ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.04)",
            }}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(null);
              }}
              placeholder="Search destination..."
              className="flex-1 text-sm font-medium bg-transparent outline-none placeholder-zinc-500"
              style={{ color: isDark ? "#fff" : "#0a0a0f" }}
            />
            {searching && (
              <div className="w-4 h-4 border-2 border-brand/20 border-t-brand rounded-full animate-spin" />
            )}
          </div>
          <AnimatePresence>
            {results.length > 0 && !selected && (
              <motion.div
                className="absolute top-full left-0 right-0 mt-1 rounded-2xl shadow-float z-50 overflow-hidden border"
                style={{
                  background: isDark ? "#1a1a28" : "#fff",
                  borderColor: isDark
                    ? "rgba(255,255,255,.08)"
                    : "rgba(0,0,0,.08)",
                }}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                {results.map((item, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setSelected(item);
                      setQuery(item.name);
                      setResults([]);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
                    style={{
                      "&:hover": {
                        background: isDark
                          ? "rgba(255,255,255,.06)"
                          : "rgba(0,0,0,.04)",
                      },
                    }}
                  >
                    <MapPin size={13} className="text-brand flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-semibold truncate"
                        style={{ color: isDark ? "#fff" : "#0a0a0f" }}
                      >
                        {item.name}
                      </p>
                      <p
                        className="text-xs truncate"
                        style={{
                          color: isDark
                            ? "rgba(255,255,255,.35)"
                            : "rgba(0,0,0,.4)",
                        }}
                      >
                        {item.address}
                      </p>
                    </div>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="flex gap-3">
          <Btn variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Btn>
          <Btn
            className="flex-1"
            loading={loading}
            disabled={!driverPos || !selected}
            onClick={handleCreate}
          >
            <Users size={14} /> Create Pool
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

function SideContent({
  user,
  panel,
  setPanel,
  isDark,
  toggle,
  wsOk,
  logout,
  stage,
  ride,
  profile,
  history,
  scheduledRides,
  isOnline,
  speed,
  todayEarnings,
  accept,
  reject,
  markArrived,
  startTrip,
  endTrip,
  cancelRide,
  fmt,
  timeLeft,
  onDone,
  myPool,
  onCreatePool,
  onRefresh,
  refreshing,
}) {
  const borderColor = isDark ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.07)";
  const mutedBg = isDark ? "rgba(255,255,255,.04)" : "rgba(0,0,0,.03)";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="px-5 pt-6 pb-4 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: `1px solid ${borderColor}` }}
      >
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-brand rounded-xl flex items-center justify-center">
              <Zap size={16} className="text-black" fill="black" />
            </div>
            <h1
              className="text-xl font-black tracking-tight"
              style={{ color: isDark ? "#fff" : "#0a0a0f" }}
            >
              driv<span className="text-brand">o</span>
            </h1>
          </div>
          <p
            className="text-[11px] font-medium mt-0.5 ml-10"
            style={{
              color: isDark ? "rgba(255,255,255,.35)" : "rgba(0,0,0,.4)",
            }}
          >
            Driver dashboard
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            title="Refresh"
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-95"
            style={{
              background: mutedBg,
              color: isDark ? "rgba(255,255,255,.5)" : "rgba(0,0,0,.4)",
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ animation: refreshing ? "spin 1s linear infinite" : "" }}
            >
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M8 16H3v5" />
            </svg>
          </button>
          <button
            onClick={toggle}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-base"
            style={{ background: mutedBg }}
          >
            {isDark ? "☀️" : "🌙"}
          </button>
          <div
            className={`w-2.5 h-2.5 rounded-full ${wsOk ? "bg-brand" : "bg-red-400"}`}
            style={{ boxShadow: wsOk ? "0 0 6px rgba(0,200,83,.6)" : "none" }}
          />
        </div>
      </div>

      {/* Online status */}
      <div
        className="px-4 py-3 flex-shrink-0"
        style={{ borderBottom: `1px solid ${borderColor}` }}
      >
        <div
          className={`w-full py-3 rounded-2xl text-sm font-black flex items-center justify-center gap-2.5 border ${isOnline ? "border-brand/25" : "border-red-500/20"}`}
          style={{
            background: isOnline ? "rgba(0,200,83,.08)" : "rgba(239,68,68,.07)",
            color: isOnline ? "#00C853" : "#f87171",
          }}
        >
          <span
            className={`w-2.5 h-2.5 rounded-full ${isOnline ? "bg-brand animate-pulse" : "bg-red-400 animate-pulse"}`}
          />
          {isOnline ? "Online — Receiving Rides" : "Offline — Reconnecting..."}
        </div>
      </div>

      {/* Stats row */}
      <div
        className="grid grid-cols-4 gap-1.5 px-3 py-3 flex-shrink-0"
        style={{ borderBottom: `1px solid ${borderColor}` }}
      >
        {[
          {
            label: "Rating",
            val: `${Number(profile?.Rating || 5).toFixed(1)}⭐`,
          },
          { label: "Trips", val: profile?.TotalTrips || 0 },
          {
            label: "Today",
            val:
              todayEarnings > 0
                ? `₦${(todayEarnings / 1000).toFixed(1)}k`
                : "₦0",
          },
          {
            label: "Speed",
            val: speed != null && isOnline ? `${speed}km` : "—",
          },
        ].map(({ label, val }) => (
          <div
            key={label}
            className="rounded-xl p-2 text-center"
            style={{ background: mutedBg }}
          >
            <p
              className="font-black text-xs tracking-tight"
              style={{ color: isDark ? "#fff" : "#0a0a0f" }}
            >
              {val}
            </p>
            <p
              className="text-[9px] mt-0.5"
              style={{
                color: isDark ? "rgba(255,255,255,.3)" : "rgba(0,0,0,.4)",
              }}
            >
              {label}
            </p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div
        className="flex px-3 pt-2 gap-1 flex-shrink-0"
        style={{ borderBottom: `1px solid ${borderColor}` }}
      >
        {[
          { k: "ride", icon: "🚗", label: "Ride" },
          {
            k: "scheduled",
            icon: "🕐",
            label: "Sched",
            badge: scheduledRides.length,
          },
          { k: "history", icon: "📋", label: "History" },
          { k: "profile", icon: "👤", label: "Profile" },
        ].map(({ k, icon, label, badge }) => (
          <button
            key={k}
            onClick={() => setPanel(k)}
            className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-xl text-[11px] font-bold transition-all mb-2 relative ${panel === k ? "bg-brand text-black" : "text-zinc-400"}`}
          >
            <span className="text-sm">{icon}</span>
            <span className="hidden sm:inline">{label}</span>
            {badge > 0 && panel !== k && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-brand text-black text-[9px] font-black rounded-full flex items-center justify-center">
                {badge}
              </span>
            )}
            {k === "ride" && stage === S.requested && panel !== "ride" && (
              <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 animate-pulse" />
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide px-4 py-4 space-y-3">
        {panel === "ride" && (
          <DriverRidePanel
            stage={stage}
            ride={ride}
            isOnline={isOnline}
            accept={accept}
            reject={reject}
            markArrived={markArrived}
            startTrip={startTrip}
            endTrip={endTrip}
            cancelRide={cancelRide}
            fmt={fmt}
            timeLeft={timeLeft}
            onDone={onDone}
            onCreatePool={onCreatePool}
            myPool={myPool}
            isDark={isDark}
          />
        )}
        {panel === "scheduled" && (
          <ScheduledPanel rides={scheduledRides} fmt={fmt} isDark={isDark} />
        )}
        {panel === "history" &&
          (history.filter((r) => r.Status !== "scheduled").length === 0 ? (
            <EmptyState
              icon="🚗"
              title="No trips yet"
              subtitle="Completed trips appear here"
            />
          ) : (
            <div className="space-y-2">
              {todayEarnings > 0 && (
                <div
                  className="rounded-2xl p-4 flex items-center justify-between border border-brand/20"
                  style={{ background: "rgba(0,200,83,.07)" }}
                >
                  <div>
                    <p
                      className="text-[11px] font-bold"
                      style={{
                        color: isDark
                          ? "rgba(255,255,255,.4)"
                          : "rgba(0,0,0,.45)",
                      }}
                    >
                      TODAY'S EARNINGS
                    </p>
                    <p className="font-black text-2xl text-brand mt-0.5">
                      {fmt(todayEarnings)}
                    </p>
                  </div>
                  <TrendingUp size={24} className="text-brand" />
                </div>
              )}
              {history
                .filter((r) => r.Status !== "scheduled")
                .map((r, i) => (
                  <div
                    key={r.ID || i}
                    className="p-4 rounded-2xl border"
                    style={{ background: mutedBg, borderColor }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <Badge
                          color={
                            r.Status === "completed"
                              ? "green"
                              : r.Status === "cancelled"
                                ? "red"
                                : "yellow"
                          }
                        >
                          {r.Status}
                        </Badge>
                        <p
                          className="text-sm font-semibold truncate mt-2"
                          style={{ color: isDark ? "#fff" : "#0a0a0f" }}
                        >
                          {r.PickupAddress || "Pickup"}
                        </p>
                        <p
                          className="text-xs mt-0.5 truncate"
                          style={{
                            color: isDark
                              ? "rgba(255,255,255,.35)"
                              : "rgba(0,0,0,.4)",
                          }}
                        >
                          → {r.DropoffAddress || "Dropoff"}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-black text-brand">
                          {fmt(r.ActualFare || r.EstimatedFare)}
                        </p>
                        <p
                          className="text-xs mt-0.5"
                          style={{
                            color: isDark
                              ? "rgba(255,255,255,.3)"
                              : "rgba(0,0,0,.35)",
                          }}
                        >
                          {r.DistanceKm?.toFixed(1)}km
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          ))}
        {panel === "profile" && profile && (
          <div className="space-y-3">
            <div
              className="rounded-3xl p-6 text-center border"
              style={{ background: mutedBg, borderColor }}
            >
              <div className="w-20 h-20 bg-brand/10 rounded-full flex items-center justify-center text-3xl font-black text-brand mx-auto mb-3">
                {user?.Name?.[0]}
              </div>
              <p
                className="font-black text-xl tracking-tight"
                style={{ color: isDark ? "#fff" : "#0a0a0f" }}
              >
                {user?.Name}
              </p>
              <p
                className="text-sm mt-0.5"
                style={{
                  color: isDark ? "rgba(255,255,255,.4)" : "rgba(0,0,0,.45)",
                }}
              >
                {user?.Email}
              </p>
              <div className="mt-3 flex justify-center">
                <Badge
                  color={
                    profile.Status === "active"
                      ? "green"
                      : profile.Status === "pending"
                        ? "yellow"
                        : "red"
                  }
                >
                  {profile.Status}
                </Badge>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                {
                  l: "Rating",
                  v: `${Number(profile.Rating || 5).toFixed(2)} ⭐`,
                },
                { l: "Total Trips", v: profile.TotalTrips || 0 },
                { l: "Acceptance", v: `${profile.AcceptanceRate || 100}%` },
                { l: "Cancellation", v: `${profile.CancellationRate || 0}%` },
              ].map(({ l, v }) => (
                <div
                  key={l}
                  className="rounded-xl p-3"
                  style={{ background: mutedBg }}
                >
                  <p
                    className="font-black text-sm"
                    style={{ color: isDark ? "#fff" : "#0a0a0f" }}
                  >
                    {v}
                  </p>
                  <p
                    className="text-xs mt-0.5"
                    style={{
                      color: isDark
                        ? "rgba(255,255,255,.35)"
                        : "rgba(0,0,0,.4)",
                    }}
                  >
                    {l}
                  </p>
                </div>
              ))}
            </div>
            <Btn variant="danger" onClick={logout}>
              <LogOut size={16} /> Sign Out
            </Btn>
          </div>
        )}
      </div>
    </div>
  );
}

function ScheduledPanel({ rides, fmt, isDark }) {
  const mutedBg = isDark ? "rgba(255,255,255,.04)" : "rgba(0,0,0,.03)";
  const borderColor = isDark ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.07)";
  if (rides.length === 0)
    return (
      <div className="flex flex-col items-center justify-center py-14 gap-3 text-center">
        <motion.span
          className="text-5xl"
          animate={{ y: [0, -6, 0] }}
          transition={{ repeat: Infinity, duration: 2.5 }}
        >
          🕐
        </motion.span>
        <p
          className="font-bold"
          style={{ color: isDark ? "rgba(255,255,255,.5)" : "rgba(0,0,0,.5)" }}
        >
          No scheduled rides
        </p>
        <p
          className="text-xs"
          style={{ color: isDark ? "rgba(255,255,255,.3)" : "rgba(0,0,0,.35)" }}
        >
          Upcoming rides will appear here
        </p>
      </div>
    );
  return (
    <div className="space-y-3">
      {rides.map((r, i) => {
        const t = r.ScheduledAt ? new Date(r.ScheduledAt) : null;
        const mins = t ? Math.round((t - new Date()) / 60000) : null;
        const isSoon = mins != null && mins <= 30 && mins > 0;
        return (
          <div
            key={r.ID || i}
            className="p-4 rounded-2xl border"
            style={{
              background: isSoon ? "rgba(0,200,83,.07)" : mutedBg,
              borderColor: isSoon ? "rgba(0,200,83,.25)" : borderColor,
            }}
          >
            {t && (
              <div
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-black mb-2.5 ${isSoon ? "bg-brand text-black" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"}`}
              >
                <Clock size={10} />
                {mins <= 0
                  ? "Starting soon!"
                  : isSoon
                    ? `In ${mins}min`
                    : mins < 1440
                      ? `In ${Math.floor(mins / 60)}h ${mins % 60}m`
                      : t.toLocaleDateString()}
              </div>
            )}
            <p
              className="text-sm font-bold truncate"
              style={{ color: isDark ? "#fff" : "#0a0a0f" }}
            >
              {r.PickupAddress || "Pickup"}
            </p>
            <p
              className="text-xs mt-0.5 truncate"
              style={{
                color: isDark ? "rgba(255,255,255,.35)" : "rgba(0,0,0,.4)",
              }}
            >
              → {r.DropoffAddress || "Dropoff"}
            </p>
            {t && (
              <p
                className="text-xs mt-1.5 font-semibold"
                style={{
                  color: isDark ? "rgba(255,255,255,.4)" : "rgba(0,0,0,.4)",
                }}
              >
                {t.toLocaleString("en-NG", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            )}
            <div
              className="flex items-center justify-between mt-2.5 pt-2.5"
              style={{
                borderTop: `1px solid ${isDark ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.07)"}`,
              }}
            >
              <p className="font-black text-brand">{fmt(r.EstimatedFare)}</p>
              <p
                className="text-xs font-semibold"
                style={{
                  color: isDark ? "rgba(255,255,255,.35)" : "rgba(0,0,0,.4)",
                }}
              >
                {r.DistanceKm?.toFixed(1)}km
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DriverRidePanel({
  stage,
  ride,
  isOnline,
  accept,
  reject,
  markArrived,
  startTrip,
  endTrip,
  cancelRide,
  fmt,
  timeLeft,
  onDone,
  onCreatePool,
  myPool,
  isDark,
}) {
  const mutedBg = isDark ? "rgba(255,255,255,.04)" : "rgba(0,0,0,.03)";
  const borderColor = isDark ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.07)";

  if (stage === S.idle)
    return (
      <div className="space-y-3">
        <div
          className="rounded-3xl p-8 text-center border"
          style={{ background: mutedBg, borderColor }}
        >
          <motion.div
            className="text-7xl mb-4"
            animate={{ y: [0, -10, 0] }}
            transition={{ repeat: Infinity, duration: 2.5 }}
          >
            {isOnline ? "🟢" : "🔴"}
          </motion.div>
          <p
            className="font-black text-xl tracking-tight"
            style={{ color: isDark ? "#fff" : "#0a0a0f" }}
          >
            {isOnline ? "Waiting for rides..." : "Reconnecting..."}
          </p>
          <p
            className="text-sm mt-1.5"
            style={{
              color: isDark ? "rgba(255,255,255,.35)" : "rgba(0,0,0,.4)",
            }}
          >
            {isOnline
              ? "Ride requests will appear here"
              : "Check internet connection"}
          </p>
        </div>
        {isOnline && !myPool && (
          <button
            onClick={onCreatePool}
            className="w-full flex items-center gap-3 p-4 rounded-2xl border-2 border-dashed transition-all active:scale-[0.98]"
            style={{
              borderColor: isDark ? "rgba(0,200,83,.3)" : "rgba(0,200,83,.25)",
              background: "rgba(0,200,83,.04)",
            }}
          >
            <div className="w-10 h-10 bg-brand/10 rounded-xl flex items-center justify-center flex-shrink-0">
              <Users size={17} className="text-brand" />
            </div>
            <div className="text-left flex-1">
              <p
                className="text-sm font-black"
                style={{ color: isDark ? "#fff" : "#0a0a0f" }}
              >
                Create Pool Ride
              </p>
              <p
                className="text-xs mt-0.5"
                style={{
                  color: isDark ? "rgba(255,255,255,.4)" : "rgba(0,0,0,.45)",
                }}
              >
                Pick up multiple riders going your way
              </p>
            </div>
            <Plus size={16} className="text-brand" />
          </button>
        )}
        {myPool && (
          <motion.div
            className="rounded-2xl p-4 border border-brand/25"
            style={{ background: "rgba(0,200,83,.07)" }}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-brand/15 rounded-xl flex items-center justify-center text-xl">
                🚌
              </div>
              <div>
                <p
                  className="font-black text-sm"
                  style={{ color: isDark ? "#fff" : "#0a0a0f" }}
                >
                  Pool is Open!
                </p>
                <p
                  className="text-xs"
                  style={{
                    color: isDark ? "rgba(255,255,255,.4)" : "rgba(0,0,0,.45)",
                  }}
                >
                  Riders are being notified
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ["Riders", myPool.current_size || 0],
                ["Max", myPool.max_riders || 3],
                [
                  "Fare/head",
                  `₦${Math.round(myPool.fare_per_head || 0).toLocaleString()}`,
                ],
              ].map(([l, v]) => (
                <div
                  key={l}
                  className="rounded-xl p-2"
                  style={{
                    background: isDark
                      ? "rgba(0,0,0,.3)"
                      : "rgba(255,255,255,.7)",
                  }}
                >
                  <p className="font-black text-sm text-brand">{v}</p>
                  <p
                    className="text-[10px]"
                    style={{
                      color: isDark
                        ? "rgba(255,255,255,.35)"
                        : "rgba(0,0,0,.4)",
                    }}
                  >
                    {l}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    );

  if (stage === S.requested && ride)
    return (
      <motion.div
        className="space-y-4"
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        <div
          className="rounded-3xl p-5 border relative overflow-hidden"
          style={{ background: mutedBg, borderColor }}
        >
          <div className="absolute top-4 right-4">
            <div
              className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-black ${timeLeft <= 5 ? "bg-red-500 text-white animate-pulse" : "bg-brand/10 text-brand"}`}
            >
              {timeLeft}s
            </div>
          </div>
          <p
            className="font-black text-lg tracking-tight mb-0.5"
            style={{ color: isDark ? "#fff" : "#0a0a0f" }}
          >
            New Ride!
          </p>
          <p className="text-brand font-black text-4xl mb-4">
            {fmt(ride.estimated_fare)}
          </p>
          <div className="space-y-2 text-sm mb-4">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-brand flex-shrink-0" />
              <span
                className="truncate"
                style={{
                  color: isDark ? "rgba(255,255,255,.65)" : "rgba(0,0,0,.6)",
                }}
              >
                {ride.pickup_address ||
                  `${ride.pickup_lat?.toFixed(4)}, ${ride.pickup_lng?.toFixed(4)}`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
              <span
                className="truncate"
                style={{
                  color: isDark ? "rgba(255,255,255,.65)" : "rgba(0,0,0,.6)",
                }}
              >
                {ride.dropoff_address ||
                  `${ride.dropoff_lat?.toFixed(4)}, ${ride.dropoff_lng?.toFixed(4)}`}
              </span>
            </div>
          </div>
          <div
            className="grid grid-cols-3 gap-3 pt-3 border-t text-xs"
            style={{ borderColor }}
          >
            <div>
              <p
                style={{
                  color: isDark ? "rgba(255,255,255,.35)" : "rgba(0,0,0,.4)",
                }}
              >
                Distance
              </p>
              <p
                className="font-black mt-0.5"
                style={{ color: isDark ? "#fff" : "#0a0a0f" }}
              >
                {ride.distance_km?.toFixed(1)}km
              </p>
            </div>
            <div>
              <p
                style={{
                  color: isDark ? "rgba(255,255,255,.35)" : "rgba(0,0,0,.4)",
                }}
              >
                Rider
              </p>
              <p
                className="font-black mt-0.5"
                style={{ color: isDark ? "#fff" : "#0a0a0f" }}
              >
                ⭐ {ride.rider_rating?.toFixed(1) || "New"}
              </p>
            </div>
            <div>
              <p
                style={{
                  color: isDark ? "rgba(255,255,255,.35)" : "rgba(0,0,0,.4)",
                }}
              >
                Fare
              </p>
              <p className="font-black text-brand mt-0.5">
                {fmt(ride.estimated_fare)}
              </p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Btn variant="danger" onClick={reject}>
            <XCircle size={16} /> Reject
          </Btn>
          <Btn onClick={accept}>
            <CheckCircle size={16} /> Accept
          </Btn>
        </div>
      </motion.div>
    );

  if (stage === S.accepted)
    return (
      <motion.div
        className="space-y-3"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div
          className="rounded-3xl p-5 border"
          style={{ background: mutedBg, borderColor }}
        >
          <Badge color="blue">Heading to pickup</Badge>
          <div className="flex items-center gap-2 text-sm mt-3">
            <span className="w-2 h-2 rounded-full bg-brand" />
            <span
              className="truncate"
              style={{
                color: isDark ? "rgba(255,255,255,.65)" : "rgba(0,0,0,.6)",
              }}
            >
              {ride?.pickup_address || "Pickup"}
            </span>
          </div>
          <div className="flex items-center justify-between mt-3">
            <p className="font-black text-3xl text-brand">
              {fmt(ride?.estimated_fare)}
            </p>
            {ride?.distance_km && (
              <span
                className="text-xs font-bold px-2.5 py-1 rounded-xl"
                style={{
                  background: isDark
                    ? "rgba(255,255,255,.08)"
                    : "rgba(0,0,0,.06)",
                  color: isDark ? "rgba(255,255,255,.6)" : "rgba(0,0,0,.6)",
                }}
              >
                {ride.distance_km.toFixed(1)}km
              </span>
            )}
          </div>
        </div>
        <Btn onClick={markArrived}>
          <MapPin size={16} /> I've Arrived
        </Btn>
        <Btn variant="danger" onClick={cancelRide}>
          Cancel Ride
        </Btn>
      </motion.div>
    );

  if (stage === S.arrived)
    return (
      <motion.div
        className="space-y-3"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div
          className="rounded-3xl p-7 text-center border border-brand/25"
          style={{ background: "rgba(0,200,83,.07)" }}
        >
          <motion.div
            className="text-6xl mb-4"
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ repeat: 3, duration: 0.5 }}
          >
            🎯
          </motion.div>
          <p
            className="font-black text-xl tracking-tight"
            style={{ color: isDark ? "#fff" : "#0a0a0f" }}
          >
            You've arrived!
          </p>
          <p
            className="text-sm mt-1.5"
            style={{
              color: isDark ? "rgba(255,255,255,.4)" : "rgba(0,0,0,.45)",
            }}
          >
            Waiting for rider to board
          </p>
        </div>
        <Btn onClick={startTrip}>
          <Navigation size={16} /> Start Trip
        </Btn>
        <Btn variant="danger" onClick={cancelRide}>
          Cancel
        </Btn>
      </motion.div>
    );

  if (stage === S.ongoing)
    return (
      <motion.div
        className="space-y-3"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div
          className="rounded-3xl p-6 border"
          style={{ background: mutedBg, borderColor }}
        >
          <div className="flex items-center justify-between mb-3">
            <Badge color="green">Trip in progress</Badge>
            {ride?.distance_km && (
              <span className="text-xs font-black text-brand px-2.5 py-1 rounded-xl bg-brand/10">
                {ride.distance_km.toFixed(1)}km
              </span>
            )}
          </div>
          <motion.div
            className="text-5xl text-center mb-3"
            animate={{ x: [-3, 3, -3] }}
            transition={{ repeat: Infinity, duration: 0.8 }}
          >
            🚗
          </motion.div>
          <p className="text-brand font-black text-4xl text-center">
            {fmt(ride?.estimated_fare)}
          </p>
          {ride?.dropoff_address && (
            <div
              className="mt-3 pt-3 flex items-center gap-2 text-sm"
              style={{ borderTop: `1px solid ${borderColor}` }}
            >
              <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
              <span
                className="truncate"
                style={{
                  color: isDark ? "rgba(255,255,255,.5)" : "rgba(0,0,0,.5)",
                }}
              >
                {ride.dropoff_address}
              </span>
            </div>
          )}
        </div>
        <Btn variant="outline" onClick={endTrip}>
          <CheckCircle size={16} /> End Trip
        </Btn>
      </motion.div>
    );

  if (stage === S.completed)
    return (
      <motion.div
        className="space-y-3"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        <div
          className="rounded-3xl p-7 text-center border border-brand/25"
          style={{ background: "rgba(0,200,83,.07)" }}
        >
          <motion.div
            className="text-6xl mb-4"
            initial={{ rotate: -15 }}
            animate={{ rotate: 0 }}
            transition={{ type: "spring" }}
          >
            🏁
          </motion.div>
          <p
            className="font-black text-2xl tracking-tight"
            style={{ color: isDark ? "#fff" : "#0a0a0f" }}
          >
            Trip Complete!
          </p>
          <p className="text-brand font-black text-4xl mt-2">
            {fmt(ride?.estimated_fare)}
          </p>
          {ride?.distance_km && (
            <p
              className="text-xs mt-1.5"
              style={{
                color: isDark ? "rgba(255,255,255,.35)" : "rgba(0,0,0,.4)",
              }}
            >
              {ride.distance_km.toFixed(1)}km covered
            </p>
          )}
        </div>
        <Btn variant="ghost" onClick={onDone}>
          Done
        </Btn>
      </motion.div>
    );
  return null;
}

function MobileTripStatus({
  stage,
  ride,
  fmt,
  markArrived,
  startTrip,
  endTrip,
  cancelRide,
  onDone,
}) {
  if (stage === S.accepted)
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Badge color="blue">Heading to pickup</Badge>
            <p className="text-sm text-zinc-500 mt-1.5 truncate max-w-[220px]">
              {ride?.pickup_address || "Pickup"}
            </p>
          </div>
          <p className="text-brand font-black text-xl">
            {fmt(ride?.estimated_fare)}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Btn variant="danger" size="sm" onClick={cancelRide}>
            Cancel
          </Btn>
          <Btn size="sm" onClick={markArrived}>
            <MapPin size={14} /> Arrived
          </Btn>
        </div>
      </div>
    );
  if (stage === S.arrived)
    return (
      <div className="space-y-3">
        <div className="text-center">
          <p className="font-bold text-lg text-zinc-900 dark:text-white">
            🎯 You've arrived!
          </p>
          <p className="text-sm text-zinc-500 mt-1">Waiting for rider</p>
        </div>
        <Btn onClick={startTrip}>
          <Navigation size={15} /> Start Trip
        </Btn>
      </div>
    );
  if (stage === S.ongoing)
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold text-zinc-900 dark:text-white">
              🚗 Trip in progress
            </p>
            <p className="text-xs text-zinc-400 truncate max-w-[200px]">
              {ride?.dropoff_address}
            </p>
          </div>
          <p className="text-brand font-black text-xl">
            {fmt(ride?.estimated_fare)}
          </p>
        </div>
        <button
          onClick={endTrip}
          className="w-full py-3 rounded-2xl text-sm font-bold text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 active:scale-95"
        >
          End Trip
        </button>
      </div>
    );
  if (stage === S.completed)
    return (
      <div className="text-center space-y-3">
        <p className="font-black text-xl text-zinc-900 dark:text-white">
          🏁 Complete!
        </p>
        <p className="text-brand font-black text-3xl">
          {fmt(ride?.estimated_fare)}
        </p>
        <Btn variant="ghost" className="w-full" onClick={onDone}>
          Done
        </Btn>
      </div>
    );
  return null;
}
