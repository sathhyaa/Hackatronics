import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

import MapView from "./components/MapView";
import ImmersiveThreatField from "./components/ImmersiveThreatField";

import {
  buildScenario,
  MATERIALS,
  geocodeLocation,
} from "./lib/threatModel";


/* =========================================================
   LIVE WEATHER
========================================================= */

const WEATHER_REFRESH_MS = .5 * 60 * 1000; // 5 minutes


async function fetchLiveWeather(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),

    current:
      "temperature_2m," +
      "relative_humidity_2m," +
      "precipitation," +
      "rain," +
      "weather_code," +
      "wind_speed_10m," +
      "wind_direction_10m",

    wind_speed_unit: "kmh",
  });


  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?${params.toString()}`
  );


  if (!response.ok) {
    throw new Error(
      "Live weather service is unavailable."
    );
  }


  const data = await response.json();


  if (
    !data.current ||
    typeof data.current.wind_speed_10m !== "number" ||
    typeof data.current.wind_direction_10m !== "number"
  ) {
    throw new Error(
      "Live wind data is unavailable."
    );
  }


  return {
    windSpeed:
      data.current.wind_speed_10m,

    windDirection:
      data.current.wind_direction_10m,

    temperature:
      data.current.temperature_2m,

    humidity:
      data.current.relative_humidity_2m,

    precipitation:
      data.current.precipitation,

    rain:
      data.current.rain,

    weatherCode:
      data.current.weather_code,

    updatedAt:
      data.current.time,
  };
}


/* =========================================================
   INITIAL SCENARIO
========================================================= */

const initialScenario = buildScenario({
  mode: "live",

  location:
    "Bengaluru, India",

  material:
    "LPG",

  quantity:
    500,

  windSpeed:
    9,

  windDirection:
    260,
});


/* =========================================================
   APP
========================================================= */

function App() {

  const [screen, setScreen] =
    useState("landing");


  const [mode, setMode] =
    useState("live");


  const [form, setForm] =
    useState({
      location:
        "Bengaluru, India",

      material:
        "LPG",

      quantity:
        500,

      windSpeed:
        9,

      windDirection:
        260,
    });


  const [scenario, setScenario] =
    useState(initialScenario);


  const [immersive, setImmersive] =
    useState(false);


  const [routeStatus, setRouteStatus] =
    useState("idle");


  const [generating, setGenerating] =
    useState(false);


  const [locationError, setLocationError] =
    useState("");


  const [weather, setWeather] =
    useState(null);


  const [weatherStatus, setWeatherStatus] =
    useState("idle");


  const weatherIntervalRef =
    useRef(null);


  /*
    Store the latest scenario without
    restarting the interval every render.
  */

  const scenarioRef =
    useRef(scenario);


  const modeRef =
    useRef(mode);


  useEffect(() => {
    scenarioRef.current =
      scenario;
  }, [scenario]);


  useEffect(() => {
    modeRef.current =
      mode;
  }, [mode]);


  /* =========================================================
     UPDATE SCENARIO WITH LIVE WEATHER
  ========================================================= */

  const applyLiveWeather =
    async (baseScenario) => {

      if (
        !baseScenario?.center
      ) {
        return;
      }


      /*
        Map coordinates are:
        [longitude, latitude]

        Open-Meteo expects:
        latitude, longitude
      */

      const latitude =
        baseScenario.center[1];


      const longitude =
        baseScenario.center[0];


      setWeatherStatus(
        "updating"
      );


      try {

        const liveWeather =
          await fetchLiveWeather(
            latitude,
            longitude
          );


        setWeather(
          liveWeather
        );


        /*
          IMPORTANT:

          Rebuild the entire scenario.

          This ensures the threat model
          recalculates if buildScenario
          uses wind speed for threat
          distances as well.
        */

        setScenario(
          (currentScenario) =>
            buildScenario({
              mode:
                "live",

              location:
                currentScenario.location,

              center:
                currentScenario.center,

              material:
                currentScenario.material,

              quantity:
                currentScenario.quantity,

              windSpeed:
                liveWeather.windSpeed,

              windDirection:
                liveWeather.windDirection,
            })
        );


        /*
          Keep the setup form in sync.
        */

        setForm(
          (currentForm) => ({
            ...currentForm,

            windSpeed:
              Math.round(
                liveWeather.windSpeed
              ),

            windDirection:
              Math.round(
                liveWeather.windDirection
              ),
          })
        );


        setWeatherStatus(
          "live"
        );

      } catch (error) {

        console.warn(
          "AEGIS live weather update failed:",
          error
        );


        setWeatherStatus(
          "error"
        );

      }

    };


  /* =========================================================
     START / STOP LIVE WEATHER POLLING
  ========================================================= */

  useEffect(() => {

    /*
      Only poll weather while:

      - in live mode
      - on the command screen
      - scenario has coordinates
    */

    if (
      mode !== "live" ||
      screen !== "command" ||
      !scenario?.center
    ) {

      if (
        weatherIntervalRef.current
      ) {

        clearInterval(
          weatherIntervalRef.current
        );


        weatherIntervalRef.current =
          null;

      }


      return;

    }


    /*
      Immediately fetch weather once
      when entering the command screen.
    */

    applyLiveWeather(
      scenario
    );


    /*
      Then refresh every 5 minutes.
    */

    weatherIntervalRef.current =
      setInterval(
        () => {

          if (
            modeRef.current !==
            "live"
          ) {
            return;
          }


          applyLiveWeather(
            scenarioRef.current
          );

        },

        WEATHER_REFRESH_MS
      );


    return () => {

      if (
        weatherIntervalRef.current
      ) {

        clearInterval(
          weatherIntervalRef.current
        );


        weatherIntervalRef.current =
          null;

      }

    };

  }, [
    mode,
    screen,
  ]);


  /* =========================================================
     GENERATE SCENARIO
  ========================================================= */

  const applyScenario =
    async () => {

      setGenerating(
        true
      );


      setLocationError(
        ""
      );


      setWeatherStatus(
        "loading"
      );


      try {

        /*
          1. Find incident location.
        */

        const place =
          await geocodeLocation(
            form.location
          );


        /*
          2. Build initial scenario.

          Simulation mode uses the
          manually entered wind.
        */

        let next =
          buildScenario({
            ...form,

            location:
              form.location,

            center:
              place.center,

            mode,
          });


        /*
          3. LIVE MODE:

          Fetch weather immediately
          before opening command view.
        */

        if (
          mode === "live"
        ) {

          try {

            const liveWeather =
              await fetchLiveWeather(
                place.center[1],
                place.center[0]
              );


            setWeather(
              liveWeather
            );


            /*
              Rebuild using
              REAL wind data.
            */

            next =
              buildScenario({
                ...form,

                location:
                  form.location,

                center:
                  place.center,

                mode:
                  "live",

                windSpeed:
                  liveWeather.windSpeed,

                windDirection:
                  liveWeather.windDirection,
              });


            /*
              Update form too.
            */

            setForm(
              (currentForm) => ({
                ...currentForm,

                windSpeed:
                  Math.round(
                    liveWeather.windSpeed
                  ),

                windDirection:
                  Math.round(
                    liveWeather.windDirection
                  ),
              })
            );


            setWeatherStatus(
              "live"
            );

          } catch (weatherError) {

            /*
              Weather failure should NOT
              prevent the scenario from
              launching.

              Use manually entered wind
              as fallback.
            */

            console.warn(
              "Initial weather fetch failed:",
              weatherError
            );


            setWeatherStatus(
              "error"
            );

          }

        }


        /*
          4. Set scenario.

          MapView receives the new
          wind values and updates:

          - danger zones
          - safe zones
          - rescue route
          - wind animation
        */

        setScenario(
          next
        );


        setRouteStatus(
          "idle"
        );


        setScreen(
          "command"
        );

      } catch (error) {

        setLocationError(
          error.message ||
          "Could not locate this place."
        );

      } finally {

        setGenerating(
          false
        );

      }

    };


  /* =========================================================
     LANDING SCREEN
  ========================================================= */

  if (
    screen === "landing"
  ) {

    return (

      <div className="landing">

        <header>

          <b>AEGIS</b>

          <span>
            THREAT INTELLIGENCE /
            EMERGENCY RESPONSE
          </span>

          <i>
            ● SYSTEM READY
          </i>

        </header>


        <main className="hero">

          <div className="eyebrow">
            PREDICT · PROTECT · RESPOND
          </div>


          <h1>
            See the threat.
            <br/>
            <em>
              Find the way out.
            </em>
          </h1>


          <p>
            A cinematic emergency command
            interface for modeling industrial
            blast and thermal risk,
            visualizing wind-driven
            propagation, locating candidate
            safe zones, and guiding rescue
            response.
          </p>


          <div className="modeCards">

            <button
              className={
                mode === "live"
                  ? "active"
                  : ""
              }

              onClick={() =>
                setMode("live")
              }
            >

              <small>
                01 / LIVE RESPONSE
              </small>

              <b>
                Real-time incident
              </b>

              <span>
                Live weather +
                wind-driven threat field +
                safe zones +
                rescue routing.
              </span>

            </button>


            <button
              className={
                mode === "simulation"
                  ? "active"
                  : ""
              }

              onClick={() =>
                setMode(
                  "simulation"
                )
              }
            >

              <small>
                02 / SIMULATION
              </small>

              <b>
                Scenario modeling
              </b>

              <span>
                Control material,
                quantity and atmospheric
                conditions to inspect
                propagation.
              </span>

            </button>

          </div>


          <button
            className="primary"

            onClick={() =>
              setScreen("setup")
            }
          >

            CONFIGURE{" "}

            {
              mode === "live"
                ? "LIVE RESPONSE"
                : "SIMULATION"
            }

            {" "}→

          </button>

        </main>


        <footer>
          AEGIS /
          HACKATHON PROTOTYPE /
          DECISION SUPPORT UI
        </footer>

      </div>

    );

  }


  /* =========================================================
     SETUP SCREEN
  ========================================================= */

  if (
    screen === "setup"
  ) {

    return (

      <div className="setup">

        <header>

          <b>
            AEGIS
          </b>


          <button
            className="ghost"

            onClick={() =>
              setScreen("landing")
            }
          >

            ← BACK

          </button>

        </header>


        <div className="setupGrid">

          <section>

            <div className="eyebrow">

              {
                mode === "live"
                  ? "LIVE RESPONSE"
                  : "SIMULATION MODE"
              }

            </div>


            <h2>
              Build the{" "}
              <em>
                scenario.
              </em>
            </h2>


            <p>

              {
                mode === "live"

                  ? "AEGIS automatically retrieves current wind conditions for the incident location and recalculates the threat field."

                  : "Define atmospheric conditions and material parameters to generate the same threat model without live rescue guidance."
              }

            </p>


            <div className="note">

              <b>
                Live weather integration
              </b>

              <span>
                Wind speed and direction
                are automatically retrieved
                for the incident coordinates
                in Live Response mode.
              </span>

            </div>


            <div className="note">

              <b>
                Prototype behavior
              </b>

              <span>
                Threat distances are visual
                decision-support estimates,
                not certified emergency
                engineering outputs.
              </span>

            </div>

          </section>


          <section className="form">

            <label>

              INCIDENT LOCATION

              <input

                value={
                  form.location
                }

                onChange={
                  (e) => {

                    setForm({
                      ...form,

                      location:
                        e.target.value,
                    });


                    setLocationError(
                      ""
                    );

                  }
                }

                placeholder="
                  e.g. Chennai,
                  Tamil Nadu, India
                "

              />


              {
                locationError && (

                  <span
                    className="
                      locationError
                    "
                  >

                    {
                      locationError
                    }

                  </span>

                )
              }

            </label>


            <label>

              MATERIAL

              <select

                value={
                  form.material
                }

                onChange={
                  (e) =>
                    setForm({
                      ...form,

                      material:
                        e.target.value,
                    })
                }

              >

                {
                  MATERIALS.map(
                    (m) => (

                      <option
                        key={m}
                        value={m}
                      >

                        {m}

                      </option>

                    )
                  )
                }

              </select>

            </label>


            {/* QUANTITY */}

<label>
  QUANTITY / KG

  <input
    type="number"
    min="1"
    value={form.quantity}
    onChange={(e) =>
      setForm({
        ...form,
        quantity: Number(e.target.value),
      })
    }
  />
</label>


{/* SIMULATION ONLY: MANUAL WIND CONTROLS */}

  {mode === "simulation" && (
    <>
      <div className="two">

        <label>
          WIND SPEED / KM/H

          <input
            type="number"
            min="0"
            value={form.windSpeed}
            onChange={(e) =>
              setForm({
                ...form,
                windSpeed: Number(e.target.value),
              })
            }
          />
        </label>


        <label>
          WIND DIRECTION / DEGREES

          <input
            type="number"
            min="0"
            max="360"
            value={form.windDirection}
            onChange={(e) =>
              setForm({
                ...form,
                windDirection: Number(e.target.value),
              })
            }
          />
        </label>

      </div>
    </>
  )}


{/* LIVE WEATHER MESSAGE */}

{mode === "live" && (
  <div className="liveWeatherNotice">

    <span className="liveWeatherDot" />

    <div>
      <b>LIVE WIND DATA</b>

      <p>
        Wind speed and direction will be retrieved automatically
        for the incident location when the threat field is generated.
      </p>
    </div>

  </div>
)}

            <label>

              WIND DIRECTION /
              DEGREES

              <input

                type="number"

                min="0"

                max="360"

                value={
                  form.windDirection
                }

                disabled={
                  mode === "live"
                }

                onChange={
                  (e) =>
                    setForm({
                      ...form,

                      windDirection:
                        Number(
                          e.target.value
                        ),
                    })
                }

              />

            </label>


            {
              mode === "live" && (

                <small
                  style={{
                    opacity: 0.6,
                    display: "block",
                    marginTop: "-8px",
                    marginBottom: "12px",
                  }}
                >

                  LIVE MODE WILL USE
                  CURRENT WIND DATA FOR
                  THE INCIDENT LOCATION

                </small>

              )
            }


            <button

              className="
                primary wide
              "

              onClick={
                applyScenario
              }

              disabled={
                generating
              }

            >

              {
                generating

                  ? "BUILDING LIVE THREAT FIELD…"

                  : "GENERATE THREAT FIELD →"
              }

            </button>

          </section>

        </div>

      </div>

    );

  }


  /* =========================================================
     COMMAND SCREEN
  ========================================================= */

  return (

    <>

      <div className="command">

        <MapView

          scenario={
            scenario
          }

          liveMode={
            mode === "live"
          }

          routeStatus={
            routeStatus
          }

          onRouteStatus={
            setRouteStatus
          }

        />


        <div
          className="
            commandShade
          "
        />

        <button
          className="floatingExit"
          onClick={() => setScreen("setup")}
        >
          EXIT
        </button>

        {/* INCIDENT */}

        <section
          className="
            incidentCard glassCard
          "
        >

          <h2>
            INC-2047
          </h2>


          <p
            className="
              critical
            "
          >
            CRITICAL EVENT
          </p>


          <div
            className="
              incidentMeta
            "
          >

            {
              scenario.material
            }

            {" · "}

            {
              scenario.quantity
                .toLocaleString()
            }

            {" KG"}

          </div>


          <div
            className="
              incidentState
            "
          >

            {
              mode === "live"

                ? weatherStatus === "live"

                  ? "LIVE / WEATHER LINKED"

                  : "LIVE / WEATHER CONNECTING"

                : "SIMULATED / READY"
            }

          </div>

        </section>


        {/* LIVE CONDITIONS */}

        <section
          className="
            conditionsCard glassCard
          "
        >

          <small>

            {
              mode === "live"
                ? "● LIVE CONDITIONS"
                : "◈ CONDITIONS"
            }

          </small>


          <div>

            <b>
              {
                Math.round(
                  scenario.windSpeed
                )
              }{" "}
              KM/H
            </b>


            <span>
              {
                Math.round(
                  scenario.windDirection
                )
              }°
            </span>

          </div>


          {
            weather && (
              <small
                style={{
                  display:
                    "block",

                  marginTop:
                    "8px",

                  opacity:
                    0.65,
                }}
              >

                {
                  Math.round(
                    weather.temperature
                  )
                }°C

                {" · "}

                {
                  weather.humidity
                }% RH

              </small>
            )
          }

        </section>


        {/* PERSONAL ROUTE */}

        {
          mode === "live" && (

            <section
              className="
                routeCard glassCard
              "
            >

              <small>
                PERSONAL EVACUATION
              </small>


              <h3>

                {
                  routeStatus === "ready"

                    ? "ROUTE READY"

                    : routeStatus ===
                      "routing"

                      ? "CALCULATING ROUTE"

                      : routeStatus ===
                        "locating"

                        ? "LOCATING YOU"

                        : "LOCATE A SAFE PATH"
                }

              </h3>


              <p
                className="
                  routeCount
                "
              >
                03 CANDIDATE
                <br/>
                SAFE POINTS
              </p>


              <button

                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent(
                      "aegis:find-route"
                    )
                  )
                }

              >

                {
                  routeStatus === "ready"

                    ? "REFRESH ROUTE →"

                    : "USE MY LOCATION →"
                }

              </button>

            </section>

          )
        }


        {/* WIND VECTOR */}

        <div
          className="
            windReadout
          "
        >

          <span>
            {
              mode === "live"
                ? "LIVE WIND VECTOR"
                : "WIND VECTOR"
            }
          </span>


          <b>

            {
              Math.round(
                scenario.windSpeed
              )
            }

            {" KM/H · "}

            {
              Math.round(
                scenario.windDirection
              )
            }

            °

          </b>

        </div>


        {/* METRICS */}

        <footer
          className="
            metrics
          "
        >

          <div>

            <small>
              CRITICAL RADIUS
            </small>

            <b>
              {
                Math.round(
                  scenario.zones
                    .critical
                )
              } M
            </b>

          </div>


          <div>

            <small>
              HIGH RISK EXTENT
            </small>

            <b>
              {
                Math.round(
                  scenario.zones
                    .high
                )
              } M
            </b>

          </div>


          <div>

            <small>
              MAX PROPAGATION
            </small>

            <b>
              {
                Math.round(
                  scenario.zones
                    .moderate
                )
              } M
            </b>

          </div>


          <div>

            <small>
              EVACUATION TIME
            </small>

            <b>
              {
                scenario.evacuationTime
              }
            </b>

          </div>


          <button

            className="
              immersiveButton
            "

            onClick={() =>
              setImmersive(true)
            }

          >

            ENTER IMMERSIVE VIEW →

          </button>

        </footer>

      </div>


      {
        immersive && (

          <ImmersiveThreatField

            scenario={
              scenario
            }

            liveMode={
              mode === "live"
            }

            onClose={() =>
              setImmersive(false)
            }

          />

        )
      }

    </>

  );

}


createRoot(
  document.getElementById(
    "root"
  )
).render(
  <App />
);