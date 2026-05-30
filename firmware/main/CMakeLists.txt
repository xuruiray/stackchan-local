set(GENERATED_INCLUDE_DIR "${CMAKE_BINARY_DIR}/generated_include")
set(RUNTIME_ASSETS_DIR "${CMAKE_CURRENT_SOURCE_DIR}/system/core/assets")
set(RUNTIME_ASSET_SCRIPTS_DIR "${RUNTIME_ASSETS_DIR}/scripts")
file(MAKE_DIRECTORY "${GENERATED_INCLUDE_DIR}")

# StackChan Local owns only the desktop-companion firmware surface. Core app,
# system, hardware, sensors, services, and runtime bridge files are listed
# explicitly so directory ownership stays visible in review.
set(STACK_CHAN_SOURCES
    "main.cpp"
    "app/local_companion/local_companion_app.cpp"
    "app/common/status_bar/status_bar.cpp"
    "assets/assets.cpp"
    "system/boot/device_runtime_boot.cpp"
    "system/core/clock.cpp"
    "system/core/diagnostics.cpp"
    "system/core/service_registry.cpp"
    "system/core/settings.cpp"
    "system/core/assets/asset_store.cpp"
    "system/core/system_info.cc"
    "system/core/system_context.cpp"
    "system/lifecycle/power_manager.cpp"
    "system/lifecycle/runtime_state.cpp"
    "system/core/time_service.cpp"
    "system/legacy_runtime/board/board.cc"
    "system/legacy_runtime/board/wifi_board.cc"
    "system/legacy_runtime/device_state_machine.cc"
    "system/legacy_runtime/protocols/protocol.cc"
    "system/power_policy/power_save_timer.cc"
    "hardware/registry.cpp"
    "hardware/audio/audio_codec.cc"
    "hardware/audio/audio_device.cpp"
    "hardware/board/m5stack_stackchan/board_profile.cpp"
    "hardware/bus/i2c_device.cc"
    "hardware/camera/camera_device.cpp"
    "hardware/power/axp2101.cc"
    "hardware/power/backlight.cc"
    "services/display/avatar_display.cpp"
    "services/display/display_service.cpp"
    "services/display/runtime/display.cc"
    "services/display/runtime/emoji_collection.cc"
    "services/display/runtime/lvgl_display.cc"
    "services/display/runtime/lvgl_font.cc"
    "services/display/runtime/lvgl_image.cc"
    "services/display/runtime/lvgl_theme.cc"
    "services/display/runtime/jpg/image_to_jpeg.cpp"
    "services/audio/runtime/audio_service.cc"
    "services/audio/runtime/demuxer/ogg_demuxer.cc"
    "services/audio/runtime/processors/audio_debugger.cc"
    "hardware/bus/i2c_bus.cpp"
    "hardware/io_expander/io_expander.cpp"
    "services/network/network_service.cpp"
    "services/network/wifi_ble.cpp"
    "hardware/power/axp2101_power.cpp"
    "services/display/rgb_service.cpp"
    "services/power/io_expander_power_service.cpp"
    "hardware/touch/screen_touch.cpp"
    "services/motion/servo_motion_service.cpp"
    "system/runtime_bridge/application_local_stub.cc"
    "system/runtime_bridge/embedded_runtime_bridge.cpp"
    "services/sensors/head_touch_service.cpp"
    "services/sensors/imu_service.cpp"
    "hardware/sensors/ina226/ina226_sensor.cpp"
    "hardware/sensors/ir/ir_sensor.cpp"
    "hardware/sensors/ltr553/ltr553_sensor.cpp"
    "services/audio/mic_level_service.cpp"
    "hardware/sensors/nfc/nfc_probe.cpp"
    "services/sensors/rtc_service.cpp"
    "services/sensors/sensor_service.cpp"
    "services/local_companion/audio_playback_service.cpp"
    "services/local_companion/camera_stream_service.cpp"
    "services/local_companion/command_dispatcher.cpp"
    "services/local_companion/local_companion_service.cpp"
    "services/local_companion/protocol_utils.cpp"
    "services/local_companion/telemetry_service.cpp"
    "services/local_companion/transport/esp_network.cpp"
    "third_party/py32_io_expander/PY32IOExpander_Class.cpp"
    "hardware/network/ble/peripheral/bleprph.c"
    "hardware/network/ble/peripheral/gatt_svr.c"
    "hardware/network/ble/peripheral/nimble_peripheral_utils/misc.c"
    "hardware/network/ble/peripheral/nimble_peripheral_utils/scli.c"
    "hardware/network/provisioning_secret/secret_logic.cpp"
    "hardware/network/wifi/provisioning/wifi_station.cc"
    "third_party/ftservo/src/HLSCL.cpp"
    "third_party/ftservo/src/SCS.cpp"
    "third_party/ftservo/src/SCSCL.cpp"
    "third_party/ftservo/src/SCSerial.cpp"
    "third_party/ftservo/src/SMS_STS.cpp"
    "third_party/si12t/Si12T.cpp"
    "third_party/bmi270/BMI270_SensorAPI/bmi2.c"
    "third_party/bmi270/BMI270_SensorAPI/bmi2_ois.c"
    "third_party/bmi270/BMI270_SensorAPI/bmi270.c"
    "third_party/bmi270/BMI270_SensorAPI/bmi270_context.c"
    "third_party/bmi270/BMI270_SensorAPI/bmi270_dsd.c"
    "third_party/bmi270/BMI270_SensorAPI/bmi270_legacy.c"
    "third_party/bmi270/BMI270_SensorAPI/bmi270_maximum_fifo.c"
    "third_party/bmi270/bmi270.cpp"
    "third_party/pcf8563/PCF8563_Class.cpp"
)

file(GLOB_RECURSE STACKCHAN_EXPRESSION_SOURCES
    "services/expression_motion/*.c"
    "services/expression_motion/*.cc"
    "services/expression_motion/*.cpp"
)

list(APPEND STACK_CHAN_SOURCES ${STACKCHAN_EXPRESSION_SOURCES})

set(STACK_CHAN_INCLUDE_DIRS
    "."
    "${GENERATED_INCLUDE_DIR}"
    "hardware/audio"
    "hardware/bus"
    "hardware/camera"
    "hardware/power"
    "services/audio/runtime"
    "services/audio/runtime/demuxer"
    "services/audio/runtime/processors"
    "services/audio/runtime/wake_words"
    "services/display/runtime"
    "services/display/runtime/jpg"
    "services/local_companion/transport"
    "system/core"
    "system/core/assets"
    "system/legacy_runtime"
    "system/legacy_runtime/board"
    "system/legacy_runtime/protocols"
    "system/power_policy"
)


idf_build_get_property(build_components BUILD_COMPONENTS)
# Function to find component dynamically by pattern
function(find_component_by_pattern PATTERN COMPONENT_VAR PATH_VAR)
    foreach(COMPONENT ${build_components})
        if(COMPONENT MATCHES "${PATTERN}")
            set(${COMPONENT_VAR} ${COMPONENT} PARENT_SCOPE)
            idf_component_get_property(COMPONENT_PATH ${COMPONENT} COMPONENT_DIR)
            set(${PATH_VAR} "${COMPONENT_PATH}" PARENT_SCOPE)
            break()
        endif()
    endforeach()
endfunction()

# Set default BUILTIN_TEXT_FONT and BUILTIN_ICON_FONT
set(BUILTIN_TEXT_FONT font_puhui_14_1)
set(BUILTIN_ICON_FONT font_awesome_14_1)

set(EMOTE_RESOLUTION "320_240")

# Current firmware target is the M5Stack StackChan ESP32-S3 board.
if(CONFIG_BOARD_TYPE_M5STACK_STACK_CHAN)
    set(BOARD_TYPE "m5stack-stack-chan")
    set(BUILTIN_TEXT_FONT font_puhui_basic_20_4)
    set(BUILTIN_ICON_FONT font_awesome_20_4)
    set(DEFAULT_EMOJI_COLLECTION twemoji_64)
endif()

# Select audio processor according to Kconfig
if(CONFIG_USE_AUDIO_PROCESSOR)
    list(APPEND STACK_CHAN_SOURCES "services/audio/runtime/processors/afe_audio_processor.cc")
else()
    list(APPEND STACK_CHAN_SOURCES "services/audio/runtime/processors/no_audio_processor.cc")
endif()
if(CONFIG_IDF_TARGET_ESP32S3 OR CONFIG_IDF_TARGET_ESP32P4)
    list(APPEND STACK_CHAN_SOURCES "services/audio/runtime/wake_words/afe_wake_word.cc")
    list(APPEND STACK_CHAN_SOURCES "services/audio/runtime/wake_words/custom_wake_word.cc")
else()
    list(APPEND STACK_CHAN_SOURCES "services/audio/runtime/wake_words/esp_wake_word.cc")
endif()

set(SOURCES ${STACK_CHAN_SOURCES})
set(INCLUDE_DIRS ${STACK_CHAN_INCLUDE_DIRS})
list(REMOVE_DUPLICATES SOURCES)
list(REMOVE_DUPLICATES INCLUDE_DIRS)

# Select language directory according to Kconfig
if(CONFIG_LANGUAGE_ZH_CN)
    set(LANG_DIR "zh-CN")
elseif(CONFIG_LANGUAGE_ZH_TW)
    set(LANG_DIR "zh-TW")
elseif(CONFIG_LANGUAGE_EN_US)
    set(LANG_DIR "en-US")
elseif(CONFIG_LANGUAGE_JA_JP)
    set(LANG_DIR "ja-JP")
elseif(CONFIG_LANGUAGE_KO_KR)
    set(LANG_DIR "ko-KR")
elseif(CONFIG_LANGUAGE_VI_VN)
    set(LANG_DIR "vi-VN")
elseif(CONFIG_LANGUAGE_TH_TH)
    set(LANG_DIR "th-TH")
elseif(CONFIG_LANGUAGE_DE_DE)
    set(LANG_DIR "de-DE")
elseif(CONFIG_LANGUAGE_FR_FR)
    set(LANG_DIR "fr-FR")
elseif(CONFIG_LANGUAGE_ES_ES)
    set(LANG_DIR "es-ES")
elseif(CONFIG_LANGUAGE_IT_IT)
    set(LANG_DIR "it-IT")
elseif(CONFIG_LANGUAGE_RU_RU)
    set(LANG_DIR "ru-RU")
elseif(CONFIG_LANGUAGE_AR_SA)
    set(LANG_DIR "ar-SA")
elseif(CONFIG_LANGUAGE_HI_IN)
    set(LANG_DIR "hi-IN")
elseif(CONFIG_LANGUAGE_PT_PT)
    set(LANG_DIR "pt-PT")
elseif(CONFIG_LANGUAGE_PL_PL)
    set(LANG_DIR "pl-PL")
elseif(CONFIG_LANGUAGE_CS_CZ)
    set(LANG_DIR "cs-CZ")
elseif(CONFIG_LANGUAGE_FI_FI)
    set(LANG_DIR "fi-FI")
elseif(CONFIG_LANGUAGE_TR_TR)
    set(LANG_DIR "tr-TR")
elseif(CONFIG_LANGUAGE_ID_ID)
    set(LANG_DIR "id-ID")
elseif(CONFIG_LANGUAGE_UK_UA)
    set(LANG_DIR "uk-UA")
elseif(CONFIG_LANGUAGE_RO_RO)
    set(LANG_DIR "ro-RO")
elseif(CONFIG_LANGUAGE_BG_BG)
    set(LANG_DIR "bg-BG")
elseif(CONFIG_LANGUAGE_CA_ES)
    set(LANG_DIR "ca-ES")
elseif(CONFIG_LANGUAGE_DA_DK)
    set(LANG_DIR "da-DK")
elseif(CONFIG_LANGUAGE_EL_GR)
    set(LANG_DIR "el-GR")
elseif(CONFIG_LANGUAGE_FA_IR)
    set(LANG_DIR "fa-IR")
elseif(CONFIG_LANGUAGE_FIL_PH)
    set(LANG_DIR "fil-PH")
elseif(CONFIG_LANGUAGE_HE_IL)
    set(LANG_DIR "he-IL")
elseif(CONFIG_LANGUAGE_HR_HR)
    set(LANG_DIR "hr-HR")
elseif(CONFIG_LANGUAGE_HU_HU)
    set(LANG_DIR "hu-HU")
elseif(CONFIG_LANGUAGE_MS_MY)
    set(LANG_DIR "ms-MY")
elseif(CONFIG_LANGUAGE_NB_NO)
    set(LANG_DIR "nb-NO")
elseif(CONFIG_LANGUAGE_NL_NL)
    set(LANG_DIR "nl-NL")
elseif(CONFIG_LANGUAGE_SK_SK)
    set(LANG_DIR "sk-SK")
elseif(CONFIG_LANGUAGE_SL_SI)
    set(LANG_DIR "sl-SI")
elseif(CONFIG_LANGUAGE_SV_SE)
    set(LANG_DIR "sv-SE")
elseif(CONFIG_LANGUAGE_SR_RS)
    set(LANG_DIR "sr-RS")
endif()

# Define generation path
set(LANG_JSON "${RUNTIME_ASSETS_DIR}/locales/${LANG_DIR}/language.json")
set(LANG_HEADER "${GENERATED_INCLUDE_DIR}/assets/lang_config.h")

# Collect current language audio files
file(GLOB LANG_SOUNDS ${RUNTIME_ASSETS_DIR}/locales/${LANG_DIR}/*.ogg)

# If not en-US, collect en-US audio files as fallback for missing files
if(NOT LANG_DIR STREQUAL "en-US")
    file(GLOB EN_US_SOUNDS ${RUNTIME_ASSETS_DIR}/locales/en-US/*.ogg)
    
    # Extract filenames (without path) from current language
    set(EXISTING_NAMES "")
    foreach(SOUND_FILE ${LANG_SOUNDS})
        get_filename_component(FILENAME ${SOUND_FILE} NAME)
        list(APPEND EXISTING_NAMES ${FILENAME})
    endforeach()
    
    # Only add en-US audio files that are missing in current language
    foreach(EN_SOUND ${EN_US_SOUNDS})
        get_filename_component(FILENAME ${EN_SOUND} NAME)
        if(NOT ${FILENAME} IN_LIST EXISTING_NAMES)
            list(APPEND LANG_SOUNDS ${EN_SOUND})
            message(STATUS "Using en-US fallback for missing audio: ${FILENAME}")
        endif()
    endforeach()
endif()

file(GLOB COMMON_SOUNDS 
    ${RUNTIME_ASSETS_DIR}/common/*.ogg
    assets/sfx/*.ogg
)

list(REMOVE_DUPLICATES SOURCES)
message(STATUS "StackChan Local: building local-only firmware runtime")

idf_component_register(SRCS ${SOURCES}
                    EMBED_FILES ${LANG_SOUNDS} ${COMMON_SOUNDS}
                    INCLUDE_DIRS ${INCLUDE_DIRS}
                    WHOLE_ARCHIVE
                    PRIV_REQUIRES
                        esp_pm
                        esp_psram
                        esp_netif
                        esp_driver_gpio
                        esp_driver_uart
                        esp_driver_spi
                        esp_driver_i2c
                        esp_driver_i2s
                        esp_driver_jpeg
                        esp_driver_rmt
                        esp_driver_ppa
                        esp_app_format
                        app_update
                        spi_flash
                        console
                        efuse
                        bt
                        fatfs
                        mdns
                    )

# Use target_compile_definitions to define BOARD_TYPE, BOARD_NAME
# If BOARD_NAME is empty, use BOARD_TYPE
if(NOT BOARD_NAME)
    set(BOARD_NAME ${BOARD_TYPE})
endif()
target_compile_definitions(${COMPONENT_LIB}
                    PRIVATE BOARD_TYPE=\"${BOARD_TYPE}\" BOARD_NAME=\"${BOARD_NAME}\"
                    PRIVATE BUILTIN_TEXT_FONT=${BUILTIN_TEXT_FONT} BUILTIN_ICON_FONT=${BUILTIN_ICON_FONT}
                    )

target_compile_definitions(${COMPONENT_LIB} PRIVATE STACKCHAN_LOCAL_DISABLE_LEGACY_CLOUD=1)

# Add generation rules
add_custom_command(
    OUTPUT ${LANG_HEADER}
    COMMAND python ${RUNTIME_ASSET_SCRIPTS_DIR}/gen_lang.py
            --language "${LANG_DIR}"
            --assets-dir "${RUNTIME_ASSETS_DIR}"
            --output "${LANG_HEADER}"
    DEPENDS
        ${LANG_JSON}
        ${RUNTIME_ASSET_SCRIPTS_DIR}/gen_lang.py
    COMMENT "Generating ${LANG_DIR} language config"
)

# Force build generation dependencies
add_custom_target(lang_header ALL
    DEPENDS ${LANG_HEADER}
)
add_dependencies(${COMPONENT_LIB} lang_header)

# Find ESP-SR component dynamically
find_component_by_pattern("espressif__esp-sr" ESP_SR_COMPONENT ESP_SR_COMPONENT_PATH)
if(ESP_SR_COMPONENT_PATH)
    set(ESP_SR_MODEL_PATH "${ESP_SR_COMPONENT_PATH}/model")
endif()

# Find retained runtime font component dynamically
find_component_by_pattern("xiaozhi-fonts" RUNTIME_FONTS_COMPONENT RUNTIME_FONTS_COMPONENT_PATH)
if(RUNTIME_FONTS_COMPONENT_PATH)
    set(RUNTIME_FONTS_PATH "${RUNTIME_FONTS_COMPONENT_PATH}")
endif()

set(DEFAULT_ASSETS_EXTRA_FILES "${CMAKE_CURRENT_SOURCE_DIR}/assets/assets_bin")

# Function to build default assets based on configuration
function(build_default_assets_bin)
    # Set output path for generated assets.bin
    set(GENERATED_ASSETS_BIN "${CMAKE_BINARY_DIR}/generated_assets.bin")
    
    # Prepare arguments for build script
    set(BUILD_ARGS
        "--sdkconfig" "${SDKCONFIG}"
        "--output" "${GENERATED_ASSETS_BIN}"
    )
    
    # Add builtin text font if defined
    if(BUILTIN_TEXT_FONT)
        list(APPEND BUILD_ARGS "--builtin_text_font" "${BUILTIN_TEXT_FONT}")
    endif()
    
    # Add default emoji collection if defined
    if(DEFAULT_EMOJI_COLLECTION)
        list(APPEND BUILD_ARGS "--emoji_collection" "${DEFAULT_EMOJI_COLLECTION}")
    endif()
    
    # Add default assets extra files if defined
    if(DEFAULT_ASSETS_EXTRA_FILES)
        list(APPEND BUILD_ARGS "--extra_files" "${DEFAULT_ASSETS_EXTRA_FILES}")
    endif()
    
    list(APPEND BUILD_ARGS "--esp_sr_model_path" "${ESP_SR_MODEL_PATH}")
    list(APPEND BUILD_ARGS "--xiaozhi_fonts_path" "${RUNTIME_FONTS_PATH}")
    
    # Create custom command to build assets
    add_custom_command(
        OUTPUT ${GENERATED_ASSETS_BIN}
        COMMAND python ${RUNTIME_ASSET_SCRIPTS_DIR}/build_default_assets.py ${BUILD_ARGS}
        DEPENDS
            ${SDKCONFIG}
            ${RUNTIME_ASSET_SCRIPTS_DIR}/build_default_assets.py
        COMMENT "Building default assets.bin based on configuration"
        VERBATIM
    )
    
    # Create target for generated assets
    add_custom_target(generated_default_assets ALL
        DEPENDS ${GENERATED_ASSETS_BIN}
    )
    add_dependencies(${COMPONENT_LIB} generated_default_assets)

    # Set the generated file path in parent scope
    set(GENERATED_ASSETS_LOCAL_FILE ${GENERATED_ASSETS_BIN} PARENT_SCOPE)
    
    message(STATUS "Default assets build configured: ${GENERATED_ASSETS_BIN}")
endfunction()


# Function to get local assets file path (handles both URL and local file)
function(get_assets_local_file assets_source assets_local_file_var)
    # Check if it's a URL (starts with http:// or https://)
    if(assets_source MATCHES "^https?://")
        # It's a URL, download it
        get_filename_component(ASSETS_FILENAME "${assets_source}" NAME)
        set(ASSETS_LOCAL_FILE "${CMAKE_BINARY_DIR}/${ASSETS_FILENAME}")
        set(ASSETS_TEMP_FILE "${CMAKE_BINARY_DIR}/${ASSETS_FILENAME}.tmp")
        
        # Check if local file exists
        if(EXISTS ${ASSETS_LOCAL_FILE})
            message(STATUS "Assets file ${ASSETS_FILENAME} already exists, skipping download")
        else()
            message(STATUS "Downloading ${ASSETS_FILENAME}")
            
            # Clean up any existing temp file
            if(EXISTS ${ASSETS_TEMP_FILE})
                file(REMOVE ${ASSETS_TEMP_FILE})
            endif()
            
            # Download to temporary file first
            file(DOWNLOAD ${assets_source} ${ASSETS_TEMP_FILE}
                 STATUS DOWNLOAD_STATUS)
            list(GET DOWNLOAD_STATUS 0 STATUS_CODE)
            if(NOT STATUS_CODE EQUAL 0)
                # Clean up temp file on failure
                if(EXISTS ${ASSETS_TEMP_FILE})
                    file(REMOVE ${ASSETS_TEMP_FILE})
                endif()
                message(FATAL_ERROR "Failed to download ${ASSETS_FILENAME} from ${assets_source}")
            endif()
            
            # Move temp file to final location (atomic operation)
            file(RENAME ${ASSETS_TEMP_FILE} ${ASSETS_LOCAL_FILE})
            message(STATUS "Successfully downloaded ${ASSETS_FILENAME}")
        endif()
    else()
        # It's a local file path
        if(IS_ABSOLUTE "${assets_source}")
            set(ASSETS_LOCAL_FILE "${assets_source}")
        else()
            set(ASSETS_LOCAL_FILE "${CMAKE_CURRENT_SOURCE_DIR}/${assets_source}")
        endif()
        
        # Check if local file exists
        if(NOT EXISTS ${ASSETS_LOCAL_FILE})
            message(FATAL_ERROR "Assets file not found: ${ASSETS_LOCAL_FILE}")
        endif()
        
        message(STATUS "Using assets file: ${ASSETS_LOCAL_FILE}")
    endif()
    
    set(${assets_local_file_var} ${ASSETS_LOCAL_FILE} PARENT_SCOPE)
endfunction()


partition_table_get_partition_info(size "--partition-name assets" "size")
partition_table_get_partition_info(offset "--partition-name assets" "offset")
if ("${size}" AND "${offset}")
    # Flash assets based on configuration
    if(CONFIG_FLASH_DEFAULT_ASSETS)
        # Build default assets based on configuration
        build_default_assets_bin()
        esptool_py_flash_to_partition(flash "assets" "${GENERATED_ASSETS_LOCAL_FILE}")
        message(STATUS "Generated default assets flash configured: ${GENERATED_ASSETS_LOCAL_FILE} -> assets partition")
    elseif(CONFIG_FLASH_CUSTOM_ASSETS)
        # Flash custom assets
        get_assets_local_file("${CONFIG_CUSTOM_ASSETS_FILE}" ASSETS_LOCAL_FILE)
        esptool_py_flash_to_partition(flash "assets" "${ASSETS_LOCAL_FILE}")
        message(STATUS "Custom assets flash configured: ${ASSETS_LOCAL_FILE} -> assets partition")
    elseif(CONFIG_FLASH_EXPRESSION_ASSETS)
        set(ASSETS_NAME "expression_assets")
        set(ASSETS_PARTITION "assets")
        set(ASSETS_FILE "${CMAKE_BINARY_DIR}/${ASSETS_NAME}.bin")

        build_speaker_assets_bin("${ASSETS_PARTITION}" ${EMOTE_RESOLUTION} ${ASSETS_FILE} ${CONFIG_MMAP_FILE_NAME_LENGTH})
        message(STATUS "Generated emote assets: ${ASSETS_FILE} -> ${ASSETS_PARTITION} partition")
        esptool_py_flash_to_partition(flash "${ASSETS_PARTITION}" "${ASSETS_FILE}")
    elseif(CONFIG_FLASH_NONE_ASSETS)
        message(STATUS "Assets flashing disabled (FLASH_NONE_ASSETS)")
    endif()
else()
    message(STATUS "Assets partition not found, using v1 partition table")
endif()
