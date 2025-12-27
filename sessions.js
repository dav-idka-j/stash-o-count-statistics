(async function () {
    'use strict';
    if (window.stashSessionsPluginLoaded) {
        console.log("Stash Sessions Plugin is already loaded");
        return;
    }
    window.stashSessionsPluginLoaded = true;

    console.log("OCount Statistics Plugin started");

    const config = {
        parentSelector: '.navbar-buttons',
        statsButton: { // Renamed from historyButton
            id: 'ocount-stats-btn', // Renamed from session-history-btn
            text: 'Statistics', // Renamed from History
            className: 'btn btn-info',
            style: { marginLeft: '8px' }
        },
    };

    const performGraphQLQuery = async (query, variables = {}) => {
        const response = await fetch('/graphql', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query, variables }),
        });

        if (!response.ok) {
            const responseText = await response.text();
            throw new Error(`GraphQL query failed with status ${response.status}: ${responseText}`);
        }

        const json = await response.json();
        if (json.errors) {
            console.error("GraphQL Errors:", json.errors);
            throw new Error(`GraphQL query failed: ${JSON.stringify(json.errors)}`);
        }

        return json.data;
    };

    const StatsCalculator = {
        getMostCommonTags(items, limit = 10) {
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
    };

    const drawMostCommonTagsChart = (items) => {
        if (typeof Chart === 'undefined') {
            console.warn('Chart.js is not loaded. Cannot draw chart.');
            return;
        }

        const ctx = document.getElementById('mostCommonTagsChart');
        if (!ctx) return;

        const mostCommonTags = StatsCalculator.getMostCommonTags(items, 15).reverse(); // reverse for horizontal bar chart

        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: mostCommonTags.map(t => t[0]),
                datasets: [{
                    label: 'Tag Count',
                    data: mostCommonTags.map(t => t[1]),
                    backgroundColor: 'rgba(54, 162, 235, 0.5)',
                    borderColor: 'rgba(54, 162, 235, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                indexAxis: 'y',
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: { color: '#ccc', stepSize: 1 },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    },
                    y: {
                        ticks: { color: '#ccc' },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    }
                }
            }
        });
    };

    const renderStatsUI = (items) => {
        if (typeof Chart === 'undefined') {
            return `
                <h3>Most Common Tags</h3>
                <p style="color: yellow;">Chart.js library not found.</p>
                <p>Please follow the instructions at the top of the <code>sessions.js</code> file to add it.</p>
            `;
        }

        // Chart will be rendered here
        return `
            <h3>Most Common Tags</h3>
            <div style="position: relative; height:400px">
                <canvas id="mostCommonTagsChart"></canvas>
            </div>
        `;
    };

    const createDarkModal = (id, title, bodyHTML, footerHTML) => {
        const existingBackdrop = document.getElementById(`${id}-backdrop`);
        if (existingBackdrop) existingBackdrop.remove();

        const backdrop = document.createElement('div');
        backdrop.id = `${id}-backdrop`;
        Object.assign(backdrop.style, {
            position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center',
            alignItems: 'center', zIndex: '9999', visibility: 'hidden'
        });

        const modal = document.createElement('div');
        modal.id = id; // Assign the ID to the modal content div
        Object.assign(modal.style, {
            backgroundColor: '#1e1e1e', color: '#ccc', padding: '20px',
            borderRadius: '8px', width: '80%', // Make it wider for stats
            maxWidth: '1200px',
            boxShadow: '0 0 10px rgba(0,0,0,0.3)'
        });
        modal.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <h2 style="margin-top:0;margin-bottom:10px;color:#fff;">${title}</h2>
                <button class="btn btn-secondary close-modal-btn" style="height:fit-content;">Close</button>
            </div>
            <div>${bodyHTML}</div>
            <div style="margin-top:20px;text-align:right;">${footerHTML}</div>
        `;

        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        const closeModal = () => { backdrop.style.visibility = 'hidden'; backdrop.remove(); };
        modal.querySelector('.close-modal-btn').addEventListener('click', closeModal);
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                closeModal();
            }
        });


        return {
            show: () => { backdrop.style.visibility = 'visible'; },
            hide: closeModal,
        };
    };

    const showStatisticsModal = async () => { // Renamed and marked async
        let bodyHTML = '<p>Loading statistics...</p>';

        const modal = createDarkModal(
            'ocount-stats-modal',
            'O-Count Statistics',
            bodyHTML,
            '' // No footer needed for now
        );
        modal.show();

        const modalBody = document.querySelector(`#ocount-stats-modal > div:nth-child(2)`);
        try {
            const sceneQuery = `
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
                      tags { id, name }
                      performers { id, name }
                      studio { id, name }
                    }
                  }
                }
            `;

            const imageQuery = `
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
                      tags { id, name }
                      performers { id, name }
                      studio { id, name }
                    }
                  }
                }
            `;

            const sceneFilterVariables = {
              "scene_filter": {
                "o_counter": {
                  "value": 0,
                  "modifier": "GREATER_THAN"
                }
              }
            };

            const imageFilterVariables = {
              "image_filter": {
                "o_counter": {
                  "value": 0,
                  "modifier": "GREATER_THAN"
                }
              }
            };

            console.log("Fetching scenes with O-count > 0...");
            const sceneData = await performGraphQLQuery(sceneQuery, sceneFilterVariables);
            console.log(`Found ${sceneData.findScenes.count} scenes:`, sceneData.findScenes.scenes);

            console.log("Fetching images with O-count > 0...");
            const imageData = await performGraphQLQuery(imageQuery, imageFilterVariables);
            console.log(`Found ${imageData.findImages.count} images:`, imageData.findImages.images);

            const allItems = [...sceneData.findScenes.scenes, ...imageData.findImages.images];

            console.log("Calculating and rendering statistics...");
            modalBody.innerHTML = renderStatsUI(allItems);
            drawMostCommonTagsChart(allItems);
        } catch (e) {
            modalBody.innerHTML = `<p style="color: red;">Error loading statistics: ${e.message}</p>`;
            console.error(e);
        }
    };

    const createButton = (id, text, className, style, onClick) => {
        const btn = document.createElement('button');
        btn.id = id;
        btn.textContent = text;
        btn.type = 'button';
        btn.className = className;
        Object.assign(btn.style, style);
        if (onClick) btn.addEventListener('click', onClick);
        return btn;
    };

    const initializeUI = () => {
        const parent = document.querySelector(config.parentSelector);
        if (!parent) return;

        // Only create the statistics button
        if (!document.getElementById(config.statsButton.id)) {
            const statsBtn = createButton(
                config.statsButton.id, config.statsButton.text,
                config.statsButton.className, config.statsButton.style,
                showStatisticsModal // Use new function
            );
            parent.appendChild(statsBtn);
        }
    };

    const observer = new MutationObserver(() => {
        const parent = document.querySelector(config.parentSelector);
        if (parent && !document.getElementById(config.statsButton.id)) {
            initializeUI();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    console.log("OCount Statistics Plugin fully initialized");

})();
