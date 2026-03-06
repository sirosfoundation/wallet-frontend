#!/usr/bin/env bash
set -eo pipefail

# Available options from environment variables:
# BRANDING_OUTPUT_BASE_PATH: Branding directory in which "custom/*" should be created (required)
# BRANDING_THEME_JSON_PATH: JSON formatted theme configuration
# BRANDING_FAVICON_PATH: File containing data URL with favicon ("image/vnd.microsoft.icon")
# BRANDING_LOGO_LIGHT_PATH: File containing data URL with logo light ("image/png" or "image/svg")
# BRANDING_LOGO_DARK_PATH: File containing data URL with logo dark ("image/png" or "image/svg")

# -------------------------------------------------------------------------------------------------
function log() {
	LEVEL="${1}"
	MESSAGE="${2}"

	echo "${LEVEL}: ${MESSAGE}"

	if [[ "${LEVEL}" == "ERROR" ]]; then
		exit 1
	fi
}

function get_image_type() {
	echo -n "${1}" | grep data:image/ | cut -d / -f 2 | cut -d ';' -f 1
}

function get_data() {
	echo -n "${1}" | cut -d , -f 2- | base64 -d
}

# -------------------------------------------------------------------------------------------------
if ! [[ -d "${BRANDING_OUTPUT_BASE_PATH}" ]]; then
	log ERROR "Variable \"BRANDING_OUTPUT_BASE_PATH\" does not contain an existing directory"
fi

log INFO "Creating custom branding directories in \"${BRANDING_OUTPUT_BASE_PATH}\""
OUTPUT_PATH="${BRANDING_OUTPUT_BASE_PATH}/custom"
mkdir -p "${OUTPUT_PATH}/logo"

# -------------------------------------------------------------------------------------------------
if [[ -f "${BRANDING_THEME_JSON_PATH}" ]]; then
	log INFO "Processing custom theme JSON from \"${BRANDING_THEME_JSON_PATH}\""

	log INFO "Copying custom theme JSON to output file"
	cp "${BRANDING_THEME_JSON_PATH}" "${OUTPUT_PATH}/theme.json"
fi

# -------------------------------------------------------------------------------------------------
if [[ -f "${BRANDING_FAVICON_PATH}" ]]; then
	log INFO "Processing custom favicon from \"${BRANDING_FAVICON_PATH}\""

	log INFO "Reading favicon data URL from input file"
	FAVICON_DATA_URL="$(cat "${BRANDING_FAVICON_PATH}")"

	log INFO "Validating favicon image type from data URL"
	if [[ "$(get_image_type "${FAVICON_DATA_URL}")" != "vnd.microsoft.icon" ]]; then
		log ERROR "Invalid favicon image type in data URL"
	fi

	log INFO "Writing favicon data to output file"
	get_data "${FAVICON_DATA_URL}" > "${OUTPUT_PATH}/favicon.ico"
fi

# -------------------------------------------------------------------------------------------------
if [[ -f "${BRANDING_LOGO_LIGHT_PATH}" ]]; then
	log INFO "Processing custom logo light from \"${BRANDING_LOGO_LIGHT_PATH}\""

	log INFO "Reading custom logo light data URL from input file"
	LOGO_LIGHT_DATA_URL="$(cat "${BRANDING_LOGO_LIGHT_PATH}")"

	log INFO "Validating favicon image type from data URL"
	LOGO_LIGHT_IMAGE_TYPE="$(get_image_type "${LOGO_LIGHT_DATA_URL}")"
	if [[ "${LOGO_LIGHT_IMAGE_TYPE}" != "png" ]] && [[ "${LOGO_LIGHT_IMAGE_TYPE}" != "svg" ]]; then
		log ERROR "Invalid logo light image type in data URL"
	fi

	log INFO "Writing logo light data to output file"
	get_data "${LOGO_LIGHT_DATA_URL}" > "${OUTPUT_PATH}/logo/logo_light.${LOGO_LIGHT_IMAGE_TYPE}"
fi

# -------------------------------------------------------------------------------------------------
if [[ -f "${BRANDING_LOGO_DARK_PATH}" ]]; then
	log INFO "Processing custom logo dark from \"${BRANDING_LOGO_DARK_PATH}\""

	log INFO "Reading custom logo dark data URL from input file"
	LOGO_DARK_DATA_URL="$(cat "${BRANDING_LOGO_DARK_PATH}")"

	log INFO "Validating favicon image type from data URL"
	LOGO_DARK_IMAGE_TYPE="$(get_image_type "${LOGO_DARK_DATA_URL}")"
	if [[ "${LOGO_DARK_IMAGE_TYPE}" != "png" ]] && [[ "${LOGO_DARK_IMAGE_TYPE}" != "svg" ]]; then
		log ERROR "Invalid logo dark image type in data URL"
	fi

	log INFO "Writing logo dark data to output file"
	get_data "${LOGO_DARK_DATA_URL}" > "${OUTPUT_PATH}/logo/logo_dark.${LOGO_DARK_IMAGE_TYPE}"
fi

# -------------------------------------------------------------------------------------------------
log INFO "Successfully applied custom branding"
