# StashApp Plugin Index

This repository contains plugins for the organizer [Stash](https://stashapp.cc/).

### Tested Stash Version
These plugins have been tested to work with Stash version `v0.30.X`.

- **CommunityScriptsUILibrary**: A shared library providing common helper functions for other plugins, such as GraphQL API requests and UI element manipulation. This is a simple copy of the content of the [CommunityScripts](https://github.com/stashapp/CommunityScripts/tree/main/plugins/CommunityScriptsUILibrary) and is included for the `requires` dependency mechanism to work properly within this index, as per [Stash plugin documentation](https://docs.stashapp.cc/in-app-manual/plugins/#creating-plugins).
- **StashGraphs**: A shared charting library for rendering visualizations like bar, pie, and radar charts using [Chart.js](https://www.chartjs.org).
- **OCountStatistics**: Provides locally computed, statistical insights and visualizations instance under `<stash-url>/stats`.
- **Unwind**: A "year in review" plugin that presents a summary of user activity for a given yearunder `<stash-url>/stats`.

## Installation
To install plugins, please consult the official StashApp manual for plugin installation instructions: [StashApp Plugin Installation Guide](https://docs.stashapp.cc/in-app-manual/plugins/)

For **stable** versions of the plugin add the following index to the available plugins 
```
https://raw.githubusercontent.com/dav-idka-j/stash-plugins/refs/heads/main/index.yml
```

For the **in-development** versions use
```
https://raw.githubusercontent.com/dav-idka-j/stash-plugins/refs/heads/dev/index.yml
```

## Building Plugins

This project uses `make` to automate the building of plugin `.zip` files and the `index.yml` file.

### Prerequisites
To build the plugins, you will need the following tools installed:
- `make`
- `zip`
- `yq` (version 4+)

To build all plugins and update `index.yml`:
```bash
make
```
