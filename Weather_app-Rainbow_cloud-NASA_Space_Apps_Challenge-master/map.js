// map.js (ES module)
// This file depends on leaflet, georaster and georaster-layer-for-leaflet being loaded globally
import {
  geocodeSuggest,
  getCoordinates,
  getNameByCoordinates,
  getElevation,
  getClimate,
  updateInfo,
} from "./script.js";

let georasterObj = null;

// Ensure globals from CDN scripts are available in module scope
const L = window.L;
const GeoRasterLayer = window.GeoRasterLayer;
const parseGeoraster = window.parseGeoraster;

if (!L) {
  throw new Error(
    "Leaflet (window.L) is not available. Check Leaflet script tag order."
  );
}
if (!GeoRasterLayer) {
  console.warn(
    "GeoRasterLayer (window.GeoRasterLayer) is not available. Raster overlay will be skipped."
  );
}
if (!parseGeoraster) {
  console.warn(
    "parseGeoraster (window.parseGeoraster) is not available. GeoTIFF parsing will be skipped."
  );
}

// Initialize Leaflet map
const map = L.map("viewDiv", {
  zoomControl: true,
  worldCopyJump: false, // ngăn nhảy khi kéo qua biên
  fadeAnimation: false,
  zoomAnimation: false,
  markerZoomAnimation: false,
  updateWhenZooming: false,
  updateWhenIdle: true,
  inertia: false,
}).setView([10.8, 106.7], 6);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
  noWrap: true, // 🚫 không lặp bản đồ
  crossOrigin: true,
  keepBuffer: 4,
  tileSize: 256,
  updateWhenZooming: false,
  updateWhenIdle: true,
  errorTileUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", // 1x1 transparent fallback
  bounds: [
    [-90, -180],
    [90, 180],
  ],
}).addTo(map);
// Giới hạn pan toàn cầu
map.setMaxBounds([
  [-90, -180],
  [90, 180],
]);
map.on("drag", function () {
  map.panInsideBounds(
    [
      [-90, -180],
      [90, 180],
    ],
    { animate: false }
  );
});

// marker layer
const markerLayer = L.layerGroup().addTo(map);

// addMarker: clear previous and add new marker with popup
function addMarker(lon, lat, name = "", country = "") {
  markerLayer.clearLayers();
  const marker = L.marker([lat, lon]);
  marker
    .bindPopup(
      `<b>${name}, ${country}</b><br>Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(
        4
      )}`
    )
    .openPopup();
  marker.addTo(markerLayer);
}

window.addEventListener("resize", () => {
  map.invalidateSize();
});

// Observe wrapper size changes to keep map layout stable
const wrapper = document.getElementById("mapWrapper");
if (wrapper && "ResizeObserver" in window) {
  const ro = new ResizeObserver(() => {
    map.invalidateSize();
  });
  ro.observe(wrapper);
}

// Load GeoTIFF (local path)
const geotiffUrl = "data/koppen_geiger_0p1.tif";

async function loadGeoTiff(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn("Could not fetch GeoTIFF:", resp.status);
      return;
    }
    const arrayBuffer = await resp.arrayBuffer();
    // parseGeoraster is provided by georaster library (global)
    if (!parseGeoraster) return; // guard
    const georaster = await parseGeoraster(arrayBuffer);
    georasterObj = georaster;

    // Create GeoRasterLayer (global L.GeoRasterLayer from georaster-layer-for-leaflet)
    if (!GeoRasterLayer) return; // guard
    const layer = new GeoRasterLayer({
      georaster: georaster,
      opacity: 0.6,
      resolution: 256,
      pixelValuesToColorFn: function (values) {
        if (!values) return null;
        const v = values[0];
        if (v === null || v === undefined) return null;
        // simple consistent color mapping for integer codes
        const r = (v * 53) % 255;
        const g = (v * 97) % 255;
        const b = (v * 193) % 255;
        return `rgba(${r},${g},${b},0.6)`;
      },
    });
    layer.addTo(map);

    // Fit map to georaster bounds
    const bounds = [
      [georaster.ymin, georaster.xmin],
      [georaster.ymax, georaster.xmax],
    ];
    map.fitBounds(bounds, { maxZoom: 8 });

    // Optionally create legend (simple)
    createLegend();
    console.log("GeoTIFF loaded", georaster);
  } catch (err) {
    console.error("Error loading GeoTIFF:", err);
  }
}

function createLegend() {
  const legend = L.control({ position: "bottomright" });
  legend.onAdd = function () {
    const div = L.DomUtil.create("div", "legend");
    div.innerHTML = `<b>Raster legend</b><br/><small>Colored by integer code</small>`;
    return div;
  };
  legend.addTo(map);
}

// start loading
loadGeoTiff(geotiffUrl);

// Map click handler
map.on("click", async (e) => {
  const lat = e.latlng.lat;
  const lon = e.latlng.lng;

  const elevation = await getElevation(lat, lon);
  const climate = getClimate(lat, lon, georasterObj);
  const nameData = await getNameByCoordinates(lat, lon);

  addMarker(lon, lat, nameData.place_name, nameData.country || "");
  updateInfo(
    lat,
    lon,
    climate.climateType,
    elevation,
    nameData.place_name,
    nameData.country || ""
  );
});

// ----- Autocomplete UI -----
const input = document.getElementById("locationInput");
const suggestionBox = document.createElement("div");
suggestionBox.className = "suggestions";
input.parentNode.appendChild(suggestionBox);

let lastResults = [];

input.addEventListener("input", async () => {
  const q = input.value.trim();
  if (!q) {
    suggestionBox.innerHTML = "";
    return;
  }
  try {
    const results = await geocodeSuggest(q, 6);
    lastResults = results;
    suggestionBox.innerHTML = "";

    results.forEach((place) => {
      const display = `${place.name}${place.state ? ", " + place.state : ""}, ${
        place.country
      }`;
      const div = document.createElement("div");
      div.textContent = display;
      div.addEventListener("click", async () => {
        await pickLocation(place);
      });
      suggestionBox.appendChild(div);
    });
  } catch (err) {
    console.error("Autocomplete error:", err);
  }
});

// Enter picks first result
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    if (lastResults.length > 0) {
      pickLocation(lastResults[0]);
      suggestionBox.innerHTML = "";
    }
  }
});

// When clicking outside, hide suggestions
document.addEventListener("click", (e) => {
  if (!input.parentNode.contains(e.target)) {
    suggestionBox.innerHTML = "";
  }
});

async function pickLocation(place) {
  if (!place) return;
  input.value = `${place.name}, ${place.country}`;
  suggestionBox.innerHTML = "";

  const lat = place.lat;
  const lon = place.lon;

  map.setView([lat, lon], 8);
  addMarker(lon, lat, place.name, place.country);

  const elevation = await getElevation(lat, lon);
  const climate = getClimate(lat, lon, georasterObj);
  updateInfo(
    lat,
    lon,
    climate.climateType,
    elevation,
    place.name,
    place.country
  );
}

// expose some utils for debugging if needed
window._georaster = () => georasterObj;
window._map = map;
