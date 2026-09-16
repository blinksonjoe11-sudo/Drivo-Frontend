import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Star,
  Menu,
  Wifi,
  WifiOff,
  LogOut,
  Clock,
  RefreshCw,
  Navigation,
  Users,
  X,
  MapPin,
  ChevronRight,
  Zap,
  Shield,
} from "lucide-react";
import { rideAPI, ratingAPI, saveFCMToken } from "../services/api";
import { riderWS } from "../services/websocket";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { Btn, Badge, Modal, StarRating, EmptyState } from "../components/ui";
import DrivoMap from "../components/map/DrivoMap";
import LocationSearch from "../components/LocationSearch";
import ChatBox from "../components/ChatBox";
import ScheduleModal from "../components/ScheduleModal";
import RecurringModal from "../components/RecurringModal";
import toast from "react-hot-toast";
import { BackgroundGeolocation } from "@capgo/background-geolocation";
import { Network } from "@capacitor/network";
import { Capacitor } from "@capacitor/core";
import { getFCMToken, onForegroundMessage } from "../services/firebase";

const S = {
  idle: "idle",
  searching: "searching",
  accepted: "accepted",
  arrived: "arrived",
  ongoing: "ongoing",
  completed: "completed",
};

export default function Rider() {
  const { user, logout } = useAuth();
  const { isDark, toggle } = useTheme();

  const [stage, setStage] = useState(S.idle);
  const [pickup, setPickup] = useState(null);
  const [dropoff, setDropoff] = useState(null);
  const [driverLoc, setDriverLoc] = useState(null);
  const [riderLoc, setRiderLoc] = useState(null);
  const [ride, setRide] = useState(null);
  const [driverInfo, setDriverInfo] = useState(null);
  const [history, setHistory] = useState([]);
  const [panel, setPanel] = useState("ride");
  const [ratingOpen, setRatingOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [sideOpen, setSideOpen] = useState(false);
  const [wsOk, setWsOk] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState(null);
  const [poolCheck, setPoolCheck] = useState(null);
  const [checkingPool, setCheckingPool] = useState(false);
  const [rideMode, setRideMode] = useState("solo");
  const [joinedPoolInfo, setJoinedPoolInfo] = useState(null);
  const [chatActive, setChatActive] = useState(false);
  const [routeInfo, setRouteInfo] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // ── Refs to avoid stale closures in WS callbacks ─────────────────────────────
  // This is the root cause of "stage not updating" — WS handlers registered
  // on mount capture the initial state values. Using refs ensures they always
  // see the latest values without needing to re-register handlers.
  const stageRef = useRef(stage);
  const rideRef = useRef(ride);
  const watchId = useRef(null);
  const bgRunning = useRef(false);

  // Keep refs in sync with state
  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);
  useEffect(() => {
    rideRef.current = ride;
  }, [ride]);

  // ── Persist state ─────────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const s = localStorage.getItem("drivo_rider_stage");
      if (s && s !== "idle") setStage(s);
    } catch {}
    try {
      const r = localStorage.getItem("drivo_rider_ride");
      if (r) setRide(JSON.parse(r));
    } catch {}
    try {
      const p = localStorage.getItem("drivo_rider_pickup");
      if (p) setPickup(JSON.parse(p));
    } catch {}
    try {
      const d = localStorage.getItem("drivo_rider_dropoff");
      if (d) setDropoff(JSON.parse(d));
    } catch {}
    try {
      const di = localStorage.getItem("drivo_rider_driverinfo");
      if (di) setDriverInfo(JSON.parse(di));
    } catch {}
  }, []);

  useEffect(() => {
    if (stage === "idle") {
      [
        "drivo_rider_stage",
        "drivo_rider_ride",
        "drivo_rider_pickup",
        "drivo_rider_dropoff",
        "drivo_rider_driverinfo",
      ].forEach((k) => localStorage.removeItem(k));
    } else {
      localStorage.setItem("drivo_rider_stage", stage);
      if (ride) localStorage.setItem("drivo_rider_ride", JSON.stringify(ride));
      if (pickup)
        localStorage.setItem("drivo_rider_pickup", JSON.stringify(pickup));
      if (dropoff)
        localStorage.setItem("drivo_rider_dropoff", JSON.stringify(dropoff));
      if (driverInfo)
        localStorage.setItem(
          "drivo_rider_driverinfo",
          JSON.stringify(driverInfo),
        );
    }
  }, [stage, ride, pickup, dropoff, driverInfo]);

  // ── Reset function — stable reference via useCallback ─────────────────────────
  // Defined before WS useEffect so it can be used inside handlers safely via ref
  const resetRef = useRef(null);
  const reset = useCallback(() => {
    setStage(S.idle);
    setPickup(null);
    setDropoff(null);
    setRide(null);
    setDriverInfo(null);
    setDriverLoc(null);
    setCancelling(false);
    setPoolCheck(null);
    setRideMode("solo");
    setScheduledAt(null);
    setChatActive(false);
    setRouteInfo(null);
    setJoinedPoolInfo(null);
    [
      "drivo_rider_stage",
      "drivo_rider_ride",
      "drivo_rider_pickup",
      "drivo_rider_dropoff",
      "drivo_rider_driverinfo",
    ].forEach((k) => localStorage.removeItem(k));
  }, []);
  useEffect(() => {
    resetRef.current = reset;
  }, [reset]);

  // ── WebSocket — register handlers once, use refs for fresh state ──────────────
  useEffect(() => {
    riderWS.connect("/ws/rider");

    const unsubs = [
      riderWS.on("connected", () => {
        setWsOk(true);
      }),

      riderWS.on("disconnected", () => {
        setWsOk(false);
      }),

      riderWS.on("ride_accepted", (p) => {
        setDriverInfo(p);
        setStage(S.accepted);
        setChatActive(true);
        toast.success(`🚗 ${p.driver_name} is on the way!`);
      }),

      riderWS.on("driver_is_here", () => {
        setStage(S.arrived);
        toast.success("🎯 Your driver has arrived!");
      }),

      riderWS.on("ride_started", () => {
        setStage(S.ongoing);
        toast.success("🚀 Trip started!");
      }),

      riderWS.on("driver_location", (p) => {
        setDriverLoc({ lat: p.latitude, lng: p.longitude });
      }),

      riderWS.on("ride_completed", (p) => {
        // Use functional update — never depends on captured ride value
        setRide((prev) => ({ ...(prev || {}), ...p }));
        setStage(S.completed);
        setChatActive(false);
      }),

      riderWS.on("rate_driver", () => {
        setTimeout(() => setRatingOpen(true), 1200);
      }),

      riderWS.on("ride_cancelled_by_driver", (p) => {
        toast.error(p?.message || "Driver cancelled");
        setChatActive(false);
        resetRef.current?.();
      }),

      riderWS.on("ride_cancelled_by_rider", () => {
        setChatActive(false);
        resetRef.current?.();
      }),

      riderWS.on("no_candidates", (p) => {
        toast.error(p?.message || "No drivers available. Try again.");
        resetRef.current?.();
      }),

      riderWS.on("pool_ride_available", () => {
        toast("🚌 Pool ride available near you!", { duration: 5000 });
      }),

      riderWS.on("pool_ride_updated", (p) => {
        if (p.new_fare) {
          setRide((prev) =>
            prev ? { ...prev, estimated_fare: p.new_fare } : prev,
          );
          setJoinedPoolInfo((prev) =>
            prev
              ? {
                  ...prev,
                  fare_per_head: p.new_fare,
                  current_size: p.riders_count || prev.current_size,
                }
              : prev,
          );
          toast.success(p.message || "Pool fare updated!");
        }
      }),

      riderWS.on("pool_ride_started", () => {
        setStage(S.ongoing);
        toast.success("🚀 Pool trip started!");
      }),
    ];

    // FCM
    getFCMToken()
      .then((token) => {
        if (token) saveFCMToken(token).catch(() => {});
      })
      .catch(() => {});
    const unsubFCM = onForegroundMessage((payload) => {
      const type = payload.data?.type;
      if (type === "driver_arrived") {
        setStage(S.arrived);
        toast.success("🎯 Your driver arrived!");
      }
      if (type === "ride_completed") setStage(S.completed);
      if (type === "no_candidates") {
        toast.error("No drivers available.");
        resetRef.current?.();
      }
    });

    return () => {
      unsubs.forEach((f) => f?.());
      if (typeof unsubFCM === "function") unsubFCM();
      riderWS.disconnect();
      stopLocation();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Network reconnect — native + web ─────────────────────────────────────────
  // The websocket.js now handles the reconnect properly.
  // These listeners just trigger a fresh connect() call on data resume.
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      Network.addListener("networkStatusChange", (s) => {
        console.log("[Net] Status changed:", s.connected);
        if (s.connected) {
          // Small delay to let the OS fully establish the connection
          setTimeout(() => {
            riderWS.connect("/ws/rider");
            startLocation();
          }, 1000);
        }
      });
      return () => Network.removeAllListeners();
    }
    const onOnline = () => {
      console.log("[Net] Online event");
      setTimeout(() => {
        riderWS.connect("/ws/rider");
        startLocation();
      }, 500);
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── GPS ───────────────────────────────────────────────────────────────────────
  const startLocation = useCallback(async () => {
    if (Capacitor.isNativePlatform()) {
      if (bgRunning.current) return;
      bgRunning.current = true;
      await BackgroundGeolocation.start(
        {
          backgroundMessage: "Drivo is sharing your location with your driver.",
          backgroundTitle: "Drivo — Live",
          requestPermissions: true,
          stale: false,
          distanceFilter: 15,
        },
        (location, error) => {
          if (error || !location) {
            bgRunning.current = false;
            return;
          }
          const loc = { lat: location.latitude, lng: location.longitude };
          setRiderLoc(loc);
          if (riderWS.isConnected())
            riderWS.send("rider_location_update", {
              latitude: loc.lat,
              longitude: loc.lng,
            });
        },
      );
    } else {
      if (!navigator.geolocation || watchId.current) return;
      watchId.current = navigator.geolocation.watchPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setRiderLoc(loc);
          if (riderWS.isConnected())
            riderWS.send("rider_location_update", {
              latitude: loc.lat,
              longitude: loc.lng,
            });
        },
        () => {},
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 },
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
  }, []);

  // Start GPS when WS connects
  useEffect(() => {
    if (wsOk) startLocation();
  }, [wsOk, startLocation]);

  // ── Pool check ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pickup?.lat || !dropoff?.lat) {
      setPoolCheck(null);
      return;
    }
    setCheckingPool(true);
    const t = setTimeout(async () => {
      try {
        const r = await rideAPI.checkPool({
          pickup_lat: pickup.lat,
          pickup_lng: pickup.lng,
          dropoff_lat: dropoff.lat,
          dropoff_lng: dropoff.lng,
        });
        setPoolCheck(r.data);
      } catch {
        setPoolCheck(null);
      }
      setCheckingPool(false);
    }, 500);
    return () => {
      clearTimeout(t);
      setCheckingPool(false);
    };
  }, [pickup, dropoff]);

  const loadHistory = async () => {
    try {
      const r = await rideAPI.riderHistory();
      setHistory(r.data.rides || []);
    } catch {}
  };
  useEffect(() => {
    if (panel === "history") loadHistory();
  }, [panel]);

  // ── Request ride ──────────────────────────────────────────────────────────────
  const requestRide = async () => {
    if (!pickup?.lat || !dropoff?.lat) return;
    if (scheduledAt) {
      try {
        await rideAPI.request({
          pickup_lat: pickup.lat,
          pickup_lng: pickup.lng,
          dropoff_lat: dropoff.lat,
          dropoff_lng: dropoff.lng,
          pickup_address: pickup.address || "Pickup",
          dropoff_address: dropoff.address || "Dropoff",
          scheduled_at: scheduledAt,
        });
        toast.success(
          `✅ Scheduled for ${new Date(scheduledAt).toLocaleString("en-NG", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`,
        );
        reset();
      } catch (e) {
        toast.error(e.response?.data?.error || "Scheduling failed");
      }
      return;
    }
    setStage(S.searching);
    try {
      const body = {
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        dropoff_lat: dropoff.lat,
        dropoff_lng: dropoff.lng,
        pickup_address: pickup.address || "Pickup",
        dropoff_address: dropoff.address || "Dropoff",
      };
      if (rideMode === "pool" && poolCheck?.has_pool && poolCheck?.pool?.id) {
        const r = await rideAPI.joinPool({
          pool_id: poolCheck.pool.id,
          ...body,
        });
        if (stageRef.current === S.searching) {
          setRide(r.data.ride);
          setJoinedPoolInfo(poolCheck?.pool || null);
          setStage(S.accepted);
          setChatActive(true);
          toast.success("🚌 Joined pool ride!");
        }
        return;
      }
      const res = await rideAPI.request(body);
      if (stageRef.current === S.searching) setRide(res.data);
    } catch (e) {
      if (stageRef.current === S.searching) {
        toast.error(e.response?.data?.error || "Request failed");
        setStage(S.idle);
      }
    }
  };

  // ── Cancel ride ───────────────────────────────────────────────────────────────
  const cancelRide = async () => {
    if (cancelling) return;
    const rideId =
      ride?.ride_id || ride?.ID || ride?.id || rideRef.current?.ride_id;
    if (!rideId) {
      reset();
      toast("Search cancelled");
      return;
    }
    setCancelling(true);
    try {
      await rideAPI.cancel({ ride_id: rideId });
      reset();
      toast("Ride cancelled");
    } catch (e) {
      const msg = e.response?.data?.error || "";
      if (
        msg.includes("cancelled") ||
        msg.includes("status") ||
        msg.includes("cannot cancel")
      ) {
        reset();
        return;
      }
      toast.error(msg || "Cancel failed");
      setCancelling(false);
    }
  };

  const submitRating = async () => {
    if (!rating || !ride) return;
    try {
      await ratingAPI.rateDriver({
        ride_id: ride.ride_id,
        score: rating,
        comment,
      });
      toast.success("Thanks! ⭐");
      setRatingOpen(false);
      reset();
      setRating(0);
      setComment("");
    } catch {
      toast.error("Rating failed");
    }
  };

  const fmt = (f) => (f ? `₦${Number(f).toLocaleString()}` : "—");

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    riderWS.connect("/ws/rider");
    await loadHistory().catch(() => {});
    setTimeout(() => setRefreshing(false), 1200);
  };
  const isActiveRide = [S.accepted, S.arrived, S.ongoing].includes(stage);
  const rideId = ride?.ride_id || ride?.ID || ride?.id;

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
    driverInfo,
    history,
    pickup,
    dropoff,
    setPickup,
    setDropoff,
    reset,
    requestRide,
    cancelRide,
    fmt,
    setRatingOpen,
    rideMode,
    setRideMode,
    poolCheck,
    checkingPool,
    scheduledAt,
    setScheduledAt,
    routeInfo,
    joinedPoolInfo,
    onSchedule: () => setScheduleOpen(true),
    onRecurring: () => setRecurringOpen(true),
    onRefresh: handleRefresh,
    refreshing,
  };

  return (
    <div
      className={`flex h-screen w-screen overflow-hidden ${isDark ? "bg-[#0a0a0f]" : "bg-slate-50"} font-sans`}
    >
      {/* Mobile sidebar */}
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
              <SidebarContent {...sideProps} />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Desktop sidebar */}
      <div
        className="hidden lg:flex w-[390px] flex-shrink-0 flex-col border-r z-10"
        style={{
          background: isDark ? "#0f0f18" : "#fff",
          borderColor: isDark ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.07)",
        }}
      >
        <SidebarContent {...sideProps} />
      </div>

      {/* Map */}
      <div className="flex-1 relative overflow-hidden">
        <DrivoMap
          pickupLoc={pickup}
          dropoffLoc={dropoff}
          driverLoc={driverLoc}
          riderLoc={riderLoc}
          stage={stage}
          onRouteCalculated={(d, t) =>
            setRouteInfo({ distKm: d, durationMin: t })
          }
        />

        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 safe-top pointer-events-none">
          <button
            onClick={() => setSideOpen(true)}
            className="lg:hidden pointer-events-auto w-11 h-11 rounded-2xl flex items-center justify-center shadow-lg border border-white/20 text-zinc-700 dark:text-zinc-100 active:scale-95 transition-all"
            style={{
              background: isDark
                ? "rgba(15,15,24,.85)"
                : "rgba(255,255,255,.85)",
              backdropFilter: "blur(20px)",
            }}
          >
            <Menu size={20} />
          </button>
          <div className="ml-auto pointer-events-auto">
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border border-white/20 ${wsOk ? "text-brand" : "text-red-400"}`}
              style={{
                background: isDark
                  ? "rgba(15,15,24,.85)"
                  : "rgba(255,255,255,.85)",
                backdropFilter: "blur(20px)",
              }}
            >
              {wsOk ? <Wifi size={11} /> : <WifiOff size={11} />}
              {wsOk ? "Live" : "Offline"}
            </div>
          </div>
        </div>

        {/* Chat bubble */}
        <AnimatePresence>
          {isActiveRide && rideId && (
            <motion.div
              className="absolute bottom-24 right-4"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
            >
              <ChatBox
                rideId={rideId}
                senderType="rider"
                ws={riderWS}
                otherName={driverInfo?.driver_name}
                isActive={chatActive}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mobile bottom sheet */}
        <AnimatePresence>
          {[S.accepted, S.arrived, S.ongoing, S.completed].includes(stage) && (
            <motion.div
              className="absolute bottom-0 left-0 right-0 lg:hidden rounded-t-3xl p-5 safe-bottom z-10 border-t border-white/10"
              style={{
                background: isDark
                  ? "rgba(15,15,24,.95)"
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
                style={{
                  background: isDark
                    ? "rgba(255,255,255,.2)"
                    : "rgba(0,0,0,.15)",
                }}
              />
              <MobileStatus
                stage={stage}
                ride={ride}
                driverInfo={driverInfo}
                cancelRide={cancelRide}
                fmt={fmt}
                setRatingOpen={setRatingOpen}
                reset={reset}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Rating modal */}
      <Modal
        open={ratingOpen}
        onClose={() => setRatingOpen(false)}
        title="Rate your driver"
      >
        <div className="flex flex-col gap-5">
          {driverInfo && (
            <div
              className="flex items-center gap-3 p-4 rounded-2xl"
              style={{
                background: isDark
                  ? "rgba(255,255,255,.05)"
                  : "rgba(0,0,0,.04)",
              }}
            >
              <div className="w-14 h-14 bg-brand/10 rounded-2xl flex items-center justify-center text-2xl font-black text-brand">
                {driverInfo.driver_name?.[0]}
              </div>
              <div>
                <p className="font-bold text-zinc-900 dark:text-white">
                  {driverInfo.driver_name}
                </p>
                <p className="text-sm text-zinc-500">
                  {driverInfo.vehicle_make} {driverInfo.vehicle_model}
                </p>
              </div>
            </div>
          )}
          <div className="text-center">
            <p className="text-zinc-500 text-sm mb-4">
              How was your experience?
            </p>
            <div className="flex justify-center">
              <StarRating value={rating} onChange={setRating} />
            </div>
          </div>
          <textarea
            className="w-full p-4 rounded-2xl text-sm placeholder-zinc-400 focus:outline-none resize-none border-2 border-transparent focus:border-brand transition-all"
            style={{
              background: isDark ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.04)",
              color: isDark ? "#fff" : "#000",
            }}
            rows={3}
            placeholder="Leave a comment (optional)..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className="flex gap-3">
            <Btn
              variant="ghost"
              className="flex-1"
              onClick={() => {
                setRatingOpen(false);
                reset();
              }}
            >
              Skip
            </Btn>
            <Btn className="flex-1" onClick={submitRating} disabled={!rating}>
              Submit ⭐
            </Btn>
          </div>
        </div>
      </Modal>

      <ScheduleModal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onConfirm={(iso) => {
          setScheduledAt(iso);
          toast(
            `📅 ${new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
            { icon: "⏰" },
          );
        }}
      />
      <RecurringModal
        open={recurringOpen}
        onClose={() => setRecurringOpen(false)}
        pickup={pickup}
        dropoff={dropoff}
      />
    </div>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────────

function SidebarContent({
  user,
  panel,
  setPanel,
  isDark,
  toggle,
  wsOk,
  logout,
  stage,
  ride,
  driverInfo,
  history,
  pickup,
  dropoff,
  setPickup,
  setDropoff,
  reset,
  requestRide,
  cancelRide,
  fmt,
  setRatingOpen,
  rideMode,
  setRideMode,
  poolCheck,
  checkingPool,
  scheduledAt,
  setScheduledAt,
  routeInfo,
  joinedPoolInfo,
  onSchedule,
  onRecurring,
  onRefresh,
  refreshing,
}) {
  const isIdle = [S.idle, S.searching].includes(stage);
  const borderColor = isDark ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.07)";
  const mutedBg = isDark ? "rgba(255,255,255,.04)" : "rgba(0,0,0,.03)";

  return (
    <div className="flex flex-col h-full">
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
              color: isDark ? "rgba(255,255,255,.4)" : "rgba(0,0,0,.4)",
            }}
          >
            Rider dashboard
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
              className={refreshing ? "animate-spin" : ""}
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

      {isIdle && (
        <div
          className="px-5 py-3 flex-shrink-0"
          style={{ borderBottom: `1px solid ${borderColor}` }}
        >
          <p
            className="text-xs font-semibold"
            style={{
              color: isDark ? "rgba(255,255,255,.35)" : "rgba(0,0,0,.35)",
            }}
          >
            Good{" "}
            {new Date().getHours() < 12
              ? "morning"
              : new Date().getHours() < 18
                ? "afternoon"
                : "evening"}{" "}
            👋
          </p>
          <p
            className="font-bold text-base mt-0.5 truncate"
            style={{ color: isDark ? "#fff" : "#0a0a0f" }}
          >
            {user?.Name}
          </p>
        </div>
      )}

      <div
        className="flex px-3 pt-2 gap-1 flex-shrink-0"
        style={{ borderBottom: `1px solid ${borderColor}` }}
      >
        {[
          { k: "ride", icon: "🚗", label: "Ride" },
          { k: "history", icon: "📋", label: "History" },
          { k: "profile", icon: "👤", label: "Profile" },
        ].map(({ k, icon, label }) => (
          <button
            key={k}
            onClick={() => setPanel(k)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all mb-2 ${panel === k ? "bg-brand text-black" : "text-zinc-400"}`}
          >
            <span className="text-sm">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide px-4 py-4 space-y-3">
        {panel === "ride" &&
          (isIdle ? (
            <BookingPanel
              pickup={pickup}
              dropoff={dropoff}
              setPickup={setPickup}
              setDropoff={setDropoff}
              rideMode={rideMode}
              setRideMode={setRideMode}
              poolCheck={poolCheck}
              checkingPool={checkingPool}
              scheduledAt={scheduledAt}
              setScheduledAt={setScheduledAt}
              routeInfo={routeInfo}
              onSchedule={onSchedule}
              onRecurring={onRecurring}
              requestRide={requestRide}
              cancelRide={cancelRide}
              stage={stage}
              ride={ride}
              fmt={fmt}
              isDark={isDark}
            />
          ) : (
            <ActiveRidePanel
              stage={stage}
              ride={ride}
              driverInfo={driverInfo}
              cancelRide={cancelRide}
              fmt={fmt}
              setRatingOpen={setRatingOpen}
              reset={reset}
              joinedPoolInfo={joinedPoolInfo}
              isDark={isDark}
            />
          ))}
        {panel === "history" && (
          <HistoryPanel history={history} fmt={fmt} isDark={isDark} />
        )}
        {panel === "profile" && (
          <ProfilePanel user={user} logout={logout} isDark={isDark} />
        )}
      </div>
    </div>
  );
}

// ── Booking panel ─────────────────────────────────────────────────────────────

function BookingPanel({
  pickup,
  dropoff,
  setPickup,
  setDropoff,
  rideMode,
  setRideMode,
  poolCheck,
  checkingPool,
  scheduledAt,
  setScheduledAt,
  routeInfo,
  onSchedule,
  onRecurring,
  requestRide,
  cancelRide,
  stage,
  ride,
  fmt,
  isDark,
}) {
  const canRequest = pickup?.lat && dropoff?.lat;
  const isSearching = stage === "searching";
  const mutedBg = isDark ? "rgba(255,255,255,.05)" : "rgba(0,0,0,.04)";
  const cardBorder = isDark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.08)";

  if (isSearching)
    return (
      <motion.div
        className="space-y-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div
          className="rounded-3xl p-8 text-center border"
          style={{ background: mutedBg, borderColor: cardBorder }}
        >
          <div className="relative w-20 h-20 mx-auto mb-5">
            <div className="absolute inset-0 border-4 border-brand/20 rounded-full" />
            <div className="absolute inset-0 border-4 border-transparent border-t-brand rounded-full animate-spin" />
            <span className="absolute inset-0 flex items-center justify-center text-3xl">
              🔍
            </span>
          </div>
          <p
            className="font-black text-xl tracking-tight"
            style={{ color: isDark ? "#fff" : "#0a0a0f" }}
          >
            Finding your driver
          </p>
          <p
            className="text-sm mt-1.5"
            style={{
              color: isDark ? "rgba(255,255,255,.4)" : "rgba(0,0,0,.4)",
            }}
          >
            Matching with nearby drivers...
          </p>
          {ride && (
            <p className="text-brand font-black text-4xl mt-4">
              {fmt(ride.estimated_fare)}
            </p>
          )}
          {routeInfo && (
            <p
              className="text-xs mt-1.5"
              style={{
                color: isDark ? "rgba(255,255,255,.35)" : "rgba(0,0,0,.35)",
              }}
            >
              {routeInfo.distKm?.toFixed(1)}km · ~{routeInfo.durationMin}min
            </p>
          )}
        </div>
        <button
          onClick={cancelRide}
          className="w-full py-3.5 rounded-2xl text-sm font-bold text-red-400 border border-red-500/20 active:scale-[0.98] transition-all"
          style={{
            background: isDark ? "rgba(239,68,68,.08)" : "rgba(239,68,68,.06)",
          }}
        >
          Cancel Search
        </button>
      </motion.div>
    );

  return (
    <div className="space-y-3">
      <AnimatePresence>
        {scheduledAt && (
          <motion.div
            className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl border border-brand/25"
            style={{ background: "rgba(0,200,83,.08)" }}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <Clock size={13} className="text-brand flex-shrink-0" />
            <p className="text-xs font-semibold text-brand flex-1 truncate">
              {new Date(scheduledAt).toLocaleString("en-NG", {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
            <button
              onClick={() => setScheduledAt(null)}
              className="text-brand/50 hover:text-red-400 transition-colors"
            >
              <X size={13} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <LocationSearch
        onPickup={setPickup}
        onDropoff={setDropoff}
        onRequest={requestRide}
        stage={stage}
        ride={ride}
        fmt={fmt}
        cancelRide={cancelRide}
      />

      <AnimatePresence>
        {canRequest && (
          <motion.div
            className="space-y-3"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {routeInfo && (
              <div
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border"
                style={{ background: mutedBg, borderColor: cardBorder }}
              >
                <span className="font-black text-sm text-brand">
                  {routeInfo.distKm < 1
                    ? `${Math.round(routeInfo.distKm * 1000)}m`
                    : `${routeInfo.distKm.toFixed(1)}km`}
                </span>
                <span className="w-1 h-1 rounded-full bg-zinc-400" />
                <span
                  className="text-xs"
                  style={{
                    color: isDark ? "rgba(255,255,255,.4)" : "rgba(0,0,0,.4)",
                  }}
                >
                  ~{routeInfo.durationMin} min
                </span>
                <span className="w-1 h-1 rounded-full bg-zinc-400" />
                <span className="text-xs font-bold text-brand">
                  ~
                  {fmt(
                    Math.round(
                      (500 +
                        routeInfo.distKm * 150 +
                        routeInfo.durationMin * 20) /
                        50,
                    ) * 50,
                  )}
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              {[
                {
                  mode: "solo",
                  icon: "🚀",
                  label: "Solo",
                  sub: "Just you",
                  extra: null,
                },
                {
                  mode: "pool",
                  icon: "🚌",
                  label: "Pool",
                  sub: "Share & save",
                  extra: poolCheck?.has_pool
                    ? `${poolCheck.riders_in_pool} riding`
                    : null,
                },
              ].map(({ mode, icon, label, sub, extra }) => (
                <button
                  key={mode}
                  onClick={() => setRideMode(mode)}
                  className="relative p-4 rounded-2xl border-2 text-left transition-all active:scale-[0.97]"
                  style={{
                    borderColor: rideMode === mode ? "#00C853" : cardBorder,
                    background:
                      rideMode === mode ? "rgba(0,200,83,.08)" : mutedBg,
                  }}
                >
                  {extra && (
                    <span className="absolute -top-2 -right-2 bg-brand text-black text-[9px] font-black px-1.5 py-0.5 rounded-full">
                      {extra}
                    </span>
                  )}
                  {checkingPool && mode === "pool" && (
                    <div className="absolute top-2 right-2 w-3 h-3 border border-brand/30 border-t-brand rounded-full animate-spin" />
                  )}
                  <span className="text-xl">{icon}</span>
                  <p
                    className="font-black text-sm mt-1.5"
                    style={{ color: isDark ? "#fff" : "#0a0a0f" }}
                  >
                    {label}
                  </p>
                  <p
                    className="text-[11px] mt-0.5"
                    style={{
                      color: isDark
                        ? "rgba(255,255,255,.35)"
                        : "rgba(0,0,0,.4)",
                    }}
                  >
                    {sub}
                  </p>
                  {mode === "pool" && poolCheck?.has_pool && (
                    <p className="text-xs font-bold text-brand mt-1.5">
                      {fmt(poolCheck.estimated_fare)}
                    </p>
                  )}
                </button>
              ))}
            </div>

            <AnimatePresence>
              {rideMode === "pool" && poolCheck && (
                <motion.div
                  className="px-3.5 py-2.5 rounded-xl text-xs border"
                  style={{
                    background: poolCheck.has_pool
                      ? "rgba(0,200,83,.07)"
                      : mutedBg,
                    borderColor: poolCheck.has_pool
                      ? "rgba(0,200,83,.25)"
                      : cardBorder,
                  }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  {poolCheck.has_pool ? (
                    <span
                      style={{
                        color: isDark
                          ? "rgba(255,255,255,.7)"
                          : "rgba(0,0,0,.65)",
                      }}
                    >
                      🎉 Pool available — {poolCheck.riders_in_pool} rider
                      {poolCheck.riders_in_pool > 1 ? "s" : ""} going your way ·
                      save{" "}
                      <span className="font-bold text-brand">
                        {fmt(poolCheck.savings)}
                      </span>
                    </span>
                  ) : (
                    <span
                      style={{
                        color: isDark
                          ? "rgba(255,255,255,.4)"
                          : "rgba(0,0,0,.4)",
                      }}
                    >
                      🌱 No pool yet nearby — fare drops as riders join
                    </span>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="grid grid-cols-2 gap-2">
              {[
                {
                  label: "Schedule",
                  sublabel: scheduledAt
                    ? new Date(scheduledAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "Book ahead",
                  icon: <Clock size={14} />,
                  active: !!scheduledAt,
                  onClick: onSchedule,
                },
                {
                  label: "Recurring",
                  sublabel: "Auto-book daily",
                  icon: <RefreshCw size={14} />,
                  active: false,
                  onClick: onRecurring,
                },
              ].map(({ label, sublabel, icon, active, onClick }) => (
                <button
                  key={label}
                  onClick={onClick}
                  className="flex items-center gap-2.5 px-3 py-3 rounded-2xl border text-left transition-all active:scale-[0.97]"
                  style={{
                    borderColor: active ? "#00C853" : cardBorder,
                    background: active ? "rgba(0,200,83,.08)" : mutedBg,
                  }}
                >
                  <div
                    className={`w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 ${active ? "bg-brand text-black" : "text-zinc-400"}`}
                    style={
                      active
                        ? {}
                        : {
                            background: isDark
                              ? "rgba(255,255,255,.08)"
                              : "rgba(0,0,0,.06)",
                          }
                    }
                  >
                    {icon}
                  </div>
                  <div className="min-w-0">
                    <p
                      className="text-xs font-bold truncate"
                      style={{ color: isDark ? "#fff" : "#0a0a0f" }}
                    >
                      {label}
                    </p>
                    <p
                      className="text-[10px] truncate"
                      style={{
                        color: isDark
                          ? "rgba(255,255,255,.35)"
                          : "rgba(0,0,0,.4)",
                      }}
                    >
                      {sublabel}
                    </p>
                  </div>
                </button>
              ))}
            </div>

            <button
              onClick={requestRide}
              className="w-full py-4 rounded-2xl font-black text-sm tracking-wide flex items-center justify-center gap-2.5 active:scale-[0.98] transition-all"
              style={{
                background: "linear-gradient(135deg,#00C853,#00A843)",
                color: "#000",
                boxShadow: "0 4px 20px rgba(0,200,83,.4)",
              }}
            >
              <Navigation size={16} />
              {scheduledAt
                ? "Schedule Ride"
                : rideMode === "pool" && poolCheck?.has_pool
                  ? "Join Pool Ride"
                  : "Request Ride"}
              <ChevronRight size={16} className="ml-auto" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Active ride panel ─────────────────────────────────────────────────────────

function ActiveRidePanel({
  stage,
  ride,
  driverInfo,
  cancelRide,
  fmt,
  setRatingOpen,
  reset,
  joinedPoolInfo,
  isDark,
}) {
  const mutedBg = isDark ? "rgba(255,255,255,.05)" : "rgba(0,0,0,.03)";
  const cardBorder = isDark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.07)";

  // Pool join: joinedPoolInfo is set, driverInfo may be null — show pool card either way
  if (stage === S.accepted && (driverInfo || joinedPoolInfo))
    return (
      <motion.div
        className="space-y-3"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        {/* Only show driver card if we have driver info (solo rides) */}
        {driverInfo && (
          <div
            className="rounded-3xl p-5 border"
            style={{ background: mutedBg, borderColor: cardBorder }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-14 h-14 bg-brand/10 rounded-2xl flex items-center justify-center text-2xl font-black text-brand flex-shrink-0">
                {driverInfo.driver_name?.[0]}
              </div>
              <div className="flex-1">
                <p
                  className="font-black text-base tracking-tight"
                  style={{ color: isDark ? "#fff" : "#0a0a0f" }}
                >
                  {driverInfo.driver_name}
                </p>
                <p
                  className="text-xs mt-0.5"
                  style={{
                    color: isDark ? "rgba(255,255,255,.4)" : "rgba(0,0,0,.4)",
                  }}
                >
                  {driverInfo.driver_phone}
                </p>
                <div className="flex items-center gap-1 mt-1">
                  <Star size={11} className="text-amber-400 fill-amber-400" />
                  <span
                    className="text-xs font-bold"
                    style={{
                      color: isDark ? "rgba(255,255,255,.7)" : "rgba(0,0,0,.7)",
                    }}
                  >
                    {driverInfo.rating?.toFixed(1)}
                  </span>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-brand/10 text-brand text-xs font-black">
                ETA {driverInfo.eta_minutes}m
              </span>
            </div>
            <div
              className="grid grid-cols-3 gap-2 rounded-2xl p-3"
              style={{
                background: isDark
                  ? "rgba(255,255,255,.04)"
                  : "rgba(0,0,0,.04)",
              }}
            >
              {[
                ["Make", driverInfo.vehicle_make || "—"],
                ["Model", driverInfo.vehicle_model || "—"],
                ["Plate", driverInfo.plate_number || "—"],
              ].map(([l, v]) => (
                <div key={l}>
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
                  <p
                    className="text-xs font-bold mt-0.5 truncate"
                    style={{ color: isDark ? "#fff" : "#0a0a0f" }}
                  >
                    {v}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
        {joinedPoolInfo && (
          <div
            className="rounded-2xl p-4 border border-brand/25"
            style={{ background: "rgba(0,200,83,.07)" }}
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">🚌</span>
              <p
                className="text-sm font-black"
                style={{ color: isDark ? "#fff" : "#0a0a0f" }}
              >
                You're in a pool ride
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ["Your fare", fmt(ride?.estimated_fare)],
                ["Riders", joinedPoolInfo.current_size || 1],
                ["Max", joinedPoolInfo.max_riders || 3],
              ].map(([l, v]) => (
                <div
                  key={l}
                  className="rounded-xl p-2"
                  style={{
                    background: isDark
                      ? "rgba(0,0,0,.25)"
                      : "rgba(255,255,255,.7)",
                  }}
                >
                  <p
                    className="font-black text-sm"
                    style={{ color: isDark ? "#fff" : "#0a0a0f" }}
                  >
                    {v}
                  </p>
                  <p
                    className="text-[10px]"
                    style={{
                      color: isDark ? "rgba(255,255,255,.4)" : "rgba(0,0,0,.4)",
                    }}
                  >
                    {l}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-center mt-2.5 text-brand">
              Fare may drop as more riders join ↓
            </p>
          </div>
        )}
        <button
          onClick={cancelRide}
          className="w-full py-3.5 rounded-2xl text-sm font-bold text-red-400 border border-red-500/20 active:scale-[0.98] transition-all"
          style={{ background: "rgba(239,68,68,.07)" }}
        >
          Cancel Ride
        </button>
      </motion.div>
    );

  if (stage === S.arrived)
    return (
      <motion.div
        className="space-y-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div
          className="rounded-3xl p-7 text-center border border-brand/25"
          style={{ background: "rgba(0,200,83,.07)" }}
        >
          <motion.div
            className="text-6xl mb-4"
            animate={{ scale: [1, 1.12, 1] }}
            transition={{ repeat: 3, duration: 0.5 }}
          >
            🎯
          </motion.div>
          <p
            className="font-black text-xl tracking-tight"
            style={{ color: isDark ? "#fff" : "#0a0a0f" }}
          >
            Driver has arrived!
          </p>
          <p
            className="text-sm mt-1.5"
            style={{
              color: isDark ? "rgba(255,255,255,.45)" : "rgba(0,0,0,.45)",
            }}
          >
            Head to your pickup location
          </p>
          {driverInfo && (
            <div
              className="mt-4 pt-4 border-t border-brand/20 text-xs"
              style={{
                color: isDark ? "rgba(255,255,255,.4)" : "rgba(0,0,0,.5)",
              }}
            >
              Look for{" "}
              <span
                className="font-bold"
                style={{ color: isDark ? "#fff" : "#0a0a0f" }}
              >
                {driverInfo.vehicle_color} {driverInfo.vehicle_make}
              </span>{" "}
              ·{" "}
              <span
                className="font-bold"
                style={{ color: isDark ? "#fff" : "#0a0a0f" }}
              >
                {driverInfo.plate_number}
              </span>
            </div>
          )}
        </div>
      </motion.div>
    );

  if (stage === S.ongoing)
    return (
      <motion.div
        className="space-y-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div
          className="rounded-3xl p-7 text-center border"
          style={{
            background: isDark ? "rgba(255,255,255,.04)" : "rgba(0,0,0,.03)",
            borderColor: isDark ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.07)",
          }}
        >
          <motion.div
            className="text-6xl mb-4"
            animate={{ x: [-4, 4, -4] }}
            transition={{ repeat: Infinity, duration: 0.8 }}
          >
            🚗
          </motion.div>
          <p
            className="font-black text-xl tracking-tight"
            style={{ color: isDark ? "#fff" : "#0a0a0f" }}
          >
            Trip in progress
          </p>
          <p
            className="text-sm mt-1.5 mb-4"
            style={{
              color: isDark ? "rgba(255,255,255,.4)" : "rgba(0,0,0,.4)",
            }}
          >
            Sit back and enjoy the ride
          </p>
          {ride && (
            <p className="text-brand font-black text-4xl">
              {fmt(ride.estimated_fare)}
            </p>
          )}
          {ride?.distance_km && (
            <p
              className="text-xs mt-1.5"
              style={{
                color: isDark ? "rgba(255,255,255,.35)" : "rgba(0,0,0,.35)",
              }}
            >
              {ride.distance_km.toFixed(1)} km
            </p>
          )}
        </div>
      </motion.div>
    );

  if (stage === S.completed)
    return (
      <motion.div
        className="space-y-4"
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
            animate={{ rotate: [0, 10, -10, 0] }}
            transition={{ duration: 0.7 }}
          >
            🏁
          </motion.div>
          <p
            className="font-black text-2xl tracking-tight"
            style={{ color: isDark ? "#fff" : "#0a0a0f" }}
          >
            Trip Complete!
          </p>
          {ride?.actual_fare && (
            <p className="text-brand font-black text-4xl mt-2">
              {fmt(ride.actual_fare)}
            </p>
          )}
          {ride?.distance_km && (
            <p
              className="text-sm mt-1.5"
              style={{
                color: isDark ? "rgba(255,255,255,.4)" : "rgba(0,0,0,.4)",
              }}
            >
              {ride.distance_km.toFixed(2)} km covered
            </p>
          )}
        </div>
        <button
          onClick={() => setRatingOpen(true)}
          className="w-full py-4 rounded-2xl font-black text-sm"
          style={{
            background: "linear-gradient(135deg,#00C853,#00A843)",
            color: "#000",
            boxShadow: "0 4px 20px rgba(0,200,83,.35)",
          }}
        >
          ⭐ Rate your driver
        </button>
        <Btn variant="ghost" onClick={reset}>
          Done
        </Btn>
      </motion.div>
    );

  return null;
}

// ── Mobile status ─────────────────────────────────────────────────────────────

function MobileStatus({
  stage,
  ride,
  driverInfo,
  cancelRide,
  fmt,
  setRatingOpen,
  reset,
}) {
  if (stage === S.accepted && driverInfo)
    return (
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-brand/10 rounded-xl flex items-center justify-center text-xl font-black text-brand flex-shrink-0">
          {driverInfo.driver_name?.[0]}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-zinc-900 dark:text-white truncate">
            {driverInfo.driver_name}
          </p>
          <p className="text-xs text-zinc-500">
            {driverInfo.vehicle_make} · ETA {driverInfo.eta_minutes}min
          </p>
        </div>
        <p className="text-brand font-black flex-shrink-0">
          {fmt(ride?.estimated_fare)}
        </p>
      </div>
    );
  if (stage === S.arrived)
    return (
      <div className="text-center">
        <p className="text-lg font-bold text-zinc-900 dark:text-white">
          🎯 Driver arrived!
        </p>
        <p className="text-sm text-zinc-500 mt-1">
          Look for{" "}
          <span className="font-semibold">
            {driverInfo?.vehicle_color} {driverInfo?.vehicle_make}
          </span>
        </p>
      </div>
    );
  if (stage === S.ongoing)
    return (
      <div className="flex items-center justify-between">
        <div>
          <p className="font-bold text-zinc-900 dark:text-white">
            🚗 Trip in progress
          </p>
          <p className="text-sm text-zinc-500">Heading to destination</p>
        </div>
        <p className="text-brand font-black text-xl">
          {fmt(ride?.estimated_fare)}
        </p>
      </div>
    );
  if (stage === S.completed)
    return (
      <div className="text-center space-y-3">
        <p className="font-black text-xl text-zinc-900 dark:text-white">
          🏁 Trip Complete!
        </p>
        {ride?.actual_fare && (
          <p className="text-brand text-3xl font-black">
            {fmt(ride.actual_fare)}
          </p>
        )}
        <div className="flex gap-2">
          <Btn variant="ghost" className="flex-1" onClick={reset}>
            Done
          </Btn>
          <Btn className="flex-1" onClick={() => setRatingOpen(true)}>
            Rate ⭐
          </Btn>
        </div>
      </div>
    );
  return null;
}

// ── History + Profile ─────────────────────────────────────────────────────────

function HistoryPanel({ history, fmt, isDark }) {
  const mutedBg = isDark ? "rgba(255,255,255,.04)" : "rgba(0,0,0,.03)";
  if (history.length === 0)
    return (
      <EmptyState
        icon="🗺️"
        title="No rides yet"
        subtitle="Your ride history appears here"
      />
    );
  return (
    <div className="space-y-2">
      {history.map((r, i) => (
        <div
          key={r.ID || i}
          className="p-4 rounded-2xl border"
          style={{
            background: mutedBg,
            borderColor: isDark ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.07)",
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap mb-2">
                <Badge
                  color={
                    r.Status === "completed"
                      ? "green"
                      : r.Status === "cancelled"
                        ? "red"
                        : r.Status === "scheduled"
                          ? "blue"
                          : "yellow"
                  }
                >
                  {r.Status}
                </Badge>
                {r.IsScheduled && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                    style={{
                      background: "rgba(59,130,246,.12)",
                      color: "#3b82f6",
                    }}
                  >
                    🕐 Scheduled
                  </span>
                )}
                {r.RideMode === "pool" && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                    style={{
                      background: "rgba(0,200,83,.1)",
                      color: "#00C853",
                    }}
                  >
                    🚌 Pool
                  </span>
                )}
              </div>
              <p
                className="text-sm font-semibold truncate"
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
              <p
                className="text-xs mt-1"
                style={{
                  color: isDark ? "rgba(255,255,255,.25)" : "rgba(0,0,0,.3)",
                }}
              >
                {r.IsScheduled && r.ScheduledAt
                  ? `📅 ${new Date(r.ScheduledAt).toLocaleString()}`
                  : new Date(r.CreatedAt).toLocaleDateString()}
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="font-black text-brand">
                {fmt(r.ActualFare || r.EstimatedFare)}
              </p>
              <p
                className="text-xs mt-0.5"
                style={{
                  color: isDark ? "rgba(255,255,255,.3)" : "rgba(0,0,0,.35)",
                }}
              >
                {r.DistanceKm?.toFixed(1)}km
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ProfilePanel({ user, logout, isDark }) {
  const mutedBg = isDark ? "rgba(255,255,255,.04)" : "rgba(0,0,0,.03)";
  return (
    <div className="space-y-3">
      <div
        className="rounded-3xl p-6 text-center border"
        style={{
          background: mutedBg,
          borderColor: isDark ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.07)",
        }}
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
          style={{ color: isDark ? "rgba(255,255,255,.4)" : "rgba(0,0,0,.45)" }}
        >
          {user?.Email}
        </p>
        <div className="flex items-center justify-center gap-1.5 mt-2">
          <Shield size={12} className="text-brand" />
          <p className="text-xs text-brand font-semibold">Verified rider</p>
        </div>
      </div>
      <Btn variant="danger" onClick={logout}>
        <LogOut size={16} /> Sign Out
      </Btn>
    </div>
  );
}
