# PLUGINS:
# 1. Find all immediate subdirectories under 'plugins/'.
# 2. 'patsubst' removes the "plugins/" prefix, leaving just the plugin IDs (e.g., CommunityScriptsUILibrary, OCountStatistics).
PLUGINS := $(patsubst plugins/%,%,$(wildcard plugins/*))

# ZIP_FILES:
# Constructs a list of expected .zip file paths in the 'bin/' directory based on the discovered plugins above
# This list is used as a dependency for the 'index.yml' target, ensuring all zips exist before the index is generated.
ZIP_FILES := $(patsubst %,bin/%.zip,$(PLUGINS))

.PHONY: all
all: index.yml

index.yml: $(ZIP_FILES)
	@echo "Generating index.yml..."
	@./generate_index_from_zips.sh

# To build 'bin/%.zip' look for 'plugins/%', (i.e. 'bin/PluginName.zip' -> 'plugins/PluginName').
bin/%.zip: plugins/%
	# Ensure the 'bin' directory exists to store the zip files
	@mkdir -p bin
	# '$<' is the first prerequisite (plugins/%), '$@' is the target (bin/%.zip)
	@echo "Zipping $< -> $@..."
	# - 'cd $<': Change directory into the plugin's source folder (e.g., plugins/PluginName).
	# - 'zip -r -q "../../$@" ./*': Create a recursive zip archive.
	#   "../../$@" creates the zip in the 'bin/' directory relative to the project root.
	#   './*' includes all files and subdirectories from the current plugin directory.
	# Run in a subshell ('(...)') to isolate the 'cd' command, so it doesn't affect subsequent commands in the Makefile.
	@(cd $< && zip -r -q "../../$@" ./*)

# Dynamic Dependencies for .zip files:
# Dynamically create specific dependencies for each '.zip' file.
# Each 'bin/PluginName.zip' has a dependency on *every* file found within its corresponding 'plugins/PluginName' directory.
# If any source file within a plugin's directory changes, the corresponding '.zip' file will be considered out-of-date and recreated.
$(foreach plugin,$(PLUGINS),$(eval bin/$(plugin).zip: $(shell find plugins/$(plugin) -type f)))
