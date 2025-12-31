#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# Ensure bin directory exists
mkdir -p bin

# Read existing index.yml content for preserving metadata and requires
CURRENT_INDEX_YML_CONTENT=""
if [[ -f "index.yml" ]]; then
    CURRENT_INDEX_YML_CONTENT=$(cat index.yml)
fi

# Use a temporary file to collect new YAML entries
TEMP_YAML_ENTRIES_FILE=$(mktemp)

# Find all plugin directories and process them, writing to the temporary file
find plugins -maxdepth 1 -mindepth 1 -type d | while read -r plugin_dir; do
    plugin_id=$(basename "$plugin_dir")
    plugin_yml_file="$plugin_dir/$plugin_id.yml"

    if [[ -f "$plugin_yml_file" ]]; then
        echo "Processing plugin: $plugin_id" >&2

        # Extract name and version from the plugin's YML file
        plugin_name=$(cat "$plugin_yml_file" | yq '.name' | sed 's/"//g')
        plugin_version=$(cat "$plugin_yml_file" | yq '.version')
        zip_filename="${plugin_id}.zip"
        zip_output_path="bin/${zip_filename}"

        # Check if zipping is necessary
        should_zip=false
        if [ ! -f "$zip_output_path" ]; then
            should_zip=true
            echo "  Zip does not exist. Creating..." >&2
        else
            # Find the newest file in the plugin directory.
            # Note: We must cd into the directory to use find properly here.
            newest_source_file_ts=$( (cd "$plugin_dir" && find . -type f -print0 | xargs -0 stat -c "%Y") | sort -nr | head -1)
            zip_file_ts=$(stat -c "%Y" "$zip_output_path")

            if [ "$newest_source_file_ts" -gt "$zip_file_ts" ]; then
                should_zip=true
                echo "  Source files are newer. Re-creating zip..." >&2
            fi
        fi

        if [ "$should_zip" = false ]; then
            echo "  Skipping zip creation, no changes detected." >&2
        else
            # Isolate directory change to subshell and zip
            (cd "$plugin_dir" && zip -r -q "../../${zip_output_path}" ./*)
            echo "  Created zip: $zip_output_path" >&2
        fi

        # Calculate SHA256 hash
        sha256=$(sha256sum "$zip_output_path" | awk '{print $1}')
        echo "  SHA256: $sha256" >&2

        # Use the zip file's modification date
        current_date=$(date -r "$zip_output_path" '+%Y-%m-%d %H:%M:%S')
        echo "  Date: $current_date" >&2

        # Retrieve existing metadata and requires from the old index.yml
        # Only do this if CURRENT_INDEX_YML_CONTENT is not empty
        formatted_metadata=""
        if [[ -n "$CURRENT_INDEX_YML_CONTENT" ]]; then

            metadata_block_raw=$(yq '.[] | select(.id == "'"$plugin_id"'") | .metadata' <<< "$CURRENT_INDEX_YML_CONTENT")
            if [[ -n "$metadata_block_raw" && "$metadata_block_raw" != "null" ]]; then
                if [[ "${metadata_block_raw:0:1}" == "{" ]]; then
                    # It's JSON, convert to YAML and indent
                    formatted_metadata=$(echo "$metadata_block_raw" | yq -y | sed 's/^/    /')
                else
                    # It's already YAML, just indent
                    formatted_metadata=$(echo -e "$metadata_block_raw" | sed 's/^/    /')
                fi
                formatted_metadata="  metadata:\n$formatted_metadata"
            fi
        fi

        formatted_requires=""
        if [[ -n "$CURRENT_INDEX_YML_CONTENT" ]]; then
            requires_block_raw=$(yq '.[] | select(.id == "'"$plugin_id"'") | .requires' <<< "$CURRENT_INDEX_YML_CONTENT")
            if [[ -n "$requires_block_raw" && "$requires_block_raw" != "null" ]]; then
                if [[ "${requires_block_raw:0:1}" == "[" ]]; then # Requires is typically a YAML list, which can be represented as JSON array
                    # JSON => Convert to YAML and indent
                    formatted_requires=$(echo "$requires_block_raw" | yq -y | sed 's/^/    /')
                else
                    # YAML => Just indent
                    formatted_requires=$(echo -e "$requires_block_raw" | sed 's/^/    /')
                fi
                formatted_requires="  requires:\n$formatted_requires"
            fi
        fi

        # Construct the YAML entry for the current plugin
        plugin_entry="- id: $plugin_id\n  name: $plugin_name\n  version: $plugin_version\n  date: $current_date\n  path: $zip_output_path\n  sha256: $sha256"

        if [[ -n "$formatted_metadata" ]]; then
            plugin_entry+="\n$formatted_metadata"
        fi
        if [[ -n "$formatted_requires" ]]; then
            plugin_entry+="\n$formatted_requires"
        fi

        echo -e "$plugin_entry\n" >> "$TEMP_YAML_ENTRIES_FILE" # Append to temp file
    else
        echo "Warning: Plugin YML file not found for $plugin_id at $plugin_yml_file. Skipping." >&2
    fi
done

# Write the collected entries from the temporary file to index.yml, removing blank lines
cat "$TEMP_YAML_ENTRIES_FILE" | sed '/^$/d' > index.yml

# Clean up the temporary file
rm "$TEMP_YAML_ENTRIES_FILE"

echo "Successfully updated index.yml and generated plugin zips in bin/ directory."
