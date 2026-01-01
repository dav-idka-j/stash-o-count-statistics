# StashGraphs StashApp Plugin

This repository contains the **StashGraphs** plugin for the organizer [Stash](https://stashapp.cc/). It provides generic charting functions for other plugins to use.

This plugin utilizes [Chart.js](https://www.chartjs.org) for rendering charts.

## API and Usage

This plugin exposes several functions on the `window.stashGraphs` object for other plugins to use.

### `drawBarChart(canvasId, labels, data, chartLabel, chartTitle, backgroundColor, borderColor, indexAxis)`

Renders a bar chart.

**Example:**

To use this library, first ensure your plugin has a dependency on `StashGraphs` in its `.yml` file.

```yaml
# my_plugin.yml
name: My Plugin
version: "1.0.0"
ui:
  requires:
    - StashGraphs
  javascript:
    - my_plugin.js
```

Then, in your plugin's JavaScript, you can call the charting function once the DOM is ready.

```javascript
// my_plugin.js
(function () {
    'use strict';

    if (!window.stashGraphs) {
        console.error('StashGraphs library not found');
        return;
    }

    // 1. Create a canvas element in your plugin's HTML
    const canvas = document.createElement('canvas');
    canvas.id = 'my-bar-chart';
    document.body.appendChild(canvas); // Append it wherever you need it

    // 2. Prepare your data
    const labels = ['January', 'February', 'March', 'April', 'May'];
    const data = [65, 59, 80, 81, 56];
    const chartTitle = 'Monthly Activity';
    const chartLabel = 'Activity Count';
    const backgroundColor = 'rgba(255, 99, 132, 0.2)';
    const borderColor = 'rgba(255, 99, 132, 1)';

    // 3. Call the function to draw the chart
    window.stashGraphs.drawBarChart(
        'my-bar-chart',
        labels,
        data,
        chartLabel,
        chartTitle,
        backgroundColor,
        borderColor
    );

})();
```

Other available functions include:
- `drawPieChart(...)`
- `drawScatterChart(...)`
- `drawRadarChart(...)`

Please refer to `StashGraphs.js` for their specific parameters.
