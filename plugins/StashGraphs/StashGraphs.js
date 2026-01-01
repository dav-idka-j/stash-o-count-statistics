(function () {
  "use strict";
  if (window.stashGraphs) {
    console.log("StashGraphs plugin is already loaded");
    return;
  }
  window.stashGraphs = {};
  console.log("StashGraphs plugin started");

  const drawBarChart = (
    canvasId,
    labels,
    data,
    chartLabel,
    chartTitle,
    backgroundColor,
    borderColor,
    indexAxis = "x",
  ) => {
    const ctx = document.getElementById(canvasId);

    if (typeof Chart === "undefined") {
      if (ctx && ctx.parentNode) {
        ctx.parentNode.innerHTML = `<p style="color: yellow;">Chart.js library not found.</p>
                                     <p>Please ensure Chart.js is correctly loaded in StashGraphs.yml.</p>`;
      }
      console.error(
        `Chart.js is not loaded. Cannot draw chart for ${chartTitle}.`,
      );
      return;
    }

    if (!ctx) return;

    if (ctx.chart) {
      ctx.chart.destroy();
    }

    const scales = {
      x: {
        ticks: { color: "#ccc" },
        grid: { color: "rgba(255,255,255,0.1)" },
        beginAtZero: indexAxis === "x",
      },
      y: {
        ticks: { color: "#ccc" },
        grid: { color: "rgba(255,255,255,0.1)" },
        beginAtZero: indexAxis === "y",
      },
    };

    ctx.chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: chartLabel,
            data: data,
            backgroundColor: backgroundColor,
            borderColor: borderColor,
            borderWidth: 1,
          },
        ],
      },
      options: {
        indexAxis: indexAxis,
        scales: scales,
        plugins: {
          legend: {
            display: false,
          },
          title: {
            text: chartTitle,
            display: true,
            color: "#ccc",
          },
        },
      },
    });
  };
  window.stashGraphs.drawBarChart = drawBarChart;

  const drawPieChart = (
    canvasId,
    labels,
    data,
    chartTitle,
    backgroundColors,
  ) => {
    const ctx = document.getElementById(canvasId);

    if (typeof Chart === "undefined") {
      if (ctx && ctx.parentNode) {
        ctx.parentNode.innerHTML = `<p style="color: yellow;">Chart.js library not found.</p>
                                     <p>Please ensure Chart.js is correctly loaded in StashGraphs.yml.</p>`;
      }
      console.error(
        `Chart.js is not loaded. Cannot draw chart for ${chartTitle}.`,
      );
      return;
    }

    if (!ctx) return;

    if (ctx.chart) {
      ctx.chart.destroy();
    }

    ctx.chart = new Chart(ctx, {
      type: "pie",
      data: {
        labels: labels,
        datasets: [
          {
            data: data,
            backgroundColor: backgroundColors,
            hoverOffset: 4,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: "top",
            labels: {
              color: "#ccc",
            },
          },
          title: {
            display: true,
            text: chartTitle,
            color: "#ccc",
          },
        },
      },
    });
  };
  window.stashGraphs.drawPieChart = drawPieChart;

  const drawScatterChart = (canvasId, data, xLabel, yLabel, chartTitle) => {
    const ctx = document.getElementById(canvasId);

    if (typeof Chart === "undefined") {
      if (ctx && ctx.parentNode) {
        ctx.parentNode.innerHTML = `<p style="color: yellow;">Chart.js library not found.</p>
                                     <p>Please ensure Chart.js is correctly loaded in StashGraphs.yml.</p>`;
      }
      console.error(
        `Chart.js is not loaded. Cannot draw chart for ${chartTitle}.`,
      );
      return;
    }

    if (!ctx) return;

    if (ctx.chart) {
      ctx.chart.destroy();
    }

    ctx.chart = new Chart(ctx, {
      type: "scatter",
      data: {
        datasets: [
          {
            label: "Data Points",
            data: data,
            backgroundColor: "rgba(255, 99, 132, 0.5)",
          },
        ],
      },
      options: {
        responsive: true,
        scales: {
          x: {
            type: "linear",
            position: "bottom",
            title: {
              display: true,
              text: xLabel,
              color: "#ccc",
            },
            ticks: { color: "#ccc" },
            grid: { color: "rgba(255,255,255,0.1)" },
          },
          y: {
            type: "linear",
            position: "left",
            title: {
              display: true,
              text: yLabel,
              color: "#ccc",
            },
            ticks: { color: "#ccc" },
            grid: { color: "rgba(255,255,255,0.1)" },
          },
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: function (context) {
                return `${context.raw.title} (X: ${context.raw.x}, Y: ${context.raw.y})`;
              },
            },
          },
          legend: {
            display: false,
          },
          title: {
            display: true,
            text: chartTitle,
            color: "#ccc",
          },
        },
      },
    });
  };
  window.stashGraphs.drawScatterChart = drawScatterChart;

  const drawRadarChart = (canvasId, labels, datasets, chartTitle) => {
    const ctx = document.getElementById(canvasId);

    if (typeof Chart === "undefined") {
      if (ctx && ctx.parentNode) {
        ctx.parentNode.innerHTML = `<p style="color: yellow;">Chart.js library not found.</p>
                                     <p>Please ensure Chart.js is correctly loaded in StashGraphs.yml.</p>`;
      }
      console.error(
        `Chart.js is not loaded. Cannot draw chart for ${chartTitle}.`,
      );
      return;
    }

    if (!ctx) return;

    if (ctx.chart) {
      ctx.chart.destroy();
    }

    ctx.chart = new Chart(ctx, {
      type: "radar",
      data: {
        labels: labels,
        datasets: datasets,
      },
      options: {
        responsive: true,
        plugins: {
          title: {
            display: true,
            text: chartTitle,
            color: "#ccc",
          },
          legend: {
            labels: {
              color: "#ccc",
            },
          },
        },
        scales: {
          r: {
            angleLines: { color: "rgba(255, 255, 255, 0.2)" },
            grid: { color: "rgba(255, 255, 255, 0.2)" },
            pointLabels: { color: "#ccc" },
            ticks: { color: "#ccc", backdropColor: "transparent" },
          },
        },
      },
    });
  };
  window.stashGraphs.drawRadarChart = drawRadarChart;
})();
