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
      findScenes(scene_filter: $scene_filter) {
        count
        scenes {
          id
          title
          rating100
          o_counter
          created_at
          updated_at
          last_played_at
          play_count
          date
          tags { id, name }
          performers { id, name }
          studio { id, name }
        }
      }
    }
  `;

  const IMAGE_QUERY = `
    query FindImagesWithOCount($image_filter: ImageFilterType) {
      findImages(image_filter: $image_filter) {
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
        }
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
        if (item.o_counter === null || item.o_counter === undefined) continue; // Skip items without o_counter
        const oCount = item.o_counter;

        let dateLabel = "Unknown";
        if (item.date) {
          try {
            const date = new Date(item.date);
            // Group by year
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
      "y",
    );
  };

  const drawOcountByDateChart = (items) => {
    const ocountData = StatsCalculator.getOcountByDate(items);
    drawBarChart(
      "ocountByDateChart",
      ocountData.map((d) => d[0]),
      ocountData.map((d) => d[1]),
      "Total O-Count",
      "O-Count by year of media",
      "rgba(75, 192, 192, 0.5)",
      "rgba(75, 192, 192, 1)",
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
    console.log(`Found ${sceneData.findScenes.count} scenes`);

    console.log("Fetching images with O-count > 0...");
    const imageData = await performGraphQLQuery(
      IMAGE_QUERY,
      IMAGE_FILTER_VARIABLES,
    );
    console.log(`Found ${imageData.findImages.count} images`);

    const allItems = [
      ...sceneData.findScenes.scenes,
      ...imageData.findImages.images,
    ];

    console.log("OCount Statistics: Data fetched and combined.");
    return allItems;
  };

  // ====================
  // Stats Section Render
  // ====================
  const HEADER = '<h2 style="text-align: center;">O-Count Statistics</h2>';
  const renderOcountStatsSection = async (targetElement) => {
    let statsContainer = targetElement.querySelector("#ocount-stats-section");
    if (statsContainer) {
      statsContainer.innerHTML = HEADER + "<p>Loading statistics...</p>";
    } else {
      statsContainer = document.createElement("div");
      statsContainer.id = "ocount-stats-section";
      // Add some styling for better integration with Stash's UI
      statsContainer.style.backgroundColor = "#1e1e1e";
      statsContainer.style.padding = "20px";
      statsContainer.style.borderRadius = "8px";
      statsContainer.style.marginTop = "20px";
      statsContainer.style.boxShadow = "0 0 10px rgba(0,0,0,0.3)";
      targetElement.appendChild(statsContainer);
      statsContainer.innerHTML = HEADER + "<p>Loading statistics...</p>";
    }

    try {
      const allItems = await fetchAndProcessOcountData(); // Fetch data here

      console.log("Calculating and rendering statistics...");
      let outputHTML = `
        <div>
          ${HEADER}
          <div class="row">
            <div class="col-md-6 mb-3">
                <div style="position: relative; height:400px"><canvas id="oCountByTagsChart"></canvas></div>
            </div>
            <div class="col-md-6 mb-3">
                <div style="position: relative; height:400px"><canvas id="ocountByDateChart"></canvas></div>
            </div>
          </div>
        </div>
      `;
      statsContainer.innerHTML = outputHTML;

      drawOcountByTags(allItems);
      drawOcountByDateChart(allItems);
    } catch (e) {
      statsContainer.innerHTML = `<h2 style="color: red;">Error loading statistics:</h2><p>${e.message}</p>`;
      console.error(e);
    }
  };

  // =======================
  // Main Plugin Entry Point
  // =======================
  // Use csLib.PathElementListener to trigger rendering
  if (typeof csLib !== "undefined" && csLib.PathElementListener) {
    csLib.PathElementListener(
      "/stats",
      "div.container-fluid div.mt-5", // Target element provided by user
      renderOcountStatsSection, // Renamed function
    );
  } else {
    console.warn(
      "CommunityScriptsUILibrary (csLib) not found or PathElementListener is missing. Cannot register stats page listener. Attempting direct render if on /stats.",
    );
    // Fallback: simple check if csLib is not available or if the page is already /stats on load
    if (window.location.pathname === "/stats") {
      console.log(
        "OCount Statistics Plugin: csLib not found, attempting direct render on /stats.",
      );
      const targetElement = document.querySelector(
        "div.container-fluid div.mt-5",
      );
      if (targetElement) {
        renderOcountStatsSection(targetElement); // Renamed function
      } else {
        console.warn(
          "OCount Statistics Plugin: Target element 'div.container-fluid div.mt-5' not found for direct render.",
        );
      }
    }
  }

  console.log("OCount Statistics Plugin fully initialized");
})();
