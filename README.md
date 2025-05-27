# Obsidian Plugin Download Statistics Generator

This project provides two scripts to extract historical download data for an Obsidian community plugin and generate an interactive HTML chart to visualize its download trends.

## Prerequisites

- Node.js (which includes npm for installing packages if you decide to manage dependencies, though these scripts are self-contained for core functionality).
- Git installed and configured in your system PATH.

## How to Use

1.  **Clone the Obsidian Releases Repository:**

    First, you need a local copy of the `obsidianmd/obsidian-releases` repository. This repository contains the `community-plugin-stats.json` file, which is the source of the download data.

    ```bash
    git clone https://github.com/obsidianmd/obsidian-releases.git
    ```

2.  **Navigate to the Repository Folder:**

    ```bash
    cd obsidian-releases
    ```

3.  **Place the Scripts:**

    Copy the `extract-plugin-stats.js` and `generate-download-chart.js` scripts into the root of your cloned `obsidian-releases` directory.

4.  **Extract Plugin Statistics:**

    Run the `extract-plugin-stats.js` script from the root of the `obsidian-releases` directory. You need to provide the **exact name of your plugin** as it appears in the `community-plugins.json` or `community-plugin-stats.json` files (this is usually the `name` field from your plugin's `manifest.json`).

    Replace `"Your Plugin Name"` with your actual plugin's name.

    ```bash
    node extract-plugin-stats.js "Your Plugin Name"
    ```

    This script will iterate through the Git history of `community-plugin-stats.json`, extract the download counts for your plugin at each relevant commit, and save it into a new file named `your-plugin-name-history.json` (e.g., `my-cool-plugin-history.json`). It also filters out anomalous data points where download counts might temporarily decrease due to data inconsistencies.

5.  **Generate the Download Chart:**

    Once the history file is generated, run the `generate-download-chart.js` script, again providing your plugin's name:

    ```bash
    node generate-download-chart.js "Your Plugin Name"
    ```

    This will read the `your-plugin-name-history.json` file and generate two files:

    - `your-plugin-name-downloads-chart.html`: An interactive HTML page with the download chart.
    - `your-plugin-name-downloads-chart.css`: The stylesheet for the HTML page.

6.  **View the Chart:**

    Open the generated `your-plugin-name-downloads-chart.html` file in your web browser.

## Understanding the Chart

The generated HTML page will display several pieces of information:

- **Overall Download Trends:** A line chart showing the total number of downloads for your plugin over time. The line is color-coded by plugin version, making it easy to see the impact of new releases.
- **Daily Download Rate:** A line showing the calculated daily increase in downloads.
- **Rolling Averages for Daily Downloads:**
  - A 7-day rolling average of the daily download rate, providing a smoother view of recent trends.
  - A 30-day rolling average of the daily download rate, offering a broader perspective on growth.
- **Interactive Time Slider:** Below the chart, a slider allows you to zoom into specific periods of your plugin's release timeline for closer inspection.
- **Version Statistics Table:** A table detailing each version release, including:
  - Version number
  - Release date
  - Total downloads at the time of release
  - Change in downloads during that version's active period
  - Duration the version was the latest (in days)
  - Average daily growth during that version's period.
    The script attempts to filter out pre-releases (e.g., versions ending in "-beta") from being primary markers if a full release follows closely, focusing on the impact of stable versions.
- **Version Release Annotations:** Vertical lines on the chart mark the release dates of new versions.

This visualization can help you understand how your plugin's downloads have evolved, identify trends, and see the impact of new version releases.

## Troubleshooting

- **Plugin Not Found:** If the `extract-plugin-stats.js` script reports "Plugin not found," double-check that the plugin name you provided exactly matches the name in the Obsidian community plugin statistics. It is case-sensitive.
- **No Data / Empty Chart:** Ensure the `obsidianmd/obsidian-releases` repository is up to date (`git pull`) and that your plugin has been listed in the community plugins for a period covered by the repository's history.
- **Script Errors:** Ensure you are running the scripts with Node.js (e.g., `node extract-plugin-stats.js ...`).

## Disclaimer and Contributions

These scripts are provided as-is and are not heavily optimized. They were developed primarily with AI assistance to quickly achieve the desired functionality.

Contributions for improvements, optimizations, or new features are very welcome! Please feel free to submit issues or pull requests.

This work is heavily inspired by the data visualization and plugin statistics provided by the team behind [System3 Observatory](https://system3.md/observatory) and their Relay Obsidian Community Plugin.
