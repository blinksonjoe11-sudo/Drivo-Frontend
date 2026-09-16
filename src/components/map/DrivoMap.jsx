import { useEffect, useRef, useState } from "react";
import { useTheme } from "../../context/ThemeContext";

const KEY = import.meta.env.VITE_MAPTILER_KEY || "";
const LAGOS = [3.3792, 6.5244];

// ── Style URLs ────────────────────────────────────────────────────────────────
const STYLES = {
  streets: (dark) =>
    dark
      ? `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${KEY}`
      : `https://api.maptiler.com/maps/streets-v2/style.json?key=${KEY}`,
  satellite: () => `https://api.maptiler.com/maps/hybrid/style.json?key=${KEY}`,
};

// ── MapTiler Directions v2 — road-snapped route ───────────────────────────────
async function fetchRoute(from, to) {
  if (!KEY) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    // Use profile=driving, geometries=geojson, steps=false
    const url = `https://api.maptiler.com/directions/v2/driving/${from.lng},${from.lat};${to.lng},${to.lat}?key=${KEY}&geometries=geojson&steps=false&overview=full`;
    const r = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!r.ok) {
      console.warn(
        "[Route] API error:",
        r.status,
        await r.text().catch(() => ""),
      );
      return null;
    }
    const d = await r.json();
    // MapTiler Directions v2 response: { routes: [{ geometry, distance, duration }] }
    const route = d.routes?.[0];
    if (!route?.geometry?.coordinates?.length) return null;
    return {
      coords: route.geometry.coordinates, // [[lng, lat], ...]
      distanceKm: route.distance / 1000,
      durationMin: Math.round(route.duration / 60),
    };
  } catch (e) {
    clearTimeout(timeout);
    if (e.name !== "AbortError")
      console.warn("[Route] fetch failed:", e.message);
    return null;
  }
}

// ── Bezier fallback ───────────────────────────────────────────────────────────
function bezierCoords(from, to) {
  const dx = to.lng - from.lng,
    dy = to.lat - from.lat;
  const px = -dy * 0.3,
    py = dx * 0.3;
  const coords = [];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80,
      mt = 1 - t;
    coords.push([
      mt * mt * mt * from.lng +
        3 * mt * mt * t * (from.lng + dx * 0.25 + px) +
        3 * mt * t * t * (from.lng + dx * 0.75 - px) +
        t * t * t * to.lng,
      mt * mt * mt * from.lat +
        3 * mt * mt * t * (from.lat + dy * 0.25 + py) +
        3 * mt * t * t * (from.lat + dy * 0.75 - py) +
        t * t * t * to.lat,
    ]);
  }
  return coords;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371,
    dLat = ((lat2 - lat1) * Math.PI) / 180,
    dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── MapLibre loader ───────────────────────────────────────────────────────────
let mlReady = false,
  mlCbs = [];
function loadMapLibre() {
  return new Promise((resolve) => {
    if (window.maplibregl) {
      resolve();
      return;
    }
    if (mlReady) {
      mlCbs.push(resolve);
      return;
    }
    mlReady = true;
    mlCbs.push(resolve);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css";
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = "https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js";
    script.async = true;
    script.onload = () => {
      mlCbs.forEach((cb) => cb());
      mlCbs = [];
    };
    document.head.appendChild(script);
  });
}

export default function DrivoMap({
  pickupLoc,
  dropoffLoc,
  driverLoc,
  riderLoc,
  stage,
  onRouteCalculated,
}) {
  const { isDark } = useTheme();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const pickupMarkerRef = useRef(null);
  const dropoffMarkerRef = useRef(null);
  const driverMarkerRef = useRef(null);
  const riderMarkerRef = useRef(null);
  const routeAddedRef = useRef(false);
  const trafficAddedRef = useRef(false);
  const firstDriverFixRef = useRef(false);
  const trafficRef = useRef(false); // always up-to-date traffic state

  const [mapReady, setMapReady] = useState(false);
  const [is3D, setIs3D] = useState(false);
  const [satellite, setSatellite] = useState(false);
  const [traffic, setTraffic] = useState(false);
  const [routeInfo, setRouteInfo] = useState(null);

  // ── Init ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let destroyed = false;
    loadMapLibre().then(() => {
      if (destroyed || !containerRef.current || mapRef.current) return;
      const map = new window.maplibregl.Map({
        container: containerRef.current,
        style: STYLES.streets(isDark),
        center: LAGOS,
        zoom: 13,
        pitch: 0,
        bearing: 0,
        attributionControl: false,
        antialias: true,
      });
      map.addControl(
        new window.maplibregl.NavigationControl({ showCompass: true }),
        "bottom-right",
      );
      map.on("load", () => {
        if (destroyed) return;
        mapRef.current = map;
        tryAdd3DBuildings(map);
        setMapReady(true);
      });
    });
    return () => {
      destroyed = true;
      [
        pickupMarkerRef,
        dropoffMarkerRef,
        driverMarkerRef,
        riderMarkerRef,
      ].forEach((r) => {
        r.current?.remove();
        r.current = null;
      });
      mapRef.current?.remove();
      mapRef.current = null;
      window._drivoMapFlyTo = null;
    };
  }, []); // eslint-disable-line

  // ── Style swap (dark / satellite) ────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const style = satellite ? STYLES.satellite() : STYLES.streets(isDark);
    mapRef.current.setStyle(style);
    routeAddedRef.current = false;
    trafficAddedRef.current = false;
    mapRef.current.once("styledata", () => {
      tryAdd3DBuildings(mapRef.current);
      if (trafficRef.current) addTraffic(mapRef.current);
      if (pickupLoc?.lat && dropoffLoc?.lat) drawRoute(pickupLoc, dropoffLoc);
    });
  }, [isDark, satellite]); // eslint-disable-line

  // ── Traffic ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    trafficRef.current = traffic;
    if (!mapReady || !mapRef.current) return;
    if (traffic) addTraffic(mapRef.current);
    else removeTraffic(mapRef.current);
  }, [traffic, mapReady]);

  // ── Navigation tilt ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const active = ["accepted", "arrived", "ongoing"].includes(stage);
    if (active) {
      setIs3D(true);
      mapRef.current.easeTo({ pitch: 52, duration: 800 });
    } else {
      setIs3D(false);
      mapRef.current.easeTo({ pitch: 0, bearing: 0, duration: 600 });
    }
  }, [stage, mapReady]);

  // ── Pickup marker ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    pickupMarkerRef.current?.remove();
    pickupMarkerRef.current = null;
    if (!pickupLoc?.lat) return;
    pickupMarkerRef.current = new window.maplibregl.Marker({
      element: makePickupEl(),
      anchor: "center",
    })
      .setLngLat([pickupLoc.lng, pickupLoc.lat])
      .addTo(mapRef.current);
    mapRef.current.flyTo({
      center: [pickupLoc.lng, pickupLoc.lat],
      zoom: 15,
      duration: 700,
    });
  }, [pickupLoc, mapReady]);

  // ── Dropoff marker + route ────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    dropoffMarkerRef.current?.remove();
    dropoffMarkerRef.current = null;
    removeRoute();
    if (!dropoffLoc?.lat) return;
    dropoffMarkerRef.current = new window.maplibregl.Marker({
      element: makeDropoffEl(),
      anchor: "bottom",
    })
      .setLngLat([dropoffLoc.lng, dropoffLoc.lat])
      .addTo(mapRef.current);
    if (pickupLoc?.lat && !isNaN(pickupLoc.lat)) {
      drawRoute(pickupLoc, dropoffLoc);
      try {
        const bounds = new window.maplibregl.LngLatBounds();
        bounds.extend([pickupLoc.lng, pickupLoc.lat]);
        bounds.extend([dropoffLoc.lng, dropoffLoc.lat]);
        mapRef.current.fitBounds(bounds, {
          padding: { top: 100, bottom: 240, left: 60, right: 60 },
          duration: 900,
          maxZoom: 15,
        });
      } catch {}
    }
  }, [dropoffLoc, mapReady]); // eslint-disable-line

  // ── Driver marker ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    if (!driverLoc?.lat) {
      driverMarkerRef.current?.remove();
      driverMarkerRef.current = null;
      firstDriverFixRef.current = false;
      return;
    }
    const active = ["accepted", "arrived", "ongoing"].includes(stage);
    if (driverMarkerRef.current) {
      driverMarkerRef.current.setLngLat([driverLoc.lng, driverLoc.lat]);
      if (active)
        mapRef.current.easeTo({
          center: [driverLoc.lng, driverLoc.lat],
          zoom: 16,
          pitch: 52,
          duration: 1200,
          easing: (t) => t * (2 - t),
        });
    } else {
      if (!firstDriverFixRef.current) {
        firstDriverFixRef.current = true;
        mapRef.current.flyTo({
          center: [driverLoc.lng, driverLoc.lat],
          zoom: 15,
          duration: 1000,
        });
      }
      driverMarkerRef.current = new window.maplibregl.Marker({
        element: makeDriverEl(),
        anchor: "center",
      })
        .setLngLat([driverLoc.lng, driverLoc.lat])
        .addTo(mapRef.current);
      window._drivoMapFlyTo = (loc) =>
        mapRef.current?.flyTo({
          center: [loc.lng, loc.lat],
          zoom: 16,
          pitch: is3D ? 52 : 0,
          duration: 900,
        });
    }
  }, [driverLoc, mapReady]); // eslint-disable-line

  // ── Rider marker ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current || !riderLoc?.lat) return;
    if (riderMarkerRef.current) {
      riderMarkerRef.current.setLngLat([riderLoc.lng, riderLoc.lat]);
    } else {
      riderMarkerRef.current = new window.maplibregl.Marker({
        element: makeRiderEl(),
        anchor: "center",
      })
        .setLngLat([riderLoc.lng, riderLoc.lat])
        .addTo(mapRef.current);
    }
  }, [riderLoc, mapReady]);

  // ── Route drawing ─────────────────────────────────────────────────────────────
  async function drawRoute(from, to) {
    const map = mapRef.current;
    if (!map) return;
    removeRoute();

    // Try real road-snapped route
    const result = await fetchRoute(from, to);
    let coords, distKm, durationMin;
    if (result) {
      coords = result.coords;
      distKm = result.distanceKm;
      durationMin = result.durationMin;
      console.log(
        `[Route] Road route: ${distKm.toFixed(1)}km, ${durationMin}min`,
      );
    } else {
      // Bezier fallback
      coords = bezierCoords(from, to);
      distKm = haversineKm(from.lat, from.lng, to.lat, to.lng);
      durationMin = Math.round((distKm / 30) * 60);
      console.log(`[Route] Fallback bezier: ${distKm.toFixed(1)}km`);
    }

    setRouteInfo({ distKm, durationMin });
    onRouteCalculated?.(distKm, durationMin);

    try {
      // Add route source
      map.addSource("route", {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
        },
      });

      // Glow layer (wide, transparent)
      map.addLayer({
        id: "route-glow",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#00C853",
          "line-width": 20,
          "line-opacity": 0.07,
          "line-blur": 12,
        },
      });

      // White casing
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#ffffff",
          "line-width": 9,
          "line-opacity": isDark ? 0.18 : 0.85,
        },
      });

      // Main green line
      map.addLayer({
        id: "route-main",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#00C853", "line-width": 5, "line-opacity": 1 },
      });

      // Animated white dash
      map.addLayer({
        id: "route-dash",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#ffffff",
          "line-width": 2,
          "line-opacity": 0.5,
          "line-dasharray": [0, 4, 4],
        },
      });

      // Midpoint label
      const mid = coords[Math.floor(coords.length / 2)];
      const distLabel =
        distKm < 1 ? `${Math.round(distKm * 1000)}m` : `${distKm.toFixed(1)}km`;
      map.addSource("route-label-src", {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: { type: "Point", coordinates: mid },
          properties: { label: `${distLabel} · ${durationMin}min` },
        },
      });
      map.addLayer({
        id: "route-label",
        type: "symbol",
        source: "route-label-src",
        layout: {
          "text-field": ["get", "label"],
          "text-size": 12,
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-offset": [0, -1.5],
          "text-anchor": "bottom",
        },
        paint: {
          "text-color": isDark ? "#fff" : "#111",
          "text-halo-color": isDark ? "#000" : "#fff",
          "text-halo-width": 2,
        },
      });

      routeAddedRef.current = true;
    } catch (e) {
      console.warn("[Route] layer error:", e);
    }
  }

  function removeRoute() {
    const map = mapRef.current;
    if (!map || !routeAddedRef.current) return;
    try {
      [
        "route-label",
        "route-dash",
        "route-main",
        "route-casing",
        "route-glow",
      ].forEach((id) => {
        try {
          if (map.getLayer(id)) map.removeLayer(id);
        } catch {}
      });
      ["route-label-src", "route"].forEach((id) => {
        try {
          if (map.getSource(id)) map.removeSource(id);
        } catch {}
      });
    } catch {}
    routeAddedRef.current = false;
  }

  // ── Traffic — raster overlay ──────────────────────────────────────────────────
  // MapTiler traffic raster tiles work reliably as an overlay on any style.
  // Vector approach requires pre-baked source in the style — raster doesn't.
  function addTraffic(map) {
    if (trafficAddedRef.current) return;
    const doAdd = () => {
      try {
        if (!map.getSource("traffic-raster")) {
          map.addSource("traffic-raster", {
            type: "raster",
            tiles: [
              "https://api.maptiler.com/tiles/traffic/{z}/{x}/{y}.png?key=" +
                KEY,
            ],
            tileSize: 256,
            minzoom: 0,
            maxzoom: 22,
          });
        }
        if (!map.getLayer("traffic-raster-layer")) {
          // Find first symbol layer to insert below labels
          const layers = map.getStyle()?.layers || [];
          let firstSymbol;
          for (const l of layers) {
            if (l.type === "symbol") {
              firstSymbol = l.id;
              break;
            }
          }
          map.addLayer(
            {
              id: "traffic-raster-layer",
              type: "raster",
              source: "traffic-raster",
              paint: { "raster-opacity": 0.8 },
            },
            firstSymbol,
          );
        }
        trafficAddedRef.current = true;
      } catch (e) {
        console.warn("[Traffic]", e.message);
      }
    };
    if (map.isStyleLoaded()) doAdd();
    else map.once("styledata", doAdd);
  }

  function removeTraffic(map) {
    if (!trafficAddedRef.current) return;
    try {
      if (map.getLayer("traffic-raster-layer"))
        map.removeLayer("traffic-raster-layer");
      if (map.getSource("traffic-raster")) map.removeSource("traffic-raster");
    } catch {}
    trafficAddedRef.current = false;
  }

  // ── 3D buildings ──────────────────────────────────────────────────────────────
  function tryAdd3DBuildings(map) {
    try {
      const layers = map.getStyle()?.layers || [];
      let labelLayerId;
      for (const l of layers) {
        if (l.type === "symbol" && l.layout?.["text-field"]) {
          labelLayerId = l.id;
          break;
        }
      }
      if (!map.getLayer("3d-buildings")) {
        map.addLayer(
          {
            id: "3d-buildings",
            source: "openmaptiles",
            "source-layer": "building",
            filter: ["==", "extrude", "true"],
            type: "fill-extrusion",
            minzoom: 14,
            paint: {
              "fill-extrusion-color": isDark ? "#1c1c2e" : "#e0e0e8",
              "fill-extrusion-height": [
                "interpolate",
                ["linear"],
                ["zoom"],
                14,
                0,
                14.05,
                ["get", "render_height"],
              ],
              "fill-extrusion-base": [
                "interpolate",
                ["linear"],
                ["zoom"],
                14,
                0,
                14.05,
                ["get", "render_min_height"],
              ],
              "fill-extrusion-opacity": 0.65,
            },
          },
          labelLayerId,
        );
      }
    } catch {}
  }

  // ── Marker helpers ────────────────────────────────────────────────────────────
  function makePickupEl() {
    const el = document.createElement("div");
    el.style.cssText = "position:relative;width:28px;height:28px;";
    el.innerHTML = `
      <div style="position:absolute;inset:-10px;border-radius:50%;border:2px solid rgba(0,200,83,0.35);animation:drivoPulse 1.8s ease-out infinite;"></div>
      <div style="width:24px;height:24px;background:linear-gradient(135deg,#00C853,#00A843);border-radius:50%;border:3px solid #fff;box-shadow:0 2px 16px rgba(0,200,83,0.7);position:absolute;top:2px;left:2px;"></div>
      <div style="position:absolute;top:-30px;left:50%;transform:translateX(-50%);background:#00C853;color:#fff;font-size:9px;font-weight:800;padding:3px 8px;border-radius:6px;white-space:nowrap;font-family:system-ui,sans-serif;letter-spacing:.06em;box-shadow:0 2px 8px rgba(0,200,83,.4);">PICKUP</div>`;
    return el;
  }

  function makeDropoffEl() {
    const el = document.createElement("div");
    el.style.cssText = "position:relative;width:30px;height:40px;";
    el.innerHTML = `
      <svg width="30" height="40" viewBox="0 0 30 40" fill="none" xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:0;left:0;">
        <path d="M15 0C6.716 0 0 6.716 0 15C0 26.25 15 40 15 40C15 40 30 26.25 30 15C30 6.716 23.284 0 15 0Z" fill="#FF3B30"/>
        <circle cx="15" cy="15" r="7" fill="white"/><circle cx="15" cy="15" r="3.5" fill="#FF3B30"/>
      </svg>
      <div style="position:absolute;top:-30px;left:50%;transform:translateX(-50%);background:#FF3B30;color:#fff;font-size:9px;font-weight:800;padding:3px 8px;border-radius:6px;white-space:nowrap;font-family:system-ui,sans-serif;letter-spacing:.06em;box-shadow:0 2px 8px rgba(255,59,48,.4);">DROP</div>`;
    return el;
  }

  function makeDriverEl() {
    const el = document.createElement("div");
    el.style.cssText = "position:relative;width:56px;height:56px;";
    el.innerHTML = `
      <div style="position:absolute;inset:-8px;border-radius:50%;border:2px solid rgba(0,200,83,.2);animation:drivoPulse 2.5s ease-out infinite;"></div>
      <div style="position:absolute;top:-14px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:15px solid rgba(0,200,83,.8);"></div>
      <div style="width:56px;height:56px;background:linear-gradient(135deg,#00C853,#00A843);border-radius:50%;border:3.5px solid #fff;box-shadow:0 4px 24px rgba(0,200,83,.65),0 0 0 5px rgba(0,200,83,.12);display:flex;align-items:center;justify-content:center;font-size:26px;">🚗</div>`;
    return el;
  }

  function makeRiderEl() {
    const el = document.createElement("div");
    el.style.cssText = "position:relative;width:36px;height:36px;";
    el.innerHTML = `
      <div style="position:absolute;inset:-6px;border-radius:50%;border:2px solid rgba(59,130,246,0.35);animation:drivoPulse 2s ease-out infinite;"></div>
      <div style="width:36px;height:36px;background:linear-gradient(135deg,#3b82f6,#2563eb);border-radius:50%;border:3px solid #fff;box-shadow:0 2px 12px rgba(59,130,246,0.6);display:flex;align-items:center;justify-content:center;font-size:18px;">🧍</div>`;
    return el;
  }

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      {/* Route info pill */}
      {routeInfo && (
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 z-10 pointer-events-none"
          style={{ top: "calc(12px + env(safe-area-inset-top, 0px))" }}
        >
          <div className="glass-light dark:glass-dark rounded-full px-4 py-1.5 shadow-float flex items-center gap-2 border border-white/20">
            <span className="text-[11px] font-black text-zinc-900 dark:text-white tracking-tight">
              {routeInfo.distKm < 1
                ? `${Math.round(routeInfo.distKm * 1000)}m`
                : `${routeInfo.distKm.toFixed(1)}km`}
            </span>
            <span className="w-1 h-1 rounded-full bg-brand" />
            <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
              {routeInfo.durationMin}min
            </span>
          </div>
        </div>
      )}

      {/* Map controls */}
      {mapReady && (
        <div
          className="absolute left-3 flex flex-col gap-2 z-10"
          style={{ top: "calc(72px + env(safe-area-inset-top, 0px))" }}
        >
          {[
            {
              label: is3D ? "2D" : "3D",
              active: is3D,
              onClick: () => {
                setIs3D((p) => {
                  const n = !p;
                  mapRef.current?.easeTo({ pitch: n ? 52 : 0, duration: 700 });
                  return n;
                });
              },
              isText: true,
            },
            {
              label: "🛰️",
              active: satellite,
              onClick: () => setSatellite((p) => !p),
            },
            {
              label: "🚦",
              active: traffic,
              onClick: () => setTraffic((p) => !p),
            },
          ].map(({ label, active, onClick, isText }) => (
            <button
              key={label}
              onClick={onClick}
              className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-float border transition-all active:scale-95 ${active ? "bg-brand text-white border-brand" : "glass-light dark:glass-dark border-white/20 text-zinc-700 dark:text-zinc-200"}`}
            >
              {isText ? (
                <span className="text-[11px] font-black">{label}</span>
              ) : (
                <span className="text-base">{label}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Traffic legend */}
      {traffic && mapReady && (
        <div className="absolute top-[72px] right-3 z-10 glass-light dark:glass-dark rounded-xl p-2.5 shadow-float pointer-events-none border border-white/10">
          <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mb-2">
            Traffic
          </p>
          {[
            ["#00C853", "Free"],
            ["#FFB300", "Slow"],
            ["#FF6D00", "Heavy"],
            ["#D32F2F", "Severe"],
          ].map(([c, l]) => (
            <div key={l} className="flex items-center gap-2 mb-1.5">
              <div className="w-3.5 h-2 rounded-sm" style={{ background: c }} />
              <span className="text-[9px] font-semibold text-zinc-500 dark:text-zinc-400">
                {l}
              </span>
            </div>
          ))}
        </div>
      )}

      {!mapReady && (
        <div className="absolute inset-0 bg-zinc-950 flex flex-col items-center justify-center gap-4">
          <div className="relative">
            <div className="w-12 h-12 border-2 border-brand/20 rounded-full" />
            <div className="absolute inset-0 border-2 border-transparent border-t-brand rounded-full animate-spin" />
          </div>
          <p className="text-zinc-500 text-sm font-medium tracking-wide">
            Loading map...
          </p>
        </div>
      )}

      <style>{`
        @keyframes drivoPulse { 0%{transform:scale(1);opacity:.7} 100%{transform:scale(2.6);opacity:0} }
        .maplibregl-ctrl-bottom-right{bottom:88px!important;right:14px!important;}
        .maplibregl-ctrl-group{background:rgba(255,255,255,.9)!important;backdrop-filter:blur(20px);border-radius:14px!important;border:none!important;box-shadow:0 4px 24px rgba(0,0,0,.12)!important;overflow:hidden;}
        .dark .maplibregl-ctrl-group{background:rgba(18,18,22,.9)!important;box-shadow:0 4px 24px rgba(0,0,0,.6)!important;}
        .maplibregl-ctrl button{width:44px!important;height:44px!important;}
      `}</style>
    </div>
  );
}
