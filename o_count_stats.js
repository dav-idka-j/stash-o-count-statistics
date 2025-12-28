(async function () {
  "use strict";
  if (window.stashOCountStatsPluginLoaded) {
    console.log("OCount Statistics Plugin is already loaded");
    return;
  }
  window.stashOCountStatsPluginLoaded = true;

  console.log("OCount Statistics Plugin started");

  // =======
  // GraphQL
  // =======
  const performGraphQLQuery = async (query, variables = {}) => {
    const response = await fetch("/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(
        `GraphQL query failed with status ${response.status}: ${responseText}`,
      );
    }

    const json = await response.json();
    if (json.errors) {
      console.error("GraphQL Errors:", json.errors);
      throw new Error(`GraphQL query failed: ${JSON.stringify(json.errors)}`);
    }

    return json.data;
  };

  const SCENE_QUERY = `
    query FindScenesWithOCount($scene_filter: SceneFilterType) {
      findScenes(filter: {per_page: -1}, scene_filter: $scene_filter) {
        count
        scenes {
          id
          title
          rating100
          o_counter
          created_at
          updated_at
          play_duration
          last_played_at
          play_count
          date
          tags { id, name }
          performers { id, name }
          studio { id, name }
          files { path }
        }
      }
    }
  `;

  const IMAGE_QUERY = `
    query FindImagesWithOCount($image_filter: ImageFilterType) {
      findImages(filter: {per_page: -1}, image_filter: $image_filter) {
        count
        images {
          id
          title
          rating100
          o_counter
          created_at
          updated_at
          date
          tags { id, name }
          performers { id, name }
          studio { id, name }
          files { path }
        }
      }
    }
  `;

  const TOTAL_SCENE_COUNT_QUERY = `
    query FindScenesCount {
      findScenes {
        count
      }
    }
  `;

  const TOTAL_IMAGE_COUNT_QUERY = `
    query FindImagesCount {
      findImages {
        count
      }
    }
  `;

  const PLUGIN_SETTINGS_QUERY = `
    query GetOCountStatsConfiguration {
      configuration {
        plugins(include: "o_count_stats")
      }
    }
  `;

  const COMMON_FILTER_VARABLES = {
    o_counter: {
      value: 0,
      modifier: "GREATER_THAN",
    },
  };

  const SCENE_FILTER_VARIABLES = {
    scene_filter: {
      ...COMMON_FILTER_VARABLES,
    },
  };

  const IMAGE_FILTER_VARIABLES = {
    image_filter: {
      ...COMMON_FILTER_VARABLES,
    },
  };

  // ===============
  // Data Processing
  // ===============
  const StatsCalculator = {
    getOCountByTags(items, limit = 10) {
      const tagCounts = new Map();
      for (const item of items) {
        if (!item.tags) continue;
        for (const tag of item.tags) {
          tagCounts.set(tag.name, (tagCounts.get(tag.name) || 0) + 1);
        }
      }
      return [...tagCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit);
    },

    getOcountByDate(items) {
      const ocountByDate = new Map();

      for (const item of items) {
        if (item.o_counter === null || item.o_counter === undefined) {
          continue;
        }
        const oCount = item.o_counter;

        let dateLabel = "Unknown";
        if (item.date) {
          try {
            const date = new Date(item.date);
            dateLabel = `${date.getFullYear()}`;
          } catch (e) {
            console.warn(
              `Failed to parse date for item ${item.id}: ${item.date}`,
              e,
            );
          }
        }
        ocountByDate.set(
          dateLabel,
          (ocountByDate.get(dateLabel) || 0) + oCount,
        );
      }

      // Sort chronologically for better bar chart presentation
      return [...ocountByDate.entries()].sort((a, b) => {
        if (a[0] === "Unknown") return 1; // "Unknown" always last
        if (b[0] === "Unknown") return -1;
        return a[0].localeCompare(b[0]);
      });
    },

    getOcountByPerformer(items, limit = 15) {
      const performerCounts = new Map();
      for (const item of items) {
        if (
          !item.performers ||
          item.o_counter === null ||
          item.o_counter === undefined
        ) {
          continue;
        }
        for (const performer of item.performers) {
          performerCounts.set(
            performer.name,
            (performerCounts.get(performer.name) || 0) + item.o_counter,
          );
        }
      }
      return [...performerCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit);
    },

    getOcountByStudio(items, limit = 15) {
      const studioCounts = new Map();
      for (const item of items) {
        if (
          !item.studio ||
          item.o_counter === null ||
          item.o_counter === undefined
        )
          continue;
        studioCounts.set(
          item.studio.name,
          (studioCounts.get(item.studio.name) || 0) + item.o_counter,
        );
      }
      return [...studioCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit);
    },

    getOcountAndPlayCount(items) {
      const data = [];
      for (const item of items) {
        if (
          item.play_count !== undefined &&
          item.o_counter !== null &&
          item.o_counter !== undefined
        ) {
          data.push({
            x: item.play_count,
            y: item.o_counter,
            title: item.title,
          });
        }
      }
      return data;
    },

    getOcountAndPlayDuration(items) {
      const data = [];
      for (const item of items) {
        if (
          item.play_duration !== undefined &&
          item.play_duration !== null &&
          item.o_counter !== null &&
          item.o_counter !== undefined
        ) {
          data.push({
            x: item.play_duration,
            y: item.o_counter,
            title: item.title,
          });
        }
      }
      return data;
    },

    getTopOcountItems(items, limit = 15) {
      return items
        .filter(
          (item) =>
            item.o_counter !== null &&
            item.o_counter !== undefined &&
            item.o_counter > 0,
        )
        .sort((a, b) => b.o_counter - a.o_counter)
        .slice(0, limit)
        .map((item) => ({
          title:
            item.title ||
            (item.files && item.files[0] && item.files[0].path
              ? item.files[0].path.split("/").pop()
              : item.id),
          o_counter: item.o_counter,
        }));
    },

    getOcountDistribution(items, totalSceneCount, totalImageCount) {
      const scenesWithOcount = items.filter((item) =>
        item.hasOwnProperty("play_count"),
      ).length;
      const imagesWithOcount = items.filter(
        (item) => !item.hasOwnProperty("play_count"),
      ).length;

      return {
        scenes: {
          withOcount: scenesWithOcount,
          withoutOcount: totalSceneCount - scenesWithOcount,
        },
        images: {
          withOcount: imagesWithOcount,
          withoutOcount: totalImageCount - imagesWithOcount,
        },
      };
    },
  };

  // ===============
  // Graph Rendering
  // ===============
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
                                     <p>Please ensure Chart.js is correctly loaded in sessions.yml.</p>`;
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
                                     <p>Please ensure Chart.js is correctly loaded in sessions.yml.</p>`;
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

  const drawScatterChart = (canvasId, data, xLabel, yLabel, chartTitle) => {
    const ctx = document.getElementById(canvasId);

    if (typeof Chart === "undefined") {
      if (ctx && ctx.parentNode) {
        ctx.parentNode.innerHTML = `<p style="color: yellow;">Chart.js library not found.</p>
                                     <p>Please ensure Chart.js is correctly loaded in sessions.yml.</p>`;
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

  const drawOcountByTags = (items) => {
    const oCountByTags = StatsCalculator.getOCountByTags(items, 15);
    drawBarChart(
      "oCountByTagsChart",
      oCountByTags.map((t) => t[0]),
      oCountByTags.map((t) => t[1]),
      "Tag Count",
      "O-Count by Tag",
      "rgba(54, 162, 235, 0.5)",
      "rgba(54, 162, 235, 1)",
      "y", // Tag names could be long, so horizontal bars are better
    );
  };

  const drawOcountByDateChart = (items) => {
    const ocountData = StatsCalculator.getOcountByDate(items);
    drawBarChart(
      "ocountByDateChart",
      ocountData.map((d) => d[0]),
      ocountData.map((d) => d[1]),
      "Total O-Count",
      "O-Count by Year of Media",
      "rgba(75, 192, 192, 0.5)",
      "rgba(75, 192, 192, 1)",
    );
  };

  const drawOcountByPerformerChart = (items) => {
    const ocountByPerformers = StatsCalculator.getOcountByPerformer(items, 15);
    drawBarChart(
      "ocountByPerformerChart",
      ocountByPerformers.map((p) => p[0]),
      ocountByPerformers.map((p) => p[1]),
      "Performer O-Count",
      "O-Count by Performer",
      "rgba(153, 102, 255, 0.5)",
      "rgba(153, 102, 255, 1)",
    );
  };

  const drawOcountByStudioChart = (items) => {
    const ocountByStudios = StatsCalculator.getOcountByStudio(items, 15);
    drawBarChart(
      "ocountByStudioChart",
      ocountByStudios.map((s) => s[0]),
      ocountByStudios.map((s) => s[1]),
      "Studio O-Count",
      "O-Count by Studio",
      "rgba(255, 159, 64, 0.5)",
      "rgba(255, 159, 64, 1)",
      "y", // Studio names could be longer, so horizontal bars are better
    );
  };

  const drawOcountPlayCountScatter = (items) => {
    const data = StatsCalculator.getOcountAndPlayCount(items);
    drawScatterChart(
      "ocountPlayCountScatter",
      data,
      "Play Count",
      "O-Count",
      "O-Count vs. Play Count",
    );
  };

  const drawOcountPlayDurationScatter = (items) => {
    const data = StatsCalculator.getOcountAndPlayDuration(items);
    drawScatterChart(
      "ocountPlayDurationScatter",
      data,
      "Play Duration (seconds)",
      "O-Count",
      "O-Count vs. Play Duration",
    );
  };

  const drawTopOcountItemsChart = (items) => {
    const topItems = StatsCalculator.getTopOcountItems(items, 15);
    drawBarChart(
      "topOcountItemsChart",
      topItems.map((item) => item.title),
      topItems.map((item) => item.o_counter),
      "O-Count",
      "Top 15 O-Count Items",
      "rgba(255, 99, 132, 0.5)",
      "rgba(255, 99, 132, 1)",
      "y", // Item titles can be long, so horizontal bars are better
    );
  };

  const drawSceneOcountDistributionChart = (
    items,
    totalSceneCount,
    totalImageCount,
  ) => {
    const distribution = StatsCalculator.getOcountDistribution(
      items,
      totalSceneCount,
      totalImageCount,
    );
    drawPieChart(
      "sceneOcountDistributionChart",
      ["With O-Count", "Without O-Count"],
      [distribution.scenes.withOcount, distribution.scenes.withoutOcount],
      "Scene O-Count Distribution",
      ["rgba(75, 192, 192, 0.5)", "rgba(255, 99, 132, 0.5)"],
    );
  };

  const drawImageOcountDistributionChart = (
    items,
    totalSceneCount,
    totalImageCount,
  ) => {
    const distribution = StatsCalculator.getOcountDistribution(
      items,
      totalSceneCount,
      totalImageCount,
    );
    drawPieChart(
      "imageOcountDistributionChart",
      ["With O-Count", "Without O-Count"],
      [distribution.images.withOcount, distribution.images.withoutOcount],
      "Image O-Count Distribution",
      ["rgba(54, 162, 235, 0.5)", "rgba(255, 206, 86, 0.5)"],
    );
  };

  // ====================
  // Data Fetch & Process
  // ====================
  const fetchAndProcessOcountData = async () => {
    console.log("Fetching scenes with O-count > 0...");
    const sceneData = await performGraphQLQuery(
      SCENE_QUERY,
      SCENE_FILTER_VARIABLES,
    );
    const oCountScenes = sceneData.findScenes.scenes;
    console.log(`Found ${oCountScenes.length} scenes with O-count > 0`);

    console.log("Fetching images with O-count > 0...");
    const imageData = await performGraphQLQuery(
      IMAGE_QUERY,
      IMAGE_FILTER_VARIABLES,
    );
    const oCountImages = imageData.findImages.images;
    console.log(`Found ${oCountImages.length} images with O-count > 0`);

    console.log("Fetching total scene count...");
    const totalSceneData = await performGraphQLQuery(TOTAL_SCENE_COUNT_QUERY);
    const totalSceneCount = totalSceneData.findScenes.count;
    console.log(`Total scenes: ${totalSceneCount}`);

    console.log("Fetching total image count...");
    const totalImageData = await performGraphQLQuery(TOTAL_IMAGE_COUNT_QUERY);
    const totalImageCount = totalImageData.findImages.count;
    console.log(`Total images: ${totalImageCount}`);

    const allItems = [...oCountScenes, ...oCountImages];

    console.log("OCount Statistics: Data fetched and combined.");
    return { allItems, totalSceneCount, totalImageCount };
  };

  const fetchSettingsAndProcessOcountData = async () => {
    console.log("Fetching plugin settings...");
    const pluginData = await performGraphQLQuery(PLUGIN_SETTINGS_QUERY);

    console.log("PluginData: ", pluginData);

    let pluginSettings = {};
    if (pluginData?.configuration?.plugins?.o_count_stats) {
      try {
        pluginSettings = pluginData.configuration.plugins.o_count_stats;
        console.log("Plugin settings fetched:", pluginSettings);
      } catch (e) {
        console.error("Failed to parse plugin settings:", e);
      }
    } else {
      console.log("No config for O Count Statistics yet");
    }

    const { allItems, totalSceneCount, totalImageCount } =
      await fetchAndProcessOcountData();
    return { allItems, totalSceneCount, totalImageCount, pluginSettings };
  };

  // ====================
  // Stats Section Render
  // ====================
  const HEADER =
    '<h2 style="text-align: center;">O-Count Statistics Dashboard</h2>';
  const renderOcountStatsSection = async (targetElement) => {
    let statsContainer = targetElement.querySelector("#ocount-stats-section");
    if (statsContainer) {
      statsContainer.innerHTML = HEADER + "<p>Loading statistics...</p>";
    } else {
      statsContainer = document.createElement("div");
      statsContainer.id = "ocount-stats-section";
      statsContainer.style.backgroundColor = "#1e1e1e";
      statsContainer.style.padding = "20px";
      statsContainer.style.borderRadius = "8px";
      statsContainer.style.marginTop = "20px";
      statsContainer.style.boxShadow = "0 0 10px rgba(0,0,0,0.3)";
      targetElement.appendChild(statsContainer);
      statsContainer.innerHTML = HEADER + "<p>Loading statistics...</p>";
    }

    function addWideGraphDiv(id) {
      return `<div class="col-md-6 mb-3">
        <div style="position: relative; height:400px"><canvas id="${id}"></canvas></div>
      </div>
      `;
    }

    function addNarrowGraphDiv(id) {
      return `<div class="col-md-3 mb-3">
        <div style="position: relative; height:400px"><canvas id="${id}"></canvas></div>
      </div>
      `;
    }

    try {
      const { allItems, totalSceneCount, totalImageCount, pluginSettings } =
        await fetchSettingsAndProcessOcountData();

      const areAnyChartsEnabled = Object.values(pluginSettings).some(
        (setting) => setting,
      );

      if (!areAnyChartsEnabled) {
        statsContainer.innerHTML =
          HEADER +
          '<p style="text-align: center;">No O-Count charts are enabled in the plugin settings.</p>';
        console.log("No O-Count statistics charts enabled.");
        return;
      }

      console.log("Calculating and rendering statistics...");
      let outputHTML = `<div>
          ${HEADER}
          <div class="row">`;

      if (pluginSettings.enable_ocountByTagsChart) {
        outputHTML += addWideGraphDiv("oCountByTagsChart");
      }
      if (pluginSettings.enable_ocountByDateChart) {
        outputHTML += addWideGraphDiv("ocountByDateChart");
      }
      if (pluginSettings.enable_ocountByPerformerChart) {
        outputHTML += addWideGraphDiv("ocountByPerformerChart");
      }
      if (pluginSettings.enable_ocountByStudioChart) {
        outputHTML += addWideGraphDiv("ocountByStudioChart");
      }
      if (pluginSettings.enable_ocountPlayCountScatter) {
        outputHTML += addWideGraphDiv("ocountPlayCountScatter");
      }
      if (pluginSettings.enable_ocountPlayDurationScatter) {
        outputHTML += addWideGraphDiv("ocountPlayDurationScatter");
      }
      if (pluginSettings.enable_topOcountItemsChart) {
        outputHTML += addWideGraphDiv("topOcountItemsChart");
      }
      if (pluginSettings.enable_sceneOcountDistributionChart) {
        outputHTML += addNarrowGraphDiv("sceneOcountDistributionChart");
      }
      if (pluginSettings.enable_imageOcountDistributionChart) {
        outputHTML += addNarrowGraphDiv("imageOcountDistributionChart");
      }
      outputHTML += `</div></div>`;
      statsContainer.innerHTML = outputHTML;

      if (pluginSettings.enable_ocountByTagsChart) {
        drawOcountByTags(allItems);
      }
      if (pluginSettings.enable_ocountByDateChart) {
        drawOcountByDateChart(allItems);
      }
      if (pluginSettings.enable_ocountByPerformerChart) {
        drawOcountByPerformerChart(allItems);
      }
      if (pluginSettings.enable_ocountByStudioChart) {
        drawOcountByStudioChart(allItems);
      }
      if (pluginSettings.enable_ocountPlayCountScatter) {
        drawOcountPlayCountScatter(allItems);
      }
      if (pluginSettings.enable_ocountPlayDurationScatter) {
        drawOcountPlayDurationScatter(allItems);
      }
      if (pluginSettings.enable_topOcountItemsChart) {
        drawTopOcountItemsChart(allItems);
      }
      if (pluginSettings.enable_sceneOcountDistributionChart) {
        drawSceneOcountDistributionChart(
          allItems,
          totalSceneCount,
          totalImageCount,
        );
      }
      if (pluginSettings.enable_imageOcountDistributionChart) {
        drawImageOcountDistributionChart(
          allItems,
          totalSceneCount,
          totalImageCount,
        );
      }
    } catch (e) {
      statsContainer.innerHTML = `<h2 style="color: red;">Error loading statistics:</h2><p>${e.message}</p>`;
      console.error(e);
    }
  };

  // =======================
  // Main Plugin Entry Point
  // =======================
  if (typeof csLib !== "undefined" && csLib.PathElementListener) {
    csLib.PathElementListener(
      "/stats",
      "div.container-fluid div.mt-5",
      renderOcountStatsSection,
    );
  } else {
    console.error(
      "CommunityScriptsUILibrary (csLib) not found or PathElementListener is missing. Cannot register stats page listener. Attempting direct render if on /stats.",
    );
  }

  console.log("OCount Statistics Plugin fully initialized");
})();
