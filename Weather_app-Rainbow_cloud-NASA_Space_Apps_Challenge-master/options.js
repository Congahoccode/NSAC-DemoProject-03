////// Weather 10 days using OpenWeather One Call 3.0
import { apiKey } from "./config.js";

/**
 * Fetch up to the next 10 days of daily forecast.
 * Returns an array of daily entries (max 10) in metric units.
 */
export async function getForecast10Days(lat, lon, count = 10) {
  // 1) Try One Call 3.0 (paid/limited access)
  try {
    const url30 = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=current,minutely,hourly,alerts&units=metric&appid=${apiKey}`;
    const r30 = await fetch(url30);
    if (r30.ok) {
      const d30 = await r30.json();
      const daily30 = Array.isArray(d30.daily) ? d30.daily : [];
      if (daily30.length)
        return daily30.slice(0, Math.min(10, Math.max(1, count)));
    }
  } catch (_) {}

  // 2) Fallback: One Call 2.5 (often still available; may return ~7-8 days)
  try {
    const url25 = `https://api.openweathermap.org/data/2.5/onecall?lat=${lat}&lon=${lon}&exclude=current,minutely,hourly,alerts&units=metric&appid=${apiKey}`;
    const r25 = await fetch(url25);
    if (r25.ok) {
      const d25 = await r25.json();
      const daily25 = Array.isArray(d25.daily) ? d25.daily : [];
      if (daily25.length)
        return daily25.slice(0, Math.min(10, Math.max(1, count)));
    }
  } catch (_) {}

  // 3) Fallback: 5-day/3-hour forecast → aggregate by calendar day
  // This returns up to 40 3h entries; we compute min/max per day and pick dominant weather
  try {
    const url3h = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`;
    const r3h = await fetch(url3h);
    if (!r3h.ok) throw new Error("forecast 3h not available");
    const d3h = await r3h.json();
    const list = Array.isArray(d3h.list) ? d3h.list : [];
    const byDay = new Map();
    for (const item of list) {
      const ts = (item.dt || 0) * 1000;
      const dayKey = new Date(ts).toISOString().slice(0, 10); // YYYY-MM-DD
      const rec = byDay.get(dayKey) || {
        temps: [],
        icons: {},
        descs: {},
        dt: Math.floor(ts / 1000),
      };
      if (item.main) rec.temps.push(item.main.temp);
      const icon = item.weather && item.weather[0]?.icon;
      const desc = item.weather && item.weather[0]?.description;
      if (icon) rec.icons[icon] = (rec.icons[icon] || 0) + 1;
      if (desc) rec.descs[desc] = (rec.descs[desc] || 0) + 1;
      byDay.set(dayKey, rec);
    }
    const days = Array.from(byDay.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(0, Math.min(10, Math.max(1, count)))
      .map(([_, rec]) => {
        const min = Math.round(Math.min(...rec.temps));
        const max = Math.round(Math.max(...rec.temps));
        const topIcon =
          Object.entries(rec.icons).sort((a, b) => b[1] - a[1])[0]?.[0] ||
          "01d";
        const topDesc =
          Object.entries(rec.descs).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
        return {
          dt: rec.dt,
          temp: { min, max },
          weather: [{ icon: topIcon, description: topDesc }],
        };
      });
    if (days.length) return days;
  } catch (err) {
    throw err;
  }

  throw new Error("No forecast data available");
}

// Optional: expose for quick testing from console
window.getForecast10Days = getForecast10Days;

/**
 * Get next 24 hourly temps with timestamp and icon.
 * Tries One Call 3.0 → 2.5; falls back to 5-day/3h expanded to hourly steps.
 * Returns: [{ dt, temp, icon, description }]
 */
export async function getHourly24(lat, lon) {
  // One Call 3.0 hourly
  try {
    const url30 = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=current,minutely,daily,alerts&units=metric&appid=${apiKey}`;
    const r30 = await fetch(url30);
    if (r30.ok) {
      const d30 = await r30.json();
      const arr = Array.isArray(d30.hourly) ? d30.hourly.slice(0, 24) : [];
      if (arr.length)
        return arr.map((h) => ({
          dt: h.dt,
          temp: h.temp,
          icon: h.weather?.[0]?.icon || "01d",
          description: h.weather?.[0]?.description || "",
        }));
    }
  } catch (_) {}

  // One Call 2.5 hourly
  try {
    const url25 = `https://api.openweathermap.org/data/2.5/onecall?lat=${lat}&lon=${lon}&exclude=current,minutely,daily,alerts&units=metric&appid=${apiKey}`;
    const r25 = await fetch(url25);
    if (r25.ok) {
      const d25 = await r25.json();
      const arr = Array.isArray(d25.hourly) ? d25.hourly.slice(0, 24) : [];
      if (arr.length)
        return arr.map((h) => ({
          dt: h.dt,
          temp: h.temp,
          icon: h.weather?.[0]?.icon || "01d",
          description: h.weather?.[0]?.description || "",
        }));
    }
  } catch (_) {}

  // 5-day/3h forecast fallback: expand to ~24 hours by duplicating/in-between
  try {
    const url3h = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`;
    const r3h = await fetch(url3h);
    if (!r3h.ok) throw new Error("forecast 3h not available");
    const d3h = await r3h.json();
    const list = Array.isArray(d3h.list) ? d3h.list.slice(0, 9) : []; // 9*3h ≈ 27h
    const hours = [];
    for (const it of list) {
      hours.push({
        dt: it.dt,
        temp: it.main?.temp ?? 0,
        icon: it.weather?.[0]?.icon || "01d",
        description: it.weather?.[0]?.description || "",
      });
    }
    return hours.slice(0, 24);
  } catch (err) {
    throw err;
  }
}

window.getHourly24 = getHourly24;
