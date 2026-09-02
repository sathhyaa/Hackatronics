export const MATERIALS = ["LPG", "Petrol", "Diesel", "Methane", "Hydrogen"];

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export function buildScenario(input) {
  const quantity = Math.max(1, Number(input.quantity || 500));
  const windSpeed = Math.max(0, Number(input.windSpeed ?? 9));
  const windDirection = ((Number(input.windDirection ?? 260) % 360) + 360) % 360;
  const base = Math.sqrt(quantity) * 8.4;
  const materialFactor = { LPG: 1, Petrol: .92, Diesel: .72, Methane: 1.08, Hydrogen: 1.18 }[input.material] || 1;
  const critical = clamp(base * .72 * materialFactor, 45, 260);
  const high = clamp(base * 1.18 * materialFactor + windSpeed * 2.2, 90, 520);
  const moderate = clamp(base * 1.95 * materialFactor + windSpeed * 8.5, 140, 1100);
  const riskScore = clamp(62 + quantity / 42 + windSpeed * 1.4, 18, 99.8);
  return {
    ...input, quantity, windSpeed, windDirection,
    center: input.center || [77.6205, 12.9716],
    riskScore,
    riskLabel: riskScore > 85 ? "CRITICAL EVENT" : riskScore > 65 ? "HIGH RISK EVENT" : "ELEVATED EVENT",
    evacuationTime: `${String(Math.max(2, Math.round(moderate / 190))).padStart(2,"0")}:${String(Math.round((moderate * 1.9) % 60)).padStart(2,"0")}`,
    zones: { critical, high, moderate }
  };
}

// Live geocoding. Uses the exact location typed by the user instead of a fixed city.
export async function geocodeLocation(query) {
  const q = String(query || "").trim();
  if (!q) throw new Error("Enter an incident location.");
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(q)}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Location lookup failed.");
  const results = await response.json();
  if (!results?.length) throw new Error(`Could not find “${q}”. Try a more specific location.`);
  const hit = results[0];
  return {
    center: [Number(hit.lon), Number(hit.lat)],
    label: hit.display_name || q
  };
}

export function destinationPoint([lng, lat], distanceMeters, bearingDeg) {
  const R = 6378137, d = distanceMeters / R, b = bearingDeg * Math.PI / 180;
  const lat1 = lat * Math.PI / 180, lon1 = lng * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1)*Math.cos(d)+Math.cos(lat1)*Math.sin(d)*Math.cos(b));
  const lon2 = lon1 + Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(lat1), Math.cos(d)-Math.sin(lat1)*Math.sin(lat2));
  return [lon2 * 180 / Math.PI, lat2 * 180 / Math.PI];
}

export function buildThreatPolygon(center, radius, windDeg, stretch = 1) {
  const points = [];
  const downwind = (windDeg + 180) % 360;
  for (let i=0;i<96;i++) {
    const angle = i/96*360;
    const diff = Math.cos((angle-downwind)*Math.PI/180);
    const multiplier = .78 + ((diff+1)/2)*(stretch-.78);
    points.push(destinationPoint(center, radius*multiplier, angle));
  }
  points.push(points[0]);
  return points;
}

export function safeCandidates(
  center,
  zones,
  windDeg
) {
  /*
    ACCESSIBLE EVACUATION POINT NETWORK

    Points are deliberately distributed around
    ALL sides of the incident so people located
    anywhere within the overall impact area have
    a relatively nearby candidate point.

    This is a visual/accessibility distribution,
    not wind-priority generation.
  */

  const candidates = [];


  /*
    Eight evenly distributed directions.

    Using fixed bearings rather than wind-based
    bearings prevents all points from clustering
    on one side when wind direction changes.
  */

  const layouts = [
    {
      bearing: 0,
      distance: zones.moderate * 1.07
    },

    {
      bearing: 45,
      distance: zones.moderate * 0.82
    },

    {
      bearing: 90,
      distance: zones.moderate * 0.98
    },

    {
      bearing: 135,
      distance: zones.moderate * 0.84
    },

    {
      bearing: 180,
      distance: zones.moderate * 0.78
    },

    {
      bearing: 225,
      distance: zones.moderate * 0.86
    },

    {
      bearing: 270,
      distance: zones.moderate * 1.04
    },

    {
      bearing: 315,
      distance: zones.moderate * 0.82
    }
  ];


  for (
    let i = 0;
    i < layouts.length;
    i++
  ) {

    const point =
      layouts[i];


    const coordinate =
      destinationPoint(
        center,
        point.distance,
        point.bearing
      );


    candidates.push({

      id:
        `safe-${i + 1}`,

      name:
        `SAFE ZONE ${String.fromCharCode(65 + i)}`,

      coordinate,

      bearing:
        point.bearing,

      distance:
        point.distance

    });

  }


  return candidates;
}