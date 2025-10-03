// script.js (ES module)
// Functions: geocodeSuggest, getCoordinates, getNameByCoordinates, getElevation, getClimate, updateInfo

import { apiKey } from "./config.js";
import { getForecast10Days, getHourly24 } from "./options.js";

/**
 * Gợi ý geocoding (OpenWeather Direct Geocoding)
 * returns array of places [{name, lat, lon, country, local_names}, ...]
 */
export async function geocodeSuggest(query, limit = 5) {
  if (!query) return [];
  try {
    const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(
      query
    )}&limit=${limit}&appid=${apiKey}`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const data = await r.json();
    return data;
  } catch (err) {
    console.error("geocodeSuggest error:", err);
    return [];
  }
}

/**
 * Lấy tọa độ 1 kết quả (limit=1)
 */
export async function getCoordinates(city) {
  try {
    const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(
      city
    )}&limit=1&appid=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("City not found");
    const data = await response.json();
    if (!data || data.length === 0) throw new Error("City not found");
    return {
      lat: data[0].lat,
      lon: data[0].lon,
      local_name: data[0].local_names || {},
      country: data[0].country,
      name: data[0].name,
    };
  } catch (err) {
    throw err;
  }
}

/**
 * Reverse geocoding (by coordinates)
 */
export async function getNameByCoordinates(lat, lon) {
  try {
    const url = `https://api.openweathermap.org/geo/1.0/reverse?lat=${lat}&lon=${lon}&limit=1&appid=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data && data.length > 0) {
      return { place_name: data[0].name, country: data[0].country };
    }
    return { place_name: "Unknown place", country: "" };
  } catch (err) {
    console.error("getNameByCoordinates error:", err);
    return { place_name: "Unknown place", country: "" };
  }
}

/**
 * Lấy độ cao (Open-Elevation free)
 */
export async function getElevation(lat, lon) {
  try {
    const url = `https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lon}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.results && data.results.length > 0) {
      return data.results[0].elevation;
    }
    return null;
  } catch (err) {
    console.error("getElevation error:", err);
    return null;
  }
}

/**
 * Lấy thông tin khí hậu từ georaster object (đã parse bằng parseGeoraster)
 * georaster: đối tượng georaster hoặc null
 * Trả về { climateCode, climateType }
 */
const koppenClasses = {
  // Ví dụ mapping (bạn mở rộng theo bộ dữ liệu của bạn)
  0: { name: "No data" },
  1: { name: "Tropical (A)" },
  2: { name: "Arid (B)" },
  3: { name: "Temperate (C)" },
  4: { name: "Cold (D)" },
  5: { name: "Polar (E)" },
  // ... mở rộng theo giá trị thực tế của GeoTIFF bạn dùng
};

export function getClimate(lat, lon, georaster) {
  let climateCode = null;
  let climateType = "Unknown";
  try {
    if (!georaster) return { climateCode, climateType };

    const xmin = georaster.xmin;
    const ymax = georaster.ymax;
    const pixelWidth = georaster.pixelWidth;
    const pixelHeight = georaster.pixelHeight;

    const xPixel = Math.floor((lon - xmin) / pixelWidth);
    const yPixel = Math.floor((ymax - lat) / Math.abs(pixelHeight));

    if (
      yPixel >= 0 &&
      yPixel < georaster.height &&
      xPixel >= 0 &&
      xPixel < georaster.width
    ) {
      const val = georaster.values[0][yPixel][xPixel];
      climateCode = val;
      if (val in koppenClasses) {
        climateType = koppenClasses[val].name;
      } else {
        climateType = `Code ${val}`;
      }
    }
  } catch (err) {
    console.error("getClimate error:", err);
  }
  return { climateCode, climateType };
}

/**
 * Lấy thời tiết hiện tại (OpenWeather Current)
 */
export async function getCurrentWeather(lat, lon) {
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("Could not fetch weather data");
    return await response.json();
  } catch (err) {
    throw err;
  }
}

/**
 * Cập nhật toàn bộ UI bên trái (nhiệt độ, humidity, v.v.)
 */
export async function updateInfo(
  lat,
  lon,
  climateType = "Unknown",
  elevation = "Unknown",
  place_name = "",
  country = ""
) {
  try {
    // remember last selected coordinates for other features (e.g., 10-day forecast)
    window._lastLatLon = { lat, lon };
    document.getElementById(
      "location_name"
    ).innerHTML = `${place_name}, ${country}`;
    document.getElementById("elevation").innerHTML = `Elevation: ${
      elevation ?? "Unknown"
    } m`;
    document.getElementById(
      "climate_type"
    ).innerHTML = `Climate type: ${climateType}`;

    const current = await getCurrentWeather(lat, lon);
    const descriptions = current.weather.map((w) =>
      w.description.toLowerCase()
    );

    const tempC = (current.main.temp - 273.15).toFixed(1);
    const feelsC = (current.main.feels_like - 273.15).toFixed(1);

    document.getElementById("temperature").innerHTML = `${tempC}°C`;
    document.getElementById("weather_desc").innerHTML =
      current.weather[0].description;
    document.getElementById("feels_like").innerHTML = `Feels like: ${feelsC}°C`;

    // update background
    updateBackground(descriptions);

    document.getElementById(
      "weather_icon"
    ).src = `http://openweathermap.org/img/wn/${current.weather[0].icon}@2x.png`;

    const minC = (current.main.temp_min - 273.15).toFixed(1);
    const maxC = (current.main.temp_max - 273.15).toFixed(1);
    // Prefer accurate min/max from daily forecast if available
    try {
      const dailyOne = await getForecast10Days(lat, lon, 1);
      if (Array.isArray(dailyOne) && dailyOne.length > 0 && dailyOne[0].temp) {
        const minDaily = Math.round(dailyOne[0].temp.min);
        const maxDaily = Math.round(dailyOne[0].temp.max);
        document.getElementById(
          "temp_range"
        ).innerHTML = `Min ${minDaily}°C / Max ${maxDaily}°C`;
      } else {
        document.getElementById(
          "temp_range"
        ).innerHTML = `Min ${minC}°C / Max ${maxC}°C`;
      }
    } catch (e) {
      document.getElementById(
        "temp_range"
      ).innerHTML = `Min ${minC}°C / Max ${maxC}°C`;
    }

    const humidity = current.main.humidity;
    document.getElementById("humidity_value").innerHTML = `${humidity}%`;
    const bar = document.getElementById("humidity_bar");
    if (bar) bar.style.width = humidity + "%";

    const wind_ms = current.wind.speed;
    const wind_kmh = (wind_ms * 3.6).toFixed(1);
    document.getElementById(
      "wind_value"
    ).innerHTML = `${wind_ms} m/s (${wind_kmh} km/h)`;

    let precip = 0;
    if (current.rain && current.rain["1h"]) precip = current.rain["1h"];
    if (current.snow && current.snow["1h"]) precip = current.snow["1h"];
    document.getElementById("precip_value").innerHTML = `${precip} mm`;

    // Fetch UV index from One Call (3.0 -> 2.5 fallback); show numeric with category
    try {
      let uvi = null;
      // try 3.0
      const r30 = await fetch(
        `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=minutely,hourly,daily,alerts&appid=${apiKey}`
      );
      if (r30.ok) {
        const j30 = await r30.json();
        uvi = j30?.current?.uvi ?? null;
      } else {
        const r25 = await fetch(
          `https://api.openweathermap.org/data/2.5/onecall?lat=${lat}&lon=${lon}&exclude=minutely,hourly,daily,alerts&appid=${apiKey}`
        );
        if (r25.ok) {
          const j25 = await r25.json();
          uvi = j25?.current?.uvi ?? null;
        }
      }
      if (uvi !== null && uvi !== undefined) {
        document.getElementById("uv_index").innerHTML = formatUvi(uvi);
      } else {
        document.getElementById("uv_index").innerHTML = "–";
      }
    } catch {
      document.getElementById("uv_index").innerHTML = "–";
    }

    const bars = document.querySelectorAll(".comfort_bar");
    bars.forEach((b, i) => {
      b.style.background = i < 2 ? "#4caf50" : "#ddd";
    });
  } catch (err) {
    console.error("updateInfo error:", err);
  }
}

/* UI helper: đổi background theo mô tả thời tiết */
function updateBackground(descriptions) {
  const info = document.getElementById("info");
  if (!info) return;

  info.classList.remove(
    "weather-clear",
    "weather-cloud",
    "weather-rain",
    "weather-snow",
    "weather-mist",
    "weather-sunny"
  );

  const desc =
    descriptions && descriptions.length ? descriptions[0].toLowerCase() : "";

  if (desc.includes("rain")) info.classList.add("weather-rain");
  else if (desc.includes("cloud")) info.classList.add("weather-cloud");
  else if (desc.includes("clear")) info.classList.add("weather-clear");
  else if (desc.includes("snow")) info.classList.add("weather-snow");
  else if (desc.includes("mist") || desc.includes("fog"))
    info.classList.add("weather-mist");
  else info.classList.add("weather-sunny");
}

// ---- UVI helpers ----
function uviCategory(uvi) {
  if (uvi < 3) return "Low";
  if (uvi < 6) return "Moderate";
  if (uvi < 8) return "High";
  if (uvi < 11) return "Very High";
  return "Extreme";
}
function formatUvi(uvi) {
  const n = Math.round(uvi);
  return `${n} (${uviCategory(n)})`;
}

// ---------- Future Weather UI ----------
async function renderFutureWeather(lat, lon) {
  const container = document.getElementById("futureWeather");
  const list = document.getElementById("futureWeatherList");
  if (!container || !list) return;
  list.innerHTML = "Loading...";
  try {
    const daily = await getForecast10Days(lat, lon, 6);
    const items = daily.map((d) => {
      const date = new Date((d.dt || 0) * 1000);
      const day = date.toLocaleDateString(undefined, {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
      });
      const min = Math.round(d.temp?.min ?? 0);
      const max = Math.round(d.temp?.max ?? 0);
      const icon = (d.weather && d.weather[0]?.icon) || "01d";
      const desc = (d.weather && d.weather[0]?.description) || "";
      const wind =
        d.wind_speed !== undefined
          ? `${Math.round(d.wind_speed * 3.6)} km/h`
          : "";
      const humidity = d.humidity !== undefined ? `${d.humidity}%` : null;
      const uvi = d.uvi !== undefined ? formatUvi(d.uvi) : null;
      const rain = (d.rain && (d.rain["1h"] || d.rain)) || 0;
      return `
        <div class="future-card">
          <div class="day">${day}</div>
          <div class="fc-header">
            <img alt="" src="http://openweathermap.org/img/wn/${icon}.png" />
            <div class="fc-temps">
              <div class="max">${max}°C</div>
              <div class="min">${min}°C</div>
            </div>
          </div>
          <div class="spacer"></div>
          <div class="desc">${desc}</div>
          <div class="future-meta">${[
            humidity ? `Humidity ${humidity}` : null,
            uvi ? `UV ${uvi}` : null,
            `Rain ${rain || 0} mm`,
            wind ? `Wind ${wind}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}</div>
        </div>`;
    });
    list.innerHTML = items.join("");
    container.hidden = false;
  } catch (e) {
    console.error("renderFutureWeather error", e);
    list.innerHTML =
      "Không thể tải dữ liệu dự báo 10 ngày (kiểm tra API key/gói truy cập).";
    container.hidden = false;
  }
}

// Hook up the Future Weather button: uses last-known lat/lon from marker or map center
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.querySelector('[data-target="ten-days"]');
  if (!btn) return;
  btn.addEventListener("click", async () => {
    try {
      const src = window._lastLatLon ||
        (window._map && window._map.getCenter()) || { lat: 10.8, lon: 106.7 };
      const lat = src.lat !== undefined ? src.lat : src.latlng?.lat;
      const lon = src.lon !== undefined ? src.lon : src.lng ?? src.latlng?.lng;
      hideAllPanels();
      await renderFutureWeather(lat, lon);
      const target = document.getElementById("futureWeather");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      console.error(e);
    }
  });
  const hourlyBtn = document.querySelector('[data-target="hourly"]');
  if (hourlyBtn) {
    hourlyBtn.addEventListener("click", async () => {
      try {
        const src = window._lastLatLon ||
          (window._map && window._map.getCenter()) || { lat: 10.8, lon: 106.7 };
        const lat = src.lat !== undefined ? src.lat : src.latlng?.lat;
        const lon =
          src.lon !== undefined ? src.lon : src.lng ?? src.latlng?.lng;
        hideAllPanels();
        await renderHourly(lat, lon);
        const target = document.getElementById("hourlyWeather");
        if (target)
          target.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (e) {
        console.error(e);
      }
    });
  }
});

function hideAllPanels() {
  const future = document.getElementById("futureWeather");
  const hourly = document.getElementById("hourlyWeather");
  if (future) future.hidden = true;
  if (hourly) hourly.hidden = true;
}

// ---------- Hourly Chart ----------
async function renderHourly(lat, lon) {
  const section = document.getElementById("hourlyWeather");
  const list = document.getElementById("hourlyList");
  if (!section || !list) return;
  section.hidden = false;
  list.innerHTML = "Loading...";

  let hours = [];
  try {
    hours = await getHourly24(lat, lon);
  } catch (e) {
    console.error("getHourly24 error", e);
    list.innerHTML = "Không thể tải dữ liệu hourly.";
    return;
  }
  if (!hours.length) {
    list.innerHTML = "No hourly data available.";
    return;
  }

  // pick 8 items, each 3h apart; allow crossing to next day
  const startIdx = hours.findIndex(
    (h) => new Date(h.dt * 1000).getHours() % 3 === 0
  );
  const first = startIdx >= 0 ? startIdx : 0;
  const picks = [];
  for (let k = 0; k < 8; k++) {
    const idx = first + k * 3;
    if (idx < hours.length) picks.push(hours[idx]);
  }
  if (picks.length === 0) picks.push(hours[0]);
  const html = picks
    .map((h) => {
      const dtObj = new Date(h.dt * 1000);
      const hr = dtObj.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      const dayStr = dtObj.toLocaleDateString([], {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
      });
      const temp = Math.round(h.temp);
      const icon = h.icon || "01d";
      const wind =
        h.wind_speed !== undefined
          ? `${Math.round(h.wind_speed * 3.6)} km/h`
          : "";
      const rain = h.rain?.["1h"] ?? h.rain ?? 0;
      const rainText = rain ? `${rain} mm` : "0 mm";
      return `
      <div class="hour-card">
        <div class="time">${hr}</div>
        <div class="date">${dayStr}</div>
        <img alt="" src="http://openweathermap.org/img/wn/${icon}@2x.png"/>
        <div class="temp">${temp}°C</div>
        <div class="meta">Rain: ${rainText} · ${wind}</div>
      </div>`;
    })
    .join("");
  list.innerHTML = html;
}
