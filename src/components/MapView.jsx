import React, { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import {
  buildThreatPolygon,
  destinationPoint,
  safeCandidates,
} from "../lib/threatModel";


/* =========================================================
   DISTANCE UTILITY
========================================================= */

const earthRadius = 6371000;

const distanceMeters = (a, b) => {
  const toRad = (d) => (d * Math.PI) / 180;

  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);

  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(dLng / 2) ** 2;

  return 2 * earthRadius * Math.asin(Math.sqrt(h));
};


/* =========================================================
   MAP CONFIG
========================================================= */



/* =========================================================
   HAZARD VALIDATION UTILITIES
========================================================= */

function pointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function buildHazardPolygons(scenario) {
  const { center, zones, windDirection } = scenario;
  return {
    moderate: buildThreatPolygon(center, zones.moderate, windDirection, 2.45),
    high: buildThreatPolygon(center, zones.high, windDirection, 1.75),
    critical: buildThreatPolygon(center, zones.critical, windDirection, 1.25),
  };
}

function destinationIsSafe(coordinate, hazards) {
  return !pointInPolygon(coordinate, hazards.critical) &&
    !pointInPolygon(coordinate, hazards.high) &&
    !pointInPolygon(coordinate, hazards.moderate);
}

function analyseRouteExposure(coordinates, hazards) {
  let criticalHits = 0, highHits = 0, moderateHits = 0;
  for (const point of coordinates) {
    if (pointInPolygon(point, hazards.critical)) { criticalHits++; continue; }
    if (pointInPolygon(point, hazards.high)) { highHits++; continue; }
    if (pointInPolygon(point, hazards.moderate)) moderateHits++;
  }
  return {
    criticalHits, highHits, moderateHits,
    safe: criticalHits === 0 && highHits === 0 && moderateHits === 0,
  };
}


const styleUrl =
  "https://tiles.openfreemap.org/styles/liberty";

const pointFeature = (
  coordinates,
  properties = {}
) => ({
  type: "Feature",

  properties,

  geometry: {
    type: "Point",
    coordinates,
  },
});


/* =========================================================
   MAP VIEW
========================================================= */

export default function MapView({
  scenario,
  liveMode,
  onRouteStatus,
}) {

  const container = useRef(null);
  const mapRef = useRef(null);

  const userMarkerRef = useRef(null);

  const scenarioRef = useRef(scenario);
  const liveRef = useRef(liveMode);

  const windRaf = useRef(null);

  const markers = useRef({
    source: null,
    rescue: null,
  });


  scenarioRef.current = scenario;
  liveRef.current = liveMode;


  /* =========================================================
     INITIALIZE MAP
  ========================================================= */

  useEffect(() => {

    const map = new maplibregl.Map({
      container: container.current,

      style: styleUrl,

      center: scenarioRef.current.center,

      zoom: 16.35,

      pitch: 56,

      bearing: -18,

      antialias: true,

      attributionControl: true,
    });


    map.addControl(
      new maplibregl.NavigationControl({
        visualizePitch: true,
      }),
      "top-right"
    );


    mapRef.current = map;


    map.on("load", () => {

      setupLayers(map);

      updateScene(map);

      animateWind(map);

    });


    return () => {

      if (windRaf.current) {
        cancelAnimationFrame(
          windRaf.current
        );
      }


      Object.values(markers.current)
        .forEach((marker) =>
          marker?.remove()
        );


      userMarkerRef.current?.remove();


      map.remove();

    };

  }, []);


  /* =========================================================
     SCENARIO UPDATE
  ========================================================= */

  useEffect(() => {

    const map = mapRef.current;

    if (
      !map ||
      !map.isStyleLoaded()
    ) {
      return;
    }


    map.flyTo({

      center: scenario.center,

      zoom: 16.35,

      pitch: 56,

      bearing: -18,

      duration: 1100,

      essential: true,

    });


    updateScene(map);

  }, [
    scenario,
    liveMode,
  ]);


  /* =========================================================
     CREATE MAP LAYERS
  ========================================================= */

  function setupLayers(map) {


    /* -----------------------------------------------------
       3D BUILDINGS
    ----------------------------------------------------- */

    const firstSymbol =
      map
        .getStyle()
        .layers
        ?.find(
          (layer) =>
            layer.type === "symbol"
        )
        ?.id;


    try {

      map.addLayer(
        {

          id: "aegis-3d-buildings",

          type: "fill-extrusion",

          source: "openmaptiles",

          "source-layer": "building",

          minzoom: 13,


          paint: {

            "fill-extrusion-color":
              "#786f62",


            "fill-extrusion-height": [
              "coalesce",

              ["get", "render_height"],

              ["get", "height"],

              6,
            ],


            "fill-extrusion-base": [
              "coalesce",

              ["get", "render_min_height"],

              ["get", "min_height"],

              0,
            ],


            "fill-extrusion-opacity":
              0.72,


            "fill-extrusion-vertical-gradient":
              true,

          },

        },

        firstSymbol

      );

    } catch (_) {

      /*
        Keep map functional even if
        style source changes.
      */

    }


    /* -----------------------------------------------------
       THREAT ZONES
    ----------------------------------------------------- */

    map.addSource(
      "zones",
      {
        type: "geojson",

        data: {
          type: "FeatureCollection",

          features: [],
        },
      }
    );


    [
      ["moderate", "#e0a33f", 0.18],
      ["high", "#df672e", 0.24],
      ["critical", "#d23824", 0.36],
    ].forEach(
      ([zone, color, opacity]) => {

        map.addLayer({

          id: `zone-${zone}`,

          type: "fill",

          source: "zones",

          filter: [
            "==",
            ["get", "zone"],
            zone,
          ],

          paint: {

            "fill-color":
              color,

            "fill-opacity":
              opacity,

          },

        });

      }
    );


    map.addLayer({

      id: "zone-outline",

      type: "line",

      source: "zones",

      paint: {

        "line-color":
          "#c44a29",

        "line-width":
          1.6,

        "line-opacity":
          0.8,

      },

    });


    /* -----------------------------------------------------
       SAFE POINTS
    ----------------------------------------------------- */

    map.addSource(
      "safe-points",
      {
        type: "geojson",

        data: {
          type: "FeatureCollection",

          features: [],
        },
      }
    );


    map.addLayer({

      id: "safe-glow",

      type: "circle",

      source: "safe-points",

      paint: {

        "circle-radius":
          17,

        "circle-color":
          "#75a681",

        "circle-opacity":
          0.17,

      },

    });


    map.addLayer({

      id: "safe-point",

      type: "circle",

      source: "safe-points",

      paint: {

        "circle-radius":
          6,

        "circle-color":
          "#6f9d7c",

        "circle-stroke-color":
          "#f8f3ea",

        "circle-stroke-width":
          2.5,

      },

    });


    /* -----------------------------------------------------
       DEMO RESCUE ROUTE
    ----------------------------------------------------- */

    map.addSource(
      "rescue-route",
      {
        type: "geojson",

        data: {
          type: "FeatureCollection",

          features: [],
        },
      }
    );


    map.addLayer({

      id: "rescue-casing",

      type: "line",

      source: "rescue-route",

      layout: {
        "line-cap": "round",
        "line-join": "round",
      },

      paint: {

        "line-color":
          "#fff8eb",

        "line-width":
          7,

        "line-opacity":
          0.76,

      },

    });


    map.addLayer({

      id: "rescue-line",

      type: "line",

      source: "rescue-route",

      layout: {
        "line-cap": "round",
        "line-join": "round",
      },

      paint: {

        "line-color":
          "#29261f",

        "line-width":
          2.8,

        "line-dasharray":
          [2, 2],

      },

    });


    /* -----------------------------------------------------
       PERSONAL EVACUATION ROUTE
       ROAD GEOMETRY + DOTTED VISUAL
    ----------------------------------------------------- */

    map.addSource(
      "personal-route",
      {
        type: "geojson",

        data: {
          type: "FeatureCollection",

          features: [],
        },
      }
    );


    /*
      Soft light casing.

      Helps the route remain visible
      over roads and 3D buildings.
    */

    map.addLayer({

      id: "personal-route-casing",

      type: "line",

      source: "personal-route",

      layout: {

        "line-cap":
          "round",

        "line-join":
          "round",

      },

      paint: {

        "line-color":
          "#f7f0e4",

        "line-width":
          7,

        "line-opacity":
          0.42,

      },

    });


    /*
      ACTUAL ROUTE LINE.

      OSRM provides the road geometry.
      We render that geometry dotted.
    */

    map.addLayer({

      id: "personal-route-dotted",

      type: "line",

      source: "personal-route",

      layout: {

        "line-cap":
          "round",

        "line-join":
          "round",

      },

      paint: {

        "line-color":
          "#302e28",

        "line-width":
          2.5,

        "line-opacity":
          0.96,

        "line-dasharray":
          [1.5, 2.2],

      },

    });


    /* -----------------------------------------------------
       WIND WAVES
    ----------------------------------------------------- */

    map.addSource(
      "wind-waves",
      {
        type: "geojson",

        data: {
          type: "FeatureCollection",

          features: [],
        },
      }
    );


    map.addLayer({

      id: "wind-wave-shadow",

      type: "line",

      source: "wind-waves",

      paint: {

        "line-color":
          "#eee5d7",

        "line-width":
          5,

        "line-opacity":
          0.32,

        "line-blur":
          2,

      },

    });


    map.addLayer({

      id: "wind-wave",

      type: "line",

      source: "wind-waves",

      layout: {

        "line-cap":
          "round",

        "line-join":
          "round",

      },

      paint: {

        "line-color":
          "#d8a75a",

        "line-width":
          1.65,

        "line-opacity":
          0.84,

        "line-dasharray":
          [1.8, 1.45],

      },

    });

  }


  /* =========================================================
     UPDATE INCIDENT SCENE
  ========================================================= */

  function updateScene(map) {

    if (
      !map.getSource("zones")
    ) {
      return;
    }


    const {
      center,
      zones,
      windDirection,
    } =
      scenarioRef.current;


    const features = [

      [
        "moderate",
        zones.moderate,
        2.45,
      ],

      [
        "high",
        zones.high,
        1.75,
      ],

      [
        "critical",
        zones.critical,
        1.25,
      ],

    ].map(
      ([
        zone,
        radius,
        stretch,
      ]) => ({

        type: "Feature",

        properties: {
          zone,
        },

        geometry: {

          type: "Polygon",

          coordinates: [
            buildThreatPolygon(
              center,
              radius,
              windDirection,
              stretch
            ),
          ],

        },

      })
    );


    map
      .getSource("zones")
      .setData({

        type: "FeatureCollection",

        features,

      });


    if (liveRef.current) {


      const safe =
        safeCandidates(
          center,
          zones,
          windDirection
        );


      map
        .getSource("safe-points")
        .setData({

          type:
            "FeatureCollection",

          features:
            safe.map(
              (s) =>
                pointFeature(
                  s.coordinate,
                  {
                    name:
                      s.name,
                  }
                )
            ),

        });


      const rescueStart =
        destinationPoint(
          center,
          Math.max(
            zones.moderate * 1.08,
            420
          ),
          (
            windDirection + 35
          ) % 360
        );


      map
        .getSource("rescue-route")
        .setData({

          type:
            "FeatureCollection",

          features: [
            {

              type:
                "Feature",

              properties: {},

              geometry: {

                type:
                  "LineString",

                coordinates: [
                  rescueStart,
                  safe[0].coordinate,
                ],

              },

            },
          ],

        });


      if (
        !markers.current.source
      ) {

        const sourceEl =
          document.createElement(
            "div"
          );

        sourceEl.className =
          "sourcePin";

        sourceEl.innerHTML =
          "<span>●</span>";


        const rescueEl =
          document.createElement(
            "div"
          );

        rescueEl.className =
          "rescueMarker";

        rescueEl.innerHTML =
          "◆";


        markers.current.source =
          new maplibregl.Marker({
            element:
              sourceEl,
          })
            .setLngLat(
              center
            )
            .addTo(
              map
            );


        markers.current.rescue =
          new maplibregl.Marker({
            element:
              rescueEl,
          })
            .setLngLat(
              rescueStart
            )
            .addTo(
              map
            );

      } else {

        markers.current.source
          .setLngLat(
            center
          );


        markers.current.rescue
          .setLngLat(
            rescueStart
          );

      }


    } else {


      map
        .getSource("safe-points")
        .setData({

          type:
            "FeatureCollection",

          features: [],

        });


      map
        .getSource("rescue-route")
        .setData({

          type:
            "FeatureCollection",

          features: [],

        });

    }

  }


  /* =========================================================
     WIND ANIMATION
  ========================================================= */

  function animateWind(map) {

    let t = 0;


    const frame = () => {

      if (
        !map.getSource(
          "wind-waves"
        )
      ) {
        return;
      }


      const s =
        scenarioRef.current;


      const down =
        (
          s.windDirection +
          180
        ) % 360;


      const cross =
        (
          s.windDirection +
          90
        ) % 360;


      const features = [];


      const lanes = 10;


      for (
        let lane = 0;
        lane < lanes;
        lane++
      ) {

        const lateral =
          (
            lane -
            (lanes - 1) / 2
          ) * 28;


        for (
          let dash = 0;
          dash < 4;
          dash++
        ) {

          const phase =
            (
              (
                dash * 115 +
                t *
                  (
                    0.8 +
                    s.windSpeed / 22
                  )
              ) %
                540
            ) +
            25;


          const coords = [];


          for (
            let k = 0;
            k < 11;
            k++
          ) {

            const forward =
              phase +
              k * 7;


            const wave =
              lateral +
              Math.sin(
                k * 0.92 +
                  t * 0.08 +
                  lane * 0.7
              ) *
                7;


            let p =
              destinationPoint(
                s.center,
                forward,
                down
              );


            p =
              destinationPoint(
                p,
                wave,
                cross
              );


            coords.push(p);

          }


          features.push({

            type:
              "Feature",

            properties: {},

            geometry: {

              type:
                "LineString",

              coordinates:
                coords,

            },

          });

        }

      }


      map
        .getSource(
          "wind-waves"
        )
        .setData({

          type:
            "FeatureCollection",

          features,

        });


      t += 1;


      windRaf.current =
        requestAnimationFrame(
          frame
        );

    };


    frame();

  }


  /* =========================================================
     GET SHORTEST ROAD ROUTE
  ========================================================= */

  async function getRoadRoute(start, end) {
    try {
      const url =
        `https://router.project-osrm.org/route/v1/driving/` +
        `${start[0]},${start[1]};${end[0]},${end[1]}` +
        `?overview=full&geometries=geojson`;
      const response = await fetch(url);
      const data = await response.json();
      const route = data.routes?.[0];
      if (response.ok && route?.geometry?.coordinates?.length > 1) {
        return {
          coordinates: route.geometry.coordinates,
          distance: route.distance,
          duration: route.duration,
          available: true,
        };
      }
    } catch (error) {
      console.warn("AEGIS route service unavailable:", error);
    }
    return {
      coordinates: [start, end],
      distance: distanceMeters(start, end),
      duration: null,
      available: false,
    };
  }


  /* =========================================================
     USE MY LOCATION
  ========================================================= */

  useEffect(() => {

    const handler =
      async () => {

        const map =
          mapRef.current;


        if (
          !map ||
          !liveMode
        ) {
          return;
        }


        onRouteStatus?.(
          "locating"
        );


        /*
          Generate all safe candidates.
        */

        const safe =
          safeCandidates(
            scenario.center,
            scenario.zones,
            scenario.windDirection
          );

        const hazards =
          buildHazardPolygons(
            scenario
          );


        /*
          Demo fallback.
        */

        const fallback =
          destinationPoint(
            scenario.center,
            175,
            (
              scenario.windDirection +
              70
            ) % 360
          );


        const finish =
          async (
            user
          ) => {


            /*
              AEGIS EVACUATION DECISION ENGINE
              - reject destinations inside the displayed hazard field
              - obtain real road routes
              - reject routes entering critical/high risk zones
              - rank remaining routes by safety, wind direction and distance
            */

            onRouteStatus?.("routing");

            const destinationCandidates = safe.filter((candidate) =>
              destinationIsSafe(candidate.coordinate, hazards)
            );

            const routeCandidates = destinationCandidates.slice(0, 6);
            const evaluatedRoutes = [];

            for (const candidate of routeCandidates) {
              const route = await getRoadRoute(user, candidate.coordinate);
              if (!route.available) continue;

              const exposure = analyseRouteExposure(route.coordinates, hazards);
              if (exposure.criticalHits > 0 || exposure.highHits > 0) continue;

              const score =
                candidate.directionalSafety * 10 -
                route.distance / 35 -
                exposure.moderateHits * 25;

              evaluatedRoutes.push({ candidate, route, exposure, score });
            }

            evaluatedRoutes.sort((a, b) => b.score - a.score);
            let selected = evaluatedRoutes[0];

            /* If every candidate is rejected, choose the least exposed route. */
            if (!selected) {
              const fallbackEvaluations = [];
              for (const candidate of routeCandidates.slice(0, 3)) {
                const route = await getRoadRoute(user, candidate.coordinate);
                const exposure = analyseRouteExposure(route.coordinates, hazards);
                const exposureScore =
                  exposure.criticalHits * 10000 +
                  exposure.highHits * 1000 +
                  exposure.moderateHits * 10 +
                  route.distance / 100;
                fallbackEvaluations.push({
                  candidate, route, exposure, score: -exposureScore,
                });
              }
              fallbackEvaluations.sort((a, b) => b.score - a.score);
              selected = fallbackEvaluations[0];
            }

            const route = selected?.route || await getRoadRoute(user, fallback);

            if (selected) {
              console.log("AEGIS selected evacuation route:", {
                destination: selected.candidate,
                score: selected.score,
                exposure: selected.exposure,
                distance: selected.route.distance,
                duration: selected.route.duration,
              });
            }

            /*
              Draw the road geometry
              using dotted styling.
            */

            drawPersonalRoute(
              map,
              route.coordinates
            );


            /*
              Fit map to actual
              road route geometry.
            */

            const bounds =
              route.coordinates.reduce(

                (
                  b,
                  coord
                ) =>
                  b.extend(
                    coord
                  ),

                new maplibregl.LngLatBounds(
                  route.coordinates[0],
                  route.coordinates[0]
                )

              );


            map.fitBounds(
              bounds,
              {

                padding: {

                  top:
                    120,

                  right:
                    340,

                  bottom:
                    150,

                  left:
                    300,

                },

                duration:
                  1100,

                maxZoom:
                  16.8,

              }
            );


            onRouteStatus?.(
              "ready"
            );

          };


        /*
          Browser GPS unavailable.
        */

        if (
          !navigator.geolocation
        ) {

          await finish(
            fallback
          );

          return;

        }


        navigator.geolocation
          .getCurrentPosition(

            async (
              position
            ) => {

              const user = [

                position.coords
                  .longitude,

                position.coords
                  .latitude,

              ];


              /*
                Add / update user marker.
              */

              if (
                !userMarkerRef.current
              ) {

                const el =
                  document.createElement(
                    "div"
                  );


                el.className =
                  "userMarker";


                el.innerHTML =
                  "◎";


                userMarkerRef.current =
                  new maplibregl.Marker(
                    {
                      element:
                        el,
                    }
                  )
                    .setLngLat(
                      user
                    )
                    .addTo(
                      map
                    );

              } else {

                userMarkerRef.current
                  .setLngLat(
                    user
                  );

              }


              await finish(
                user
              );

            },


            async () => {

              /*
                GPS denied.
                Use demo fallback.
              */

              await finish(
                fallback
              );

            },


            {

              enableHighAccuracy:
                true,

              timeout:
                7000,

              maximumAge:
                30000,

            }

          );

      };


    window.addEventListener(
      "aegis:find-route",
      handler
    );


    return () => {

      window.removeEventListener(
        "aegis:find-route",
        handler
      );

    };

  }, [
    scenario,
    liveMode,
    onRouteStatus,
  ]);


  /* =========================================================
     DRAW ROAD ROUTE
  ========================================================= */

  function drawPersonalRoute(
    map,
    coordinates
  ) {

    const source =
      map.getSource(
        "personal-route"
      );


    if (!source) {
      return;
    }


    source.setData({

      type:
        "FeatureCollection",


      features: [
        {

          type:
            "Feature",

          properties: {},

          geometry: {

            type:
              "LineString",

            coordinates,

          },

        },
      ],

    });

  }


  /* =========================================================
     RENDER
  ========================================================= */

  return (

    <div
      ref={container}
      className="map"
    />

  );

}