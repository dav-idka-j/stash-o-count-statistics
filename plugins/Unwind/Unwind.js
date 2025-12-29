(async function () {
  "use strict";

  if (window.stashUnwindPluginLoaded) {
    console.log("Unwind Plugin is already loaded");
    return;
  }
  window.stashUnwindPluginLoaded = true;
  console.log("Unwind Plugin started");

  // =================
  // GraphQL Queries
  // =================
  const performGraphQLQuery = async (query, variables = {}) => {
    const response = await fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

  const HISTORY_QUERY = `
    query UnwindHistory($scene_filter: SceneFilterType!) {
      findScenes(filter: {per_page: -1}, scene_filter: $scene_filter) {
        scenes { o_history play_history }
      }
    }
  `;

  const UNWIND_ITEMS_QUERY = `
    query UnwindItems($scene_filter: SceneFilterType, $image_filter: ImageFilterType) {
        findScenes(filter: {per_page: -1}, scene_filter: $scene_filter) {
            scenes { __typename id title created_at o_history play_history performers { id name } tags { id name } paths { screenshot } }
        }
        findImages(filter: {per_page: -1}, image_filter: $image_filter) {
            images { __typename id id title created_at o_counter paths { thumbnail } }
        }
    }
  `;

  const PERFORMERS_IMAGES_QUERY = `
    query PerformersImages($performer_ids: [ID!]) {
      findPerformers(ids: $performer_ids) {
        performers {
          id
          image_path
        }
      }
    }
  `;

  // =================
  // Data Calculation
  // =================
  function seedableRandom(seed) {
    let x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  function calculateGeneralStats(
    stats,
    oCountEvents,
    allScenes,
    allImages,
    year,
  ) {
    // New Scenes
    const newScenesList = allScenes.filter(
      (s) => new Date(s.created_at).getFullYear() == year,
    );
    stats.newScenes = newScenesList.length;
    stats.newScenesImage = null;
    if (newScenesList.length > 0) {
      const mostRecentNewScene = newScenesList.sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at),
      )[0];
      stats.newScenesImage = mostRecentNewScene.paths?.screenshot || null;
    }

    // New Images
    const newImagesList = allImages.filter(
      (i) => new Date(i.created_at).getFullYear() == year,
    );
    stats.newImages = newImagesList.length;
    stats.newImagesImage = null;
    if (newImagesList.length > 0) {
      const mostRecentNewImage = newImagesList.sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at),
      )[0];
      stats.newImagesImage = mostRecentNewImage.paths?.thumbnail || null;
    }

    // Total O-Counts
    stats.totalOCounts = oCountEvents.length;
    stats.totalOCountsImage = null;
    if (oCountEvents.length > 0) {
      const scenesWithOCounts = allScenes.filter(
        (s) => s.o_history && s.o_history.length > 0,
      );
      if (scenesWithOCounts.length > 0) {
        const randomIndex = Math.floor(
          seedableRandom(year) * scenesWithOCounts.length,
        );
        stats.totalOCountsImage =
          scenesWithOCounts[randomIndex].paths?.screenshot || null;
      }
    }

    const oCountsByItem = oCountEvents.reduce((acc, curr) => {
      acc[curr.item.id] = (acc[curr.item.id] || 0) + 1;
      return acc;
    }, {});

    stats.topOScene = { id: null, title: "N/A", count: 0, image: null };
    for (const itemId in oCountsByItem) {
      const item = allScenes.find((i) => i.id === itemId);
      const count = oCountsByItem[itemId];
      if (item && count > stats.topOScene.count) {
        stats.topOScene = {
          id: item.id,
          title: item.title,
          count: count,
          image: item.paths?.screenshot || null,
        };
      }
    }
  }

  async function calculateTopPerformers(stats, oCountEvents) {
    const performerCounts = oCountEvents.reduce((acc, curr) => {
      if (curr.item.performers) {
        curr.item.performers.forEach((p) => {
          if (!acc[p.id]) {
            acc[p.id] = { name: p.name, count: 0, id: p.id };
          }
          acc[p.id].count++;
        });
      }
      return acc;
    }, {});

    const top5PerformersRaw = Object.values(performerCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Extract IDs for the GraphQL query
    const performerIds = top5PerformersRaw.map((p) => p.id);

    // Fetch performer image paths
    let performerImagesMap = {};
    if (performerIds.length > 0) {
      const imageData = await performGraphQLQuery(PERFORMERS_IMAGES_QUERY, {
        performer_ids: performerIds,
      });
      if (imageData?.findPerformers?.performers) {
        imageData.findPerformers.performers.forEach((p) => {
          performerImagesMap[p.id] = p.image_path;
        });
      }
    }

    // Combine performer data with image paths
    stats.topPerformers = top5PerformersRaw.map((p) => ({
      id: p.id,
      name: p.name,
      count: p.count,
      image_path: performerImagesMap[p.id] || null, // Attach image path
    }));
  }

  function calculateDeepDive(stats, oCountEvents, year) {
    const oCountsByDay = oCountEvents.reduce((acc, curr) => {
      const day = new Date(curr.event).toISOString().substring(0, 10);
      acc[day] = (acc[day] || 0) + 1;
      return acc;
    }, {});

    stats.peakDay = { date: "N/A", count: 0, items: [] };
    if (oCountEvents.length > 0) {
      let maxCount = 0;
      let peakDate = "N/A";
      for (const day in oCountsByDay) {
        if (oCountsByDay[day] > maxCount) {
          maxCount = oCountsByDay[day];
          peakDate = day;
        }
      }
      stats.peakDay = { date: peakDate, count: maxCount, items: [] };

      stats.peakDay.items = oCountEvents.filter(
        (e) =>
          new Date(e.event).toISOString().substring(0, 10) ===
          stats.peakDay.date,
      ); // Keep full event objects
    }

    const peakDayEvents = oCountEvents.filter(
      (e) =>
        new Date(e.event).toISOString().substring(0, 10) === stats.peakDay.date,
    );
    const oCountsByHourOnPeakDay = peakDayEvents.reduce((acc, curr) => {
      const hour = new Date(curr.event).getHours();
      acc[hour] = (acc[hour] || 0) + 1;
      return acc;
    }, {});

    stats.hourlyLabels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
    stats.hourlyData = stats.hourlyLabels.map(
      (_, i) => oCountsByHourOnPeakDay[i] || 0,
    );

    const yearDays = new Set(Object.keys(oCountsByDay));
    stats.longestStreak = 0;
    stats.longestStreakStart = null;
    stats.longestStreakEnd = null;
    stats.longestDrySpell = 0;
    stats.longestDrySpellStart = null;
    stats.longestDrySpellEnd = null;

    let currentStreak = 0;
    let currentStreakStart = null;
    let currentDrySpell = 0;
    let currentDrySpellStart = null;

    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);

    for (
      let d = new Date(startDate);
      d <= endDate;
      d.setDate(d.getDate() + 1)
    ) {
      const dateString = d.toISOString().substring(0, 10);
      if (yearDays.has(dateString)) {
        // O-count on this day
        currentStreak++;
        if (currentStreakStart === null) currentStreakStart = dateString;

        if (currentDrySpell > stats.longestDrySpell) {
          stats.longestDrySpell = currentDrySpell;
          stats.longestDrySpellEnd = new Date(d);
          stats.longestDrySpellEnd.setDate(
            stats.longestDrySpellEnd.getDate() - 1,
          ); // Previous day
          stats.longestDrySpellStart = new Date(stats.longestDrySpellEnd);
          stats.longestDrySpellStart.setDate(
            stats.longestDrySpellStart.getDate() - stats.longestDrySpell + 1,
          );
          stats.longestDrySpellStart = stats.longestDrySpellStart
            .toISOString()
            .substring(0, 10);
          stats.longestDrySpellEnd = stats.longestDrySpellEnd
            .toISOString()
            .substring(0, 10);
        }
        currentDrySpell = 0;
        currentDrySpellStart = null;
      } else {
        // No O-count on this day
        currentDrySpell++;
        if (currentDrySpellStart === null) currentDrySpellStart = dateString;

        if (currentStreak > stats.longestStreak) {
          stats.longestStreak = currentStreak;
          stats.longestStreakEnd = new Date(d);
          stats.longestStreakEnd.setDate(stats.longestStreakEnd.getDate() - 1); // Previous day
          stats.longestStreakStart = new Date(stats.longestStreakEnd);
          stats.longestStreakStart.setDate(
            stats.longestStreakStart.getDate() - stats.longestStreak + 1,
          );
          stats.longestStreakStart = stats.longestStreakStart
            .toISOString()
            .substring(0, 10);
          stats.longestStreakEnd = stats.longestStreakEnd
            .toISOString()
            .substring(0, 10);
        }
        currentStreak = 0;
        currentStreakStart = null;
      }
    }

    // After the loop, check the last streak/dry spell
    if (currentStreak > stats.longestStreak) {
      stats.longestStreak = currentStreak;
      stats.longestStreakEnd = endDate.toISOString().substring(0, 10);
      stats.longestStreakStart = new Date(endDate);
      stats.longestStreakStart.setDate(
        stats.longestStreakStart.getDate() - stats.longestStreak + 1,
      );
      stats.longestStreakStart = stats.longestStreakStart
        .toISOString()
        .substring(0, 10);
    }
    if (currentDrySpell > stats.longestDrySpell) {
      stats.longestDrySpell = currentDrySpell;
      stats.longestDrySpellEnd = endDate.toISOString().substring(0, 10);
      stats.longestDrySpellStart = new Date(endDate);
      stats.longestDrySpellStart.setDate(
        stats.longestDrySpellStart.getDate() - stats.longestDrySpell + 1,
      );
      stats.longestDrySpellStart = stats.longestDrySpellStart
        .toISOString()
        .substring(0, 10);
    }
  }

  function calculateSessionDurations(stats, allScenes, year) {
    stats.sessions = [];
    // Create a map of scene ID to screenshot path for quick lookup
    const sceneScreenshotMap = new Map();
    allScenes.forEach((s) => {
      sceneScreenshotMap.set(s.id, s.paths?.screenshot || null);
    });

    allScenes.forEach((scene) => {
      if (scene.play_history && scene.o_history) {
        const scenePlaysInYear = scene.play_history.filter(
          (p) => new Date(p).getFullYear() == year,
        );
        const sceneOsInYear = scene.o_history.filter(
          (o) => new Date(o).getFullYear() == year,
        );
        if (scenePlaysInYear.length > 0 && sceneOsInYear.length > 0) {
          scenePlaysInYear.forEach((play) => {
            const playTime = new Date(play);
            const oneHourAfterPlay = new Date(
              playTime.getTime() + 60 * 60 * 1000,
            );
            const potentialOs = sceneOsInYear.filter((o) => {
              const oTime = new Date(o);
              return oTime >= playTime && oTime <= oneHourAfterPlay;
            });
            if (potentialOs.length > 0) {
              const latestO = potentialOs.reduce((l, c) =>
                new Date(c) > new Date(l) ? c : l,
              );
              const duration = (new Date(latestO) - playTime) / 1000;
              if (duration > 0) {
                // Filter out sessions with 0 duration
                stats.sessions.push({
                  sceneId: scene.id, // Store scene ID
                  sceneTitle: scene.title,
                  duration,
                  image_path: sceneScreenshotMap.get(scene.id), // Add image path
                });
              }
            }
          });
        }
      }
    });
    stats.sessions.sort((a, b) => a.duration - b.duration);
    stats.shortestSessions = stats.sessions.slice(0, 5);
    stats.longestSessions = stats.sessions.slice(-5).reverse();
  }

  function calculateTagStats(stats, oCountEvents) {
    const tagCounts = oCountEvents.reduce((acc, curr) => {
      if (curr.item.tags) {
        curr.item.tags.forEach((t) => {
          if (!acc[t.name]) {
            acc[t.name] = { count: 0, byMonth: Array(12).fill(0) };
          }
          acc[t.name].count++;
          acc[t.name].byMonth[new Date(curr.event).getMonth()]++;
        });
      }
      return acc;
    }, {});
    stats.topTags = Object.entries(tagCounts)
      .sort((tagA, tagB) => {
        const countA = tagA[1].count;
        const countB = tagB[1].count;
        return countB - countA;
      })
      .slice(0, 8)
      .sort((tagA, tagB) => {
        // Sort by name afterwards to make the graph look more interesting
        const nameA = tagA[0];
        const nameB = tagB[0];
        return nameA.localeCompare(nameB);
      });
    stats.top3Tags = stats.topTags.slice(0, 3);
  }

  function calculatePlayCountStats(stats, playEvents) {
    const playCountsByTag = playEvents.reduce((acc, curr) => {
      if (curr.item.tags) {
        curr.item.tags.forEach((t) => {
          if (!acc[t.name])
            acc[t.name] = { count: 0, byMonth: Array(12).fill(0) };
          acc[t.name].count++;
          acc[t.name].byMonth[new Date(curr.event).getMonth()]++;
        });
      }
      return acc;
    }, {});

    stats.topPlayTags = Object.entries(playCountsByTag)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 8);
  }

  function calculateTimelineData(stats, oCountEvents) {
    stats.timeline = Array(12)
      .fill(0)
      .map(() => []);
    oCountEvents.forEach((e) => {
      const month = new Date(e.event).getMonth();
      stats.timeline[month].push(e);
    });
  }

  // ============
  // UI Rendering
  // ============

  const O_COUNT_PATH =
    "M22.855.758L7.875 7.024l12.537 9.733c2.633 2.224 6.377 2.937 9.77 1.518c4.826-2.018 7.096-7.576 5.072-12.413C33.232 1.024 27.68-1.261 22.855.758zm-9.962 17.924L2.05 10.284L.137 23.529a7.993 7.993 0 0 0 2.958 7.803a8.001 8.001 0 0 0 9.798-12.65zm15.339 7.015l-8.156-4.69l-.033 9.223c-.088 2 .904 3.98 2.75 5.041a5.462 5.462 0 0 0 7.479-2.051c1.499-2.644.589-6.013-2.04-7.523z";

  function renderGeneralStats({
    newScenes,
    newScenesImage,
    newImages,
    newImagesImage,
    totalOCounts,
    totalOCountsImage,
    topOScene,
  }) {
    const SVG_SIZE = "3vw";
    const VIEWBOX_SIZES = "0 0 38 38";

    const GREEN_FILL = "#28a745";
    const RED_FILL = "#dc3545";

    const TRIANGLE_UP = `<svg viewBox="${VIEWBOX_SIZES}" width="${SVG_SIZE}" height="${SVG_SIZE}" style="display:inline-block; vertical-align:middle;"><path d="M18 6L4.5 30H 31.5L 18 6Z" fill="${GREEN_FILL}"></path></svg>`;
    const TRIANGLE_DOWN = `<svg viewBox="${VIEWBOX_SIZES}" width="${SVG_SIZE}" height="${SVG_SIZE}" style="display:inline-block; vertical-align:middle;"><path d="M18 30L 31.5 6H 4.5L 18 30Z" fill="${RED_FILL}"></path></svg>`;

    const O_COUNT_SYMBOL_UP = `<svg viewBox="${VIEWBOX_SIZES}" width="${SVG_SIZE}" height="${SVG_SIZE}" style="display:inline-block; vertical-align:middle;"><path d="${O_COUNT_PATH}" fill="${GREEN_FILL}"></path></svg>`;
    const O_COUNT_SYMBOL_DOWN = `<svg viewBox="${VIEWBOX_SIZES}" width="${SVG_SIZE}" height="${SVG_SIZE}" style="display:inline-block; vertical-align:middle;"><path d="${O_COUNT_PATH}" fill="${RED_FILL}"></path></svg>`;

    const renderStatBox = (
      title,
      boxSubtitle,
      value,
      imageUrl,
      defaultTitle,
      statType,
    ) => {
      const backgroundStyle = imageUrl
        ? `background-image: url('${imageUrl}');`
        : "";
      const noImageClass = imageUrl ? "" : "no-image";
      const boxTitle = value > 0 ? title : defaultTitle;

      let symbolHtml = "";
      let symbolColorClass = "";

      // TODO: Pass this from outside instead of handling it in here
      if (value > 0) {
        if (statType === "scenes" || statType === "images") {
          symbolHtml = TRIANGLE_UP;
        } else if (statType === "ocounts") {
          symbolHtml = O_COUNT_SYMBOL_UP;
        }
      } else {
        if (statType === "scenes" || statType === "images") {
          symbolHtml = TRIANGLE_DOWN;
        } else if (statType === "ocounts") {
          symbolHtml = O_COUNT_SYMBOL_DOWN;
        }
      }

      return `
        <div class="stat-box ${noImageClass}" style="${backgroundStyle}">
          <div class="stat-box-overlay">
            <div class="stat-box-value-container">
            <div class="stat-box-symbol ${symbolColorClass}">${symbolHtml}</div>
            <div class="stat-box-value">${value}</div>
          </div>
          <div class="stat-box-title">${boxTitle}</div>
          <div class="stat-box-subtitle">${boxSubtitle}</div>
          </div>
        </div>
      `;
    };

    return `
      <div class="col-md-12">
        <h3>General Stats</h3>
        <div class="stat-box-container">
          ${renderStatBox("Scenes", "Added", newScenes, newScenesImage, "No New Scenes", "scenes")}
          ${renderStatBox("Images", "Added", newImages, newImagesImage, "No New Images", "images")}
          ${renderStatBox("O-Count Increases", "Achieved", totalOCounts, totalOCountsImage, "No O-Counts", "ocounts")}
          ${renderStatBox("Most O-Count Increases Caused By", topOScene.title, topOScene.count, topOScene.image, "No Top O-Count Scene", "ocounts")}
        </div>
      </div>`;
  }

  const CROWN_PATH =
    "M 10.125 2.3906 c 0 0.3883 -0.3148 0.7031 -0.7031 0.7031 c -0.0044 0 -0.008 -0.0022 -0.0124 -0.0023 l -0.888 4.885 C 8.4727 8.2424 8.2406 8.4375 7.9682 8.4375 H 2.1568 c -0.2718 0 -0.5048 -0.1944 -0.5534 -0.4618 L 0.7156 3.092 C 0.7112 3.092 0.7075 3.0938 0.6873 3.0938 c -0.3883 0 -0.7031 -0.3148 -0.7031 -0.7031 S 0.3148 1.6875 0.6873 1.6875 s 0.7031 0.3148 0.7031 0.7031 c 0 0.1582 -0.0619 0.2969 -0.1501 0.4143 l 1.5755 1.2604 c 0.2797 0.2238 0.6943 0.1326 0.8545 -0.1877 l 1.0125 -2.025 C 4.4842 1.7286 4.3436 1.5177 4.3436 1.2656 C 4.3436 0.8773 4.674 0.5625 5.0625 0.5625 s 0.6873 0.3148 0.6873 0.7031 c 0 0.2521 -0.14 0.463 -0.3393 0.5871 l 1.0125 2.025 c 0.1602 0.3203 0.575 0.4113 0.8545 0.1877 l 1.5755 -1.2604 C 8.7803 2.6877 8.7188 2.533 8.7188 2.3906 C 8.7188 2.0021 9.0334 1.6875 9.4219 1.6875 S 10.125 2.0021 10.125 2.3906 Z";
  const VIEWBOX_SIZES = "0 0 10 12";
  function addCrown(rank) {
    if (rank === 0) {
      return `<svg class="crown" xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX_SIZES}"><!--! Font Awesome Free 6.1.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License) Copyright 2022 Fonticons, Inc. --><path d="${CROWN_PATH}" fill="#ffd700"/></svg>`;
    } else if (rank === 1) {
      return `<svg class="crown" xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX_SIZES}"><!--! Font Awesome Free 6.1.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License) Copyright 2022 Fonticons, Inc. --><path d="${CROWN_PATH}" fill="#c0c0c0"/></svg>`;
    } else if (rank === 2) {
      return `<svg class="crown" xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX_SIZES}"><!--! Font Awesome Free 6.1.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License) Copyright 2022 Fonticons, Inc. --><path d="${CROWN_PATH}" fill="#cd7f32"/></svg>`;
    } else {
      return "";
    }
  }

  function renderTopPerformers({ topPerformers }) {
    if (!topPerformers || topPerformers.length === 0) {
      return "";
    }
    const O_COUNT_SYMBOL = `<svg viewBox="0 0 38 38" width="1.25em" height="1.25em" style="display:inline-block; vertical-align:middle;"><path d="${O_COUNT_PATH}" fill="#F5F8FA"></path></svg>`;

    return `
      <div class="col-md-12">
        <h3>Top Performers by O-Count</h3>
        <div class="performer-box-container">
          ${topPerformers
            .map((performer, index) => {
              const backgroundStyle = performer.image_path
                ? `background-image: url('${performer.image_path}');`
                : "";
              // Scale based on rank (index). Rank 0 is largest.
              const scaleFactor = 1 - index * 0.1; // Reduce size by 10% per rank
              const height = 250 * scaleFactor;
              const width = 250 * scaleFactor;

              return `
              <div class="performer-box" style="${backgroundStyle}; height: ${height}px; width: ${width}px;">
                <div class="performer-box-overlay">
                  <div class="performer-box-name">${performer.name}</div>
                  <div class="performer-box-count-overlay">
                    <div class="performer-box-count-container">
                      <div class="performer-box-count">${performer.count}</div>
                      ${O_COUNT_SYMBOL}
                    </div>
                    ${addCrown(index)}
                  </div>
                </div>
              </div>`;
            })
            .join("")}
        </div>
      </div>`;
  }

  function renderDeepDive(
    {
      peakDay,
      hourlyLabels,
      hourlyData,
      longestStreak,
      longestStreakStart,
      longestStreakEnd,
      longestDrySpell,
      longestDrySpellStart,
      longestDrySpellEnd,
    },
    oCountEvents,
  ) {
    if (oCountEvents.length === 0) {
      return "";
    }

    const O_COUNT_SYMBOL = `<svg viewBox="0 0 38 38" width="1.25em" height="1.25em" style="display:inline-block; vertical-align:middle;"><path d="${O_COUNT_PATH}" fill="#F5F8FA"></path></svg>`;

    const renderScreenshotGrid = (events) => {
      if (!events || events.length === 0) return "";
      const validEvents = events.filter(
        (e) => e.item.paths?.screenshot || e.item.paths?.thumbnail,
      );
      if (validEvents.length === 0) return "";

      // Sort events by timestamp in ascending order
      validEvents.sort(
        (a, b) => new Date(a.event).getTime() - new Date(b.event).getTime(),
      );

      // Calculate column count for grid, up to 4 columns
      const numColumns = Math.min(validEvents.length, 4);
      // Calculate flexible item size
      const itemFlexBasis = `calc(${100 / numColumns}% - 5px)`; // 5px for gap, assuming 10px total gap

      return `
        <div class="peak-day-screenshot-grid" style="
          display: flex;
          flex-wrap: wrap;
          gap: 5px; /* Adjust gap to match itemFlexBasis calculation */
          margin-top: 15px;
          justify-content: center;
        ">
          ${validEvents
            .map((e) => {
              const item = e.item;
              const eventTime = new Date(e.event);
              const timeString = `${String(eventTime.getHours()).padStart(2, "0")}:${String(eventTime.getMinutes()).padStart(2, "0")}`;
              return `
                  <div class="peak-day-screenshot-item" style="
                    flex: 0 0 ${itemFlexBasis};
                    aspect-ratio: 16 / 9; /* Maintain aspect ratio */
                    background-image: url('${
                      item.paths?.screenshot || item.paths?.thumbnail
                    }');
                    background-size: cover;
                    background-position: center;
                    border-radius: 4px;
                    overflow: hidden;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                  ">
                    <div class="peak-day-item-overlay">
                      <span class="peak-day-item-time">${timeString}</span>
                      ${O_COUNT_SYMBOL}
                    </div>
                  </div>
                `;
            })
            .join("")}
        </div>
      `;
    };

    const renderStreakTimeline = (
      duration,
      startDate,
      endDate,
      title,
      colorClass,
    ) => {
      if (duration === 0) return "";
      const numSegments = Math.min(duration, 50); // Max 50 segments for visual clarity
      let segmentsHtml = "";
      for (let i = 0; i < numSegments; i++) {
        segmentsHtml += `<div class="streak-timeline-segment ${colorClass}"></div>`;
      }

      return `
        <div class="streak-timeline-wrapper">
          <p class="streak-timeline-title">${title}: ${duration} days</p>
          <div class="streak-timeline-container">
            <span class="streak-timeline-date">${startDate}</span>
            ${segmentsHtml}
            <span class="streak-timeline-date">${endDate}</span>
          </div>
        </div>
      `;
    };

    return `
      <div class="col-md-12">
        <h3>O-Count Deep-Dive</h3>
        <div class="deep-dive-section">
          <h4>Peak Day: ${peakDay.date} (${peakDay.count} O-Counts)</h4>
          <div class="peak-day-content" style="text-align: center;">
            ${renderScreenshotGrid(peakDay.items)}
          </div>
        </div>
        <div class="deep-dive-section">
          <h4 style="text-align: center;">Hourly Breakdown on ${peakDay.date}</h4>
          <div class="hourly-breakdown-chart-container" style="text-align: center;">
            <div style="position: relative; height:300px; display: inline-block; width: 100%; max-width: 600px;"><canvas id="hourly-breakdown-chart"></canvas></div>
          </div>
        </div>
        <hr>
        <div class="row">
            <div class="col-md-12">
                ${renderStreakTimeline(longestStreak, longestStreakStart, longestStreakEnd, "Longest O-Count Streak", "streak-green")}
                ${renderStreakTimeline(longestDrySpell, longestDrySpellStart, longestDrySpellEnd, "Longest Dry Spell", "streak-red")}
            </div>
        </div>
      </div>`;
  }

  function renderSessionDurations({
    sessions,
    longestSessions,
    shortestSessions,
  }) {
    if (!sessions || sessions.length < 5) {
      return "";
    }

    const maxDuration = Math.max(...sessions.map((s) => s.duration));
    const NINE_MINUTES_IN_SECONDS = 9 * 60; // 9 minutes to give some space to the 8 min marker, should the sessions all be short
    const timelineMaxDuration = Math.max(NINE_MINUTES_IN_SECONDS, maxDuration);

    const MAX_LINE_PERCENTAGE = 90;

    const renderSessionItem = (session) => {
      // Ensure timelineMaxDuration is not 0 to avoid division by zero
      const normalizedDuration =
        timelineMaxDuration > 0 ? session.duration / timelineMaxDuration : 0;
      const lineWidth = normalizedDuration * MAX_LINE_PERCENTAGE; // Line width in percentage

      const fiveMinMarkerPosition =
        timelineMaxDuration > 0
          ? (300 / timelineMaxDuration) * MAX_LINE_PERCENTAGE
          : 0;
      const eightMinMarkerPosition =
        timelineMaxDuration > 0
          ? (480 / timelineMaxDuration) * MAX_LINE_PERCENTAGE
          : 0;

      const backgroundStyle = session.image_path
        ? `background-image: url('${session.image_path}');`
        : "";

      return `
        <div class="session-item">
          <div class="session-image" style="${backgroundStyle}"></div>
          <div class="session-details">
            <div class="session-title">${session.sceneTitle}</div>
            <div class="session-timeline-wrapper">
              <div class="session-timeline-container">
                <div class="session-duration-line" style="width: ${lineWidth}%;"></div>
                ${fiveMinMarkerPosition > 0 && fiveMinMarkerPosition < MAX_LINE_PERCENTAGE ? `<div class="session-marker session-marker-5min" style="left: ${fiveMinMarkerPosition}%;"></div>` : ""}
                ${eightMinMarkerPosition > 0 && eightMinMarkerPosition < MAX_LINE_PERCENTAGE ? `<div class="session-marker session-marker-8min" style="left: ${eightMinMarkerPosition}%;"></div>` : ""}
              </div>
              <span class="session-duration-text">${Math.round(session.duration)}s</span>
            </div>
          </div>
        </div>
      `;
    };

    return `
      <div class="col-md-12">
        <h3>Session Durations</h3>
        <div class="session-lists-container">
            <div class="session-list-section">
                <div class="session-list">
                    ${longestSessions.map(renderSessionItem).join("")}
                </div>
            </div>
            <div class="session-ellipsis-separator-horizontal">
              <hr>
              <div>&#8943;</div>
              <hr>
            </div>
            <div class="session-list-section">
                <div class="session-list">
                    ${shortestSessions.map(renderSessionItem).join("")}
                </div>
            </div>
        </div>
      </div>`;
  }

  function renderTagStats({ topTags, top3Tags }) {
    if (!topTags || topTags.length < 3) {
      return "";
    }
    return `
        <div class="col-md-12">
            <h3>Tag Statistics</h3>
            <div class="row">
                <div class="col-md-6" style="text-align: center;">
                    <h4>Top 8 Tags by O-Count</h4>
                    <div style="position: relative; height:400px; max-width: 400px; margin: 0 auto;"><canvas id="tag-radar-chart"></canvas></div>
                </div>
                <div class="col-md-6" style="text-align: center;">
                    <h4>Top 3 Tags Monthly Breakdown</h4>
                    ${top3Tags.map((_, i) => `<div style="position: relative; height:130px; max-width: 300px; margin: 0 auto;"><canvas id="tag-breakdown-chart-${i}"></canvas></div>`).join("")}
                </div>
            </div>
        </div>
    `;
  }

  function renderPlayCountStats({ topPlayTags }) {
    if (!topPlayTags || topPlayTags.length < 1) return "";
    return `
        <div class="col-md-12" style="text-align: center;">
            <h3>Play Count by Tag</h3>
            <div style="position: relative; height:400px; max-width: 600px; margin: 0 auto;"><canvas id="play-count-by-tag-chart"></canvas></div>
        </div>
    `;
  }

  function renderTimeline(stats) {
    if (stats.totalOCounts === 0) {
      return "";
    }

    const monthLabels = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    const renderTimelineScreenshotGrid = (events) => {
      if (!events || events.length === 0) return "";
      const validEvents = events.filter(
        (e) => e.item.paths?.screenshot || e.item.paths?.thumbnail,
      );
      if (validEvents.length === 0) return "";

      // Sort events by date of O-count (ascending)
      validEvents.sort(
        (a, b) => new Date(a.event).getTime() - new Date(b.event).getTime(),
      );

      // Calculate column count for grid, up to 4 columns (or adjust as needed for timeline density)
      const numColumns = Math.min(validEvents.length, 4);
      const itemFlexBasis = `calc(${100 / numColumns}% - 5px)`; // 5px for gap

      return `
        <div class="timeline-screenshot-grid" style="
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            margin-top: 10px;
            justify-content: center;
        ">
        ${validEvents
          .map((e) => {
            const item = e.item;
            const eventDate = new Date(e.event);
            const dateString = eventDate.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            }); // Format for date display

            return `
                    <div class="timeline-screenshot-item" style="
                        flex: 0 0 ${itemFlexBasis};
                        aspect-ratio: 16 / 9;
                        background-image: url('${
                          item.paths?.screenshot || item.paths?.thumbnail
                        }');
                        background-size: cover;
                        background-position: center;
                        border-radius: 4px;
                        overflow: hidden;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                        position: relative; /* Needed for overlay */
                        align-content: center;
                    ">
                        <div class="timeline-item-overlay">
                            <span class="timeline-item-date">${dateString}</span>
                        </div>
                    </div>
                `;
          })
          .join("")}
        </div>
    `;
    };

    let timelineHtml =
      '<div class="col-md-12"><h3>Timeline</h3><ul class="timeline">';

    stats.timeline.forEach((monthEvents, i) => {
      if (monthEvents.length > 0) {
        timelineHtml += `
                <li>
                  <div class="timeline-badge">${monthEvents.length}</div>
                  <div class="timeline-panel">
                    <div class="timeline-heading">
                      <h4 class="timeline-title">${monthLabels[i]}</h4>
                    </div>
                    <div class="timeline-body">
                      <p>You had ${monthEvents.length} O-events this month.</p>
                      ${renderTimelineScreenshotGrid(monthEvents)}
                    </div>
                  </div>
                </li>
            `;
      }
    });

    timelineHtml += "</ul></div>";
    return timelineHtml;
  }

  function drawCharts(stats) {
    if (stats.totalOCounts > 0 && window.stashGraphs?.drawBarChart) {
      window.stashGraphs.drawBarChart(
        "hourly-breakdown-chart",
        stats.hourlyLabels,
        stats.hourlyData,
        "O-Counts",
        `Hourly Breakdown on ${stats.peakDay.date}`,
        "rgba(75, 192, 192, 0.5)",
        "rgba(75, 192, 192, 1)",
      );
    }
    console.log(window.stashGraphs);
    if (stats.topTags?.length >= 3 && window.stashGraphs?.drawRadarChart) {
      console.log("Attempting to draw radar chart");
      const radarLabels = stats.topTags.map(([name, _]) => name);
      const radarData = {
        label: "O-Counts",
        data: stats.topTags.map(([_, data]) => data.count),
        fill: true,
        backgroundColor: "rgba(255, 99, 192, 0.2)",
        borderColor: "rgb(255, 99, 192)",
        pointBackgroundColor: "rgb(255, 99, 192)",
      };
      window.stashGraphs.drawRadarChart(
        "tag-radar-chart",
        radarLabels,
        [radarData],
        "Top 8 Tags",
      );
    } else {
      console.log("Skipping drawing radar chart");
    }
    if (stats.top3Tags?.length > 0 && window.stashGraphs?.drawBarChart) {
      const monthLabels = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];
      stats.top3Tags.forEach(([name, tagData], i) => {
        window.stashGraphs.drawBarChart(
          `tag-breakdown-chart-${i}`,
          monthLabels,
          tagData.byMonth,
          "O-Counts",
          `${name} - Monthly O-Counts`,
          "rgba(255, 159, 64, 0.5)",
          "rgba(255, 159, 64, 1)",
        );
      });
    }
    if (stats.topPlayTags?.length >= 1 && window.stashGraphs?.drawBarChart) {
      const playCountLabels = stats.topPlayTags.map(([name, _]) => name);
      const playCountData = stats.topPlayTags.map(([_, data]) => data.count);
      window.stashGraphs.drawBarChart(
        "play-count-by-tag-chart",
        playCountLabels,
        playCountData,
        "Play Count",
        "Top Tags by Play Count",
        "rgba(54, 162, 235, 0.5)",
        "rgba(54, 162, 235, 1)",
        "y",
      );
    }
  }

  // ==============
  // Main Functions
  // ==============
  async function getAvailableYears() {
    // TODO: This filter can be defined in one place and used where possible
    const variables = {
      scene_filter: {
        OR: {
          o_counter: { value: 0, modifier: "GREATER_THAN" },
          play_count: { value: 0, modifier: "GREATER_THAN" },
        },
      },
    };
    const data = await performGraphQLQuery(HISTORY_QUERY, variables);
    console.log(data);
    const years = new Set();
    const currentYear = new Date().getFullYear();
    const scenes = data?.findScenes?.scenes || [];

    scenes.forEach((s) => {
      if (s.o_history)
        s.o_history.forEach((o) => years.add(new Date(o).getFullYear()));
      if (s.play_history)
        s.play_history.forEach((p) => years.add(new Date(p).getFullYear()));
    });

    return Array.from(years)
      .filter((year) => year <= currentYear)
      .sort((a, b) => b - a);
  }

  async function generateStatsForYear(year) {
    const contentDiv = document.getElementById("unwind-stats-content");
    contentDiv.innerHTML = `<p>Loading statistics for ${year}...</p>`;
    try {
      const variables = {
        scene_filter: {
          OR: {
            o_counter: { value: 0, modifier: "GREATER_THAN" },
            play_count: { value: 0, modifier: "GREATER_THAN" },
          },
        },
        image_filter: { o_counter: { value: 0, modifier: "GREATER_THAN" } },
      };
      const data = await performGraphQLQuery(UNWIND_ITEMS_QUERY, variables);
      const allScenes = data.findScenes.scenes || [];
      const allImages = data.findImages.images || [];

      const oCountEvents = [];
      const playEvents = [];
      allScenes.forEach((s) => {
        if (s.o_history)
          s.o_history.forEach((o) => {
            if (new Date(o).getFullYear() == year)
              oCountEvents.push({ item: s, event: o });
          });
        if (s.play_history)
          s.play_history.forEach((p) => {
            if (new Date(p).getFullYear() == year)
              playEvents.push({ item: s, event: p });
          });
      });

      const stats = {};
      calculateGeneralStats(stats, oCountEvents, allScenes, allImages, year);
      await calculateTopPerformers(stats, oCountEvents);
      calculateDeepDive(stats, oCountEvents, year);
      calculateSessionDurations(stats, allScenes, year);
      calculateTagStats(stats, oCountEvents);
      calculatePlayCountStats(stats, playEvents);
      calculateTimelineData(stats, oCountEvents);

      contentDiv.innerHTML = `
            <div class="row">${renderGeneralStats(stats)}</div>
            <div class="row">${renderTopPerformers(stats)}</div>
            <hr>${renderDeepDive(stats, oCountEvents) ? `<div class="row">${renderDeepDive(stats, oCountEvents)}</div><hr>` : ""}
            ${renderSessionDurations(stats) ? `<div class="row">${renderSessionDurations(stats)}</div><hr>` : ""}
            ${renderTagStats(stats) ? `<div class="row">${renderTagStats(stats)}</div><hr>` : ""}
            ${renderPlayCountStats(stats) ? `<div class="row">${renderPlayCountStats(stats)}</div><hr>` : ""}
            ${renderTimeline(stats) ? `<div class="row">${renderTimeline(stats)}</div>` : ""}
        `;

      drawCharts(stats);
    } catch (e) {
      console.error(e);
      contentDiv.innerHTML = `<p style="color: red;">Error generating statistics: ${e.message}</p>`;
    }
  }

  async function renderUnwindStatsSection(targetElement) {
    let statsContainer = targetElement.querySelector("#unwind-stats-section");
    if (statsContainer) return;

    statsContainer = document.createElement("div");
    statsContainer.id = "unwind-stats-section";
    statsContainer.className = "unwind-plugin-container";
    statsContainer.innerHTML = `
        <div class="unwind-header">
        <h2>Unwind - A Year in Review</h2>
        <div class="year-selector-container">
            <label for="unwind-year-selector">Select Year:</label>
            <select id="unwind-year-selector" class="form-control"></select>
        </div>
        </div>
        <div id="unwind-stats-content"><p>Loading available years...</p></div>
    `;
    targetElement.appendChild(statsContainer);

    const yearSelector = document.getElementById("unwind-year-selector");
    const contentDiv = document.getElementById("unwind-stats-content");

    try {
      const availableYears = await getAvailableYears();
      if (availableYears.length > 0) {
        yearSelector.innerHTML = "";
        availableYears.forEach((year) => {
          const option = document.createElement("option");
          option.value = year;
          option.textContent = year;
          yearSelector.appendChild(option);
        });
        yearSelector.addEventListener("change", (e) =>
          generateStatsForYear(e.target.value),
        );
        generateStatsForYear(availableYears[0]);
      } else {
        contentDiv.innerHTML =
          "<p>No completed years with data available to generate statistics.</p>";
        yearSelector.style.display = "none";
      }
    } catch (e) {
      console.error(e);
      contentDiv.innerHTML = `<p style="color: red;">Error loading data: ${e.message}</p>`;
    }
  }

  if (typeof csLib !== "undefined" && csLib.PathElementListener) {
    csLib.PathElementListener(
      "/stats",
      "div.container-fluid div.mt-5",
      renderUnwindStatsSection,
    );
  } else {
    console.error(
      "CommunityScriptsUILibrary (csLib) not found or PathElementListener is missing.",
    );
  }

  console.log("Unwind Plugin fully initialized");
})();
