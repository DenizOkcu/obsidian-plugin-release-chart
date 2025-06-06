#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

// Get plugin name from command line arguments
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error(
    "Error: Plugin name must be provided as a command-line argument.",
  );
  console.log("Usage: node generate-download-chart.js <plugin-name>");
  process.exit(1);
}
const pluginName = args[0];
const pluginId = pluginName.toLowerCase().replace(/\s+/g, "-");

// Input file containing the historical data
const inputFile = `${pluginId}-history.json`;
// Output HTML file with the chart
const outputHtmlFile = `${pluginId}-downloads-chart.html`;
// Output CSS file
const outputCssFile = `${pluginId}-downloads-chart.css`;

// Read and parse the JSON data
console.log(`Reading data from ${inputFile}...`);
if (!fs.existsSync(inputFile)) {
  console.error(`Error: File '${inputFile}' not found.`);
  process.exit(1);
}

const historicalData = JSON.parse(fs.readFileSync(inputFile, "utf8"));

// Process data for the chart
console.log(`Processing data for the chart...`);

// Convert the data into a chronologically ordered array
const dataPoints = Object.entries(historicalData)
  .map(([timestamp, entry]) => ({
    date: new Date(parseInt(timestamp)), // Use the timestamp directly from the key
    downloads: entry.data.downloads || 0,
    dailyGrowth: entry.data.dailyGrowth || 0,
    versions: Object.entries(entry.data)
      .filter(
        ([key]) =>
          key !== "downloads" && key !== "updated" && key !== "dailyGrowth",
      )
      .reduce((acc, [version, count]) => {
        acc[version] = count;
        return acc;
      }, {}),
  }))
  .sort((a, b) => a.date - b.date); // Sort by date ascending

// Determine the current version for each data point
// Start with no version and update it when we find a new one
let currentVersion = null;
dataPoints.forEach((point) => {
  // Check if this data point has new versions
  const versions = Object.keys(point.versions);
  if (versions.length > 0) {
    // Find newest version using semver-like comparison
    const newestVersion = versions.sort((a, b) => {
      const aParts = a.split(".").map(Number);
      const bParts = b.split(".").map(Number);
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aVal = aParts[i] || 0;
        const bVal = bParts[i] || 0;
        if (aVal !== bVal) return bVal - aVal;
      }
      return 0;
    })[0];

    // Update current version if this is newer
    if (!currentVersion || versions.includes(currentVersion)) {
      currentVersion = newestVersion;
    }
  }

  // Tag this data point with the current version
  point.currentVersion = currentVersion;
});

// Create arrays for chart data
const dates = dataPoints.map((point) => point.date.toISOString());
const downloadCounts = dataPoints.map((point) => point.downloads);

// Extract daily growth data directly from dataPoints
const derivativeData = dataPoints.map((point) => ({
  x: point.date.toISOString(),
  y: point.dailyGrowth || 0, // Use 0 if dailyGrowth is not present
}));
const oldestDate = dataPoints[0].date.getTime();
const newestDate = dataPoints[dataPoints.length - 1].date.getTime();

// Get version release points for annotations and dataset segmentation
const versionReleases = [];
const processedVersions = new Set();

// First, collect all versions
dataPoints.forEach((point, index) => {
  const versions = Object.keys(point.versions);
  versions.forEach((version) => {
    if (!processedVersions.has(version)) {
      processedVersions.add(version);

      // Log found versions for debugging
      console.log(
        `Found version ${version} at index ${index} (${
          point.date.toISOString().split("T")[0]
        })`,
      );

      versionReleases.push({
        version,
        date: point.date,
        index,
        downloads: point.downloads,
      });
    }
  });
});

console.log(`Total unique versions found: ${versionReleases.length}`);

// Helper function to compare semantic versions correctly
function compareVersions(a, b) {
  // Handle special cases like beta, alpha, etc.
  const aBase = a.split(/[-+]/)[0]; // Get the part before any -beta, -alpha, etc.
  const bBase = b.split(/[-+]/)[0];

  const aParts = aBase.split(".").map((part) => parseInt(part, 10) || 0);
  const bParts = bBase.split(".").map((part) => parseInt(part, 10) || 0);

  // Compare version numbers (major.minor.patch)
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i] || 0;
    const bPart = bParts[i] || 0;
    if (aPart !== bPart) {
      return aPart - bPart;
    }
  }

  // If base versions are the same, consider pre-release tags
  // Versions with no pre-release tag come AFTER those with one (per semver spec)
  const aHasPreRelease = a.includes("-");
  const bHasPreRelease = b.includes("-");

  if (!aHasPreRelease && bHasPreRelease) return 1; // a is greater (no pre-release)
  if (aHasPreRelease && !bHasPreRelease) return -1; // b is greater (no pre-release)
  if (!aHasPreRelease && !bHasPreRelease) return 0;

  // Both have pre-release tags, compare them lexically
  const aPreRelease = a.split("-")[1];
  const bPreRelease = b.split("-")[1];
  return aPreRelease.localeCompare(bPreRelease);
}

// Sort version releases by semantic version number (oldest first)
versionReleases.sort((a, b) => compareVersions(a.version, b.version));

// Calculate additional metrics for each version
for (let i = 0; i < versionReleases.length; i++) {
  const currentVersionRelease = versionReleases[i];
  const currentVersionStartIndex = currentVersionRelease.index;

  // Handle cases where a semantically later version supersedes the current one at the exact same data point index
  if (i < versionReleases.length - 1) {
    const semanticallyNextVersionRelease = versionReleases[i + 1];
    if (semanticallyNextVersionRelease.index === currentVersionStartIndex) {
      // This version is immediately superseded by a semantically later one at the same data point.
      // Assign zero effective duration and impact.
      currentVersionRelease.endDownloads = currentVersionRelease.downloads;
      currentVersionRelease.downloadChange = 0;
      currentVersionRelease.durationDays = 0;
      currentVersionRelease.avgDailyGrowth = 0;

      // Log this specific case
      console.log(
        `Version ${currentVersionRelease.version} (at index ${currentVersionStartIndex}) is superseded by ${semanticallyNextVersionRelease.version} (also at index ${semanticallyNextVersionRelease.index}) at the same data point. Setting zero duration and impact.`,
      );
      continue; // Move to the next version in versionReleases
    }
  }

  // If not superseded at the same data point index, determine the end of its active period.
  // The period ends when the *next chronologically occurring* version (from versionReleases) starts.
  let nextChronologicalReleaseStartIndex = dataPoints.length; // Default: current version's period extends to the end of data

  for (const otherRelease of versionReleases) {
    // Consider only other releases that start *after* the current one's start index
    if (otherRelease.index > currentVersionStartIndex) {
      if (otherRelease.index < nextChronologicalReleaseStartIndex) {
        // This is the earliest chronological next release found so far
        nextChronologicalReleaseStartIndex = otherRelease.index;
      }
    }
  }
  // Now, 'nextChronologicalReleaseStartIndex' is the index in 'dataPoints' where the next version's period effectively starts.
  // The current version's active period spans dataPoints[currentVersionStartIndex] through dataPoints[nextChronologicalReleaseStartIndex - 1].

  // The index of the last data point for the current version's period.
  // This index must be valid for accessing dataPoints and downloadCounts.
  // Since dataPoints is non-empty (checked earlier) and currentVersionStartIndex is a valid index (>=0):
  // - nextChronologicalReleaseStartIndex will be > currentVersionStartIndex OR equal to dataPoints.length.
  // - Therefore, nextChronologicalReleaseStartIndex >= 1 (assuming dataPoints.length >= 1).
  // - So, (nextChronologicalReleaseStartIndex - 1) will be >= 0.
  // - Also, nextChronologicalReleaseStartIndex <= dataPoints.length, so (nextChronologicalReleaseStartIndex - 1) <= dataPoints.length - 1.
  // This makes 'lastDataPointIndexForCurrentVersion' a safe index.
  const lastDataPointIndexForCurrentVersion =
    nextChronologicalReleaseStartIndex - 1;

  const startDownloads = currentVersionRelease.downloads;
  // Ensure access is within bounds, though logic above should guarantee it for non-empty dataPoints
  const endDownloads =
    lastDataPointIndexForCurrentVersion >= 0 &&
    lastDataPointIndexForCurrentVersion < downloadCounts.length
      ? downloadCounts[lastDataPointIndexForCurrentVersion]
      : downloadCounts.length > 0
      ? downloadCounts[downloadCounts.length - 1]
      : startDownloads; // Fallback if array empty or index issue

  const downloadChange = endDownloads - startDownloads;

  const startDate = dataPoints[currentVersionStartIndex].date;
  const endDate =
    lastDataPointIndexForCurrentVersion >= 0 &&
    lastDataPointIndexForCurrentVersion < dataPoints.length
      ? dataPoints[lastDataPointIndexForCurrentVersion].date
      : dataPoints.length > 0
      ? dataPoints[dataPoints.length - 1].date
      : startDate; // Fallback

  // Calculate duration in days
  const durationMs = endDate.getTime() - startDate.getTime();
  // Math.max(1, ...) ensures duration is at least 1 day, even if start and end are the same or very close.
  // This also prevents division by zero for avgDailyGrowth if durationMs is 0.
  const durationDays = Math.max(
    1,
    Math.round(durationMs / (1000 * 60 * 60 * 24)),
  );

  // Calculate average daily growth
  const avgDailyGrowth = Math.round(downloadChange / durationDays); // durationDays is guaranteed >= 1

  // Add calculated metrics to the version release object
  currentVersionRelease.endDownloads = endDownloads;
  currentVersionRelease.downloadChange = downloadChange;
  currentVersionRelease.durationDays = durationDays;
  currentVersionRelease.avgDailyGrowth = avgDailyGrowth;
}

// Create a mapping of versions to their indices and rebuild versionIndices
const versionToIndexMap = new Map();
versionReleases.forEach((release, index) => {
  versionToIndexMap.set(release.version, index);
});

// Use index of the first version release in the sorted data
const firstVersionIdx =
  versionReleases.length > 0 ? versionReleases[0].index : 0;

// Generate unique colors for each version
function generateColors(count) {
  const colors = [];
  // Set of base colors (you can customize these)
  const baseColors = [
    "#0066cc", // blue
    "#cc0000", // red
    "#009900", // green
    "#9900cc", // purple
    "#ff9900", // orange
    "#00cccc", // teal
    "#cc0099", // pink
    "#666600", // olive
    "#ff0099", // magenta
    "#006666", // dark cyan
  ];

  for (let i = 0; i < count; i++) {
    colors.push(baseColors[i % baseColors.length]);
  }
  return colors;
}

const versionColors = generateColors(
  (firstVersionIdx > 0 ? 1 : 0) + versionReleases.length,
);

// Break the data into segments by version
const datasets = [];

// Calculate 7-day rolling average of the daily download rates
const rollingAverageData7Day = [];
const windowSize7Day = 7; // 7-day window

for (let i = 0; i < derivativeData.length; i++) {
  // Calculate the start index for the window (max of 0 or i - windowSize + 1)
  const startIdx = Math.max(0, i - windowSize7Day + 1);
  const windowValues = derivativeData
    .slice(startIdx, i + 1)
    .map((item) => item.y);

  // Calculate the average of values in the window
  const sum = windowValues.reduce((acc, val) => acc + val, 0);
  const avg = windowValues.length > 0 ? sum / windowValues.length : 0;

  rollingAverageData7Day.push({
    x: derivativeData[i].x,
    y: Math.round(avg), // Round to integer
  });
}

// Calculate 30-day rolling average
const rollingAverageData30Day = [];
const windowSize30Day = 30; // 30-day window

for (let i = 0; i < derivativeData.length; i++) {
  // Calculate the start index for the window (max of 0 or i - windowSize + 1)
  const startIdx = Math.max(0, i - windowSize30Day + 1);
  const windowValues = derivativeData
    .slice(startIdx, i + 1)
    .map((item) => item.y);

  // Calculate the average of values in the window
  const sum = windowValues.reduce((acc, val) => acc + val, 0);
  const avg = windowValues.length > 0 ? sum / windowValues.length : 0;

  rollingAverageData30Day.push({
    x: derivativeData[i].x,
    y: Math.round(avg), // Round to integer
  });
}

// Add datasets for downloads by version
const versionDatasets = [];

// First create an "Initial" dataset for data before the first version
if (firstVersionIdx > 0) {
  // Create point colors array for the initial dataset
  const initialPointColors = Array(firstVersionIdx + 1).fill(versionColors[0]);
  // Make the last point (which will overlap with first version) transparent so the next version's color shows
  if (firstVersionIdx < dates.length - 1) {
    initialPointColors[firstVersionIdx] = "transparent";
  }

  versionDatasets.push({
    label: "Initial",
    data: downloadCounts
      .slice(0, firstVersionIdx + 1) // Include one extra point to connect with first version
      .concat(Array(dates.length - firstVersionIdx - 1).fill(null)),
    borderColor: versionColors[0],
    backgroundColor: `${versionColors[0]}22`,
    borderWidth: 3,
    pointRadius: 1,
    pointHoverRadius: 4,
    pointBackgroundColor: initialPointColors.concat(
      Array(dates.length - firstVersionIdx - 1).fill("transparent"),
    ),
    fill: true,
    tension: 0.1,
    yAxisID: "y",
  });
}

// Now add a dataset for each version
for (let i = 0; i < versionReleases.length; i++) {
  const currentVersion = versionReleases[i];
  const currentIdx = currentVersion.index;
  const currentColor = versionColors[i + (firstVersionIdx > 0 ? 1 : 0)];

  // Find the next data point where a different version appears
  let nextIdx = dates.length; // default to end of data

  // Use all data points until the next version, or until the end of data
  for (let j = i + 1; j < versionReleases.length; j++) {
    const nextVersion = versionReleases[j];
    // Only consider it a boundary if this version shows up later in the dataset
    if (nextVersion.index > currentIdx) {
      nextIdx = nextVersion.index;
      break;
    }
  }

  // Include one extra data point at the end to ensure continuity (except for the last version)
  const endIdx =
    i < versionReleases.length - 1 && nextIdx < dates.length
      ? nextIdx + 1
      : nextIdx;

  // Create point colors array for this version
  const dataLength = endIdx - currentIdx;
  const pointColors = Array(dates.length).fill("transparent");

  // Fill the relevant range with the current version's color
  for (let j = currentIdx; j < endIdx; j++) {
    pointColors[j] = currentColor;
  }

  // If this is not the last version and we have an overlapping point,
  // make the last point transparent so the next version's color shows
  if (
    i < versionReleases.length - 1 &&
    endIdx > currentIdx &&
    endIdx <= dates.length
  ) {
    pointColors[endIdx - 1] = "transparent";
  }

  // Create a dataset for this version
  versionDatasets.push({
    label: `v${currentVersion.version}`,
    data: Array(currentIdx)
      .fill(null)
      .concat(downloadCounts.slice(currentIdx, endIdx))
      .concat(Array(dates.length - endIdx).fill(null)),
    borderColor: currentColor,
    backgroundColor: `${currentColor}22`,
    borderWidth: 3,
    pointRadius: 1,
    pointHoverRadius: 4,
    pointBackgroundColor: pointColors,
    fill: true,
    tension: 0.1,
    yAxisID: "y",
  });
}

// Add all version datasets to the datasets array
datasets.push(...versionDatasets);

// Add the rate of change dataset
datasets.push({
  label: "Daily Growth Rate",
  data: derivativeData,
  borderColor: "#000000",
  backgroundColor: "rgba(0, 0, 0, 0.1)",
  borderWidth: 1.5,
  pointRadius: 0,
  pointHoverRadius: 4,
  fill: false,
  tension: 0.1,
  yAxisID: "y1", // Use the right axis
  borderDash: [2, 2], // Shorter dotted line
});

// Add the 7-day rolling average dataset
datasets.push({
  label: "7-Day Rolling Avg",
  data: rollingAverageData7Day,
  borderColor: "#FF5733", // Orange color
  backgroundColor: "rgba(255, 87, 51, 0.15)",
  borderWidth: 3,
  pointRadius: 0, // No points for cleaner look
  pointHoverRadius: 4,
  fill: true, // Add subtle fill
  tension: 0.1,
  yAxisID: "y1", // Use the right axis
  borderDash: [], // Solid line
});

// Add the 30-day rolling average dataset
datasets.push({
  label: "30-Day Rolling Avg",
  data: rollingAverageData30Day,
  borderColor: "#3498DB", // Blue color
  backgroundColor: "rgba(52, 152, 219, 0.15)",
  borderWidth: 3.5,
  pointRadius: 0, // No points for cleaner look
  pointHoverRadius: 4,
  fill: true, // Add subtle fill
  tension: 0.1,
  yAxisID: "y1", // Use the right axis
  borderDash: [8, 4], // Long dash
});

// Extract CSS into a separate file
const cssContent = `body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    margin: 0;
    padding: 20px;
    background-color: #f5f5f5;
}
.container {
    max-width: 1200px;
    margin: 0 auto;
    background-color: white;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    padding: 20px;
}
h1 {
    text-align: center;
    color: #333;
    margin-top: 0;
}
.chart-container {
    position: relative;
    height: 60vh;
    width: 100%;
}
.slider-container {
    margin: 20px 0;
    padding: 0 10px;
}
#time-slider {
    height: 10px;
    margin-top: 40px;
}
.time-display {
    display: flex;
    justify-content: space-between;
    margin-top: 15px;
}
.version-list {
    margin-top: 30px;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
}
.version-tag {
    border-radius: 16px;
    padding: 5px 12px;
    font-size: 14px;
    color: white;
}
.stats {
    margin-top: 20px;
    display: flex;
    justify-content: space-around;
    background-color: #f8f9fa;
    border-radius: 8px;
    padding: 15px;
}
.stat-box {
    text-align: center;
}
.stat-value {
    font-size: 24px;
    font-weight: bold;
    color: #0066cc;
}
.stat-label {
    font-size: 14px;
    color: #6c757d;
}
.noUi-connect {
    background: #0066cc;
}
.noUi-handle {
    border-radius: 50%;
    width: 20px !important;
    height: 20px !important;
    right: -10px !important;
    top: -5px !important;
    background: white;
    border: 1px solid #0066cc;
    box-shadow: 0 1px 5px rgba(0,0,0,0.2);
    cursor: grab;
}
.noUi-handle::before, .noUi-handle::after {
    display: none;
}
.version-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 30px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    border-radius: 8px;
    overflow: hidden;
    font-size: 13px;
}
.version-table th {
    background-color: #f8f9fa;
    padding: 10px 12px;
    text-align: left;
    font-weight: 600;
    font-size: 13px;
    color: #333;
    border-bottom: 2px solid #dee2e6;
    white-space: nowrap;
}
.version-table td {
    padding: 8px 12px;
    border-bottom: 1px solid #e9ecef;
    font-size: 13px;
}
.version-table tr:last-child td {
    border-bottom: none;
}
.version-table tr:hover {
    background-color: #f8f9fa;
}
.version-color {
    display: inline-block;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    margin-right: 6px;
    vertical-align: middle;
}
.version-name {
    font-weight: 600;
    vertical-align: middle;
}
.positive-change {
    color: #28a745;
}
.table-container {
    overflow-x: auto;
    margin-top: 30px;
}
.num-cell {
    text-align: right;
}`;

// Create the HTML content with the embedded chart
const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${pluginName} Download Statistics</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation"></script>
    <script src="https://cdn.jsdelivr.net/npm/nouislider@15.7.0/dist/nouislider.min.js"></script>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/nouislider@15.7.0/dist/nouislider.min.css">
    <link rel="stylesheet" href="${outputCssFile}">
</head>
<body>
    <div class="container">
        <h1>${pluginName} Download Statistics</h1>
        
        <div class="stats">
            <div class="stat-box">
                <div class="stat-value">${dataPoints.length}</div>
                <div class="stat-label">Data Points</div>
            </div>
            <div class="stat-box">
                <div class="stat-value">${versionReleases.length}</div>
                <div class="stat-label">Versions Released</div>
            </div>
            <div class="stat-box">
                <div class="stat-value">${downloadCounts[
                  downloadCounts.length - 1
                ].toLocaleString()}</div>
                <div class="stat-label">Latest Downloads</div>
            </div>
            <div class="stat-box">
                <div class="stat-value">${new Date(
                  dataPoints[0].date,
                ).toLocaleDateString()} - ${new Date(
  dataPoints[dataPoints.length - 1].date,
).toLocaleDateString()}</div>
                <div class="stat-label">Date Range</div>
            </div>
        </div>
        
        <div class="chart-container">
            <canvas id="downloadsChart"></canvas>
        </div>
        
        <div class="slider-container">
            <div id="time-slider"></div>
            <div class="time-display">
                <div id="time-start"></div>
                <div id="time-end"></div>
            </div>
        </div>
        
        <div class="table-container">
            <table class="version-table">
                <thead>
                    <tr>
                        <th>Version</th>
                        <th>Release Date</th>
                        <th class="num-cell">Downloads at Release</th>
                        <th class="num-cell">Download Change</th>
                        <th class="num-cell">Duration (Days)</th>
                        <th class="num-cell">Avg Daily Growth</th>
                    </tr>
                </thead>
                <tbody>
                    ${versionReleases
                      .map(
                        (v, i) => `
                    <tr>
                        <td>
                            <span class="version-color" style="background-color: ${
                              versionColors[i + (firstVersionIdx > 0 ? 1 : 0)]
                            }"></span>
                            <span class="version-name">v${v.version}</span>
                        </td>
                        <td>${new Date(v.date).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}</td>
                        <td class="num-cell">${v.downloads.toLocaleString()}</td>
                        <td class="num-cell ${
                          v.downloadChange > 0 ? "positive-change" : ""
                        }">${
                          v.downloadChange > 0 ? "+" : ""
                        }${v.downloadChange.toLocaleString()}</td>
                        <td class="num-cell">${v.durationDays}</td>
                        <td class="num-cell ${
                          v.avgDailyGrowth > 0 ? "positive-change" : ""
                        }">${
                          v.avgDailyGrowth > 0 ? "+" : ""
                        }${v.avgDailyGrowth.toLocaleString()}</td>
                    </tr>`,
                      )
                      .join("")}
                </tbody>
            </table>
        </div>
    </div>

    <script>
        // Plugin to draw a dotted line pattern
        const verticalLinePlugin = {
            id: 'verticalLine',
            afterDraw: (chart) => {
                if (chart.tooltip._active && chart.tooltip._active.length) {
                    const activePoint = chart.tooltip._active[0];
                    const { ctx } = chart;
                    const { x } = activePoint.element.getCenterPoint();
                    const topY = chart.scales.y.top;
                    const bottomY = chart.scales.y.bottom;
                    
                    // Draw line
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(x, topY);
                    ctx.lineTo(x, bottomY);
                    ctx.lineWidth = 1;
                    ctx.strokeStyle = '#aaaaaa';
                    ctx.setLineDash([3, 3]);
                    ctx.stroke();
                    ctx.restore();
                }
            }
        };
        
        // Chart data
        const dates = ${JSON.stringify(dates)};
        const downloads = ${JSON.stringify(downloadCounts)};
        const versionReleases = ${JSON.stringify(versionReleases)};
        const versionColors = ${JSON.stringify(versionColors)};
        const oldestDate = ${oldestDate};
        const newestDate = ${newestDate};
        const firstVersionIdx = ${firstVersionIdx};
        
        // Create annotations for version releases
        const annotations = versionReleases.map((release, index) => ({
            type: 'line',
            xMin: dates[release.index],
            xMax: dates[release.index],
            borderColor: versionColors[index + (firstVersionIdx > 0 ? 1 : 0)],
            borderWidth: 2,
            borderDash: [5, 5],
            label: {
                content: 'v' + release.version,
                enabled: true,
                position: 'top',
                backgroundColor: versionColors[index + (firstVersionIdx > 0 ? 1 : 0)],
                color: 'white',
                font: {
                    size: 10,
                }
            }
        }));
        
        // Initialize the chart
        const ctx = document.getElementById('downloadsChart').getContext('2d');
        let chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: dates,
                datasets: ${JSON.stringify(datasets)}
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        position: 'top',
                    },
                    title: {
                        display: true,
                        text: '${pluginName} Plugin Downloads Over Time',
                        font: {
                            size: 16
                        }
                    },
                    tooltip: {
                        callbacks: {
                            title: function(context) {
                                return new Date(context[0].label).toLocaleDateString('en-US', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric'
                                });
                            },
                            label: function(context) {
                                if (context.parsed.y === null) return;
                                return context.dataset.label + ': ' + (context.parsed.y || 0).toLocaleString() + ' downloads';
                            }
                        }
                    },
                    annotation: {
                        annotations: annotations
                    }
                },
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            unit: 'month',
                            tooltipFormat: 'MMM d, yyyy',
                            displayFormats: {
                                month: 'MMM yyyy'
                            }
                        },
                        title: {
                            display: true,
                            text: 'Date'
                        }
                    },
                    y: {
                        beginAtZero: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Total Downloads'
                        },
                        ticks: {
                            callback: function(value) {
                                return value.toLocaleString();
                            }
                        }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Growth Rate (downloads/day)'
                        },
                        grid: {
                            drawOnChartArea: false // Only display ticks, not grid lines
                        },
                        ticks: {
                            callback: function(value) {
                                return value.toLocaleString();
                            }
                        }
                    }
                }
            },
            plugins: [verticalLinePlugin]
        });
        
        // Initialize the time slider
        const slider = document.getElementById('time-slider');
        const timeStart = document.getElementById('time-start');
        const timeEnd = document.getElementById('time-end');
        
        noUiSlider.create(slider, {
            start: [oldestDate, newestDate],
            connect: true,
            step: 86400000, // 1 day in milliseconds
            range: {
                'min': oldestDate,
                'max': newestDate
            },
            format: {
                to: function (value) {
                    return Math.round(value);
                },
                from: function (value) {
                    return Math.round(value);
                }
            }
        });
        
        // Format the display of dates
        function formatDate(timestamp) {
            return new Date(timestamp).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        }
        
        // Update the time display
        function updateTimeDisplay(values) {
            timeStart.textContent = formatDate(values[0]);
            timeEnd.textContent = formatDate(values[1]);
        }
        
        // Initial display
        slider.noUiSlider.on('update', function (values) {
            updateTimeDisplay(values);
        });
        
        // Update chart when slider changes
        slider.noUiSlider.on('change', function (values) {
            const startDate = new Date(parseInt(values[0]));
            const endDate = new Date(parseInt(values[1]));
            
            // Update chart x-axis min and max
            chart.options.scales.x.min = startDate.toISOString();
            chart.options.scales.x.max = endDate.toISOString();
            chart.update();
        });
        
        // Reset zoom button
        function addResetZoomButton() {
            const resetButton = document.createElement('button');
            resetButton.textContent = 'Reset Zoom';
            resetButton.style.position = 'absolute';
            resetButton.style.top = '10px';
            resetButton.style.right = '10px';
            resetButton.style.padding = '5px 10px';
            resetButton.style.backgroundColor = '#f8f9fa';
            resetButton.style.border = '1px solid #dee2e6';
            resetButton.style.borderRadius = '4px';
            resetButton.style.cursor = 'pointer';
            resetButton.style.fontSize = '12px';
            
            resetButton.addEventListener('click', function() {
                // Reset the slider
                slider.noUiSlider.set([oldestDate, newestDate]);
                
                // Reset the chart
                chart.options.scales.x.min = undefined;
                chart.options.scales.x.max = undefined;
                chart.update();
            });
            
            document.querySelector('.chart-container').appendChild(resetButton);
        }
        
        // Add reset button after chart initialization
        addResetZoomButton();
    </script>
</body>
</html>`;

// Write the CSS and HTML files
console.log(`Writing chart to ${outputHtmlFile}...`);
fs.writeFileSync(outputCssFile, cssContent);
fs.writeFileSync(outputHtmlFile, htmlContent);

console.log(`Done! Open ${outputHtmlFile} in your browser to view the chart.`);
