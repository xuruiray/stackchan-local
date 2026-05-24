#include <system/core/assets/asset_store.h>

#include <esp_log.h>
#include <esp_timer.h>

#define TAG "AssetStore"
#define PARTITION_LABEL "assets"

namespace {

struct mmap_assets_table {
    char asset_name[32];
    uint32_t asset_size;
    uint32_t asset_offset;
    uint16_t asset_width;
    uint16_t asset_height;
};

}  // namespace

Assets::Assets()
{
    InitializePartition();
}

Assets::~Assets()
{
    UnmapPartition();
}

uint32_t Assets::CalculateChecksum(const char* data, uint32_t length)
{
    uint32_t checksum = 0;
    for (uint32_t i = 0; i < length; i++) {
        checksum += data[i];
    }
    return checksum & 0xFFFF;
}

bool Assets::InitializePartition()
{
    partition_valid_ = false;
    checksum_valid_  = false;
    assets_.clear();

    partition_ = esp_partition_find_first(ESP_PARTITION_TYPE_ANY, ESP_PARTITION_SUBTYPE_ANY, PARTITION_LABEL);
    if (partition_ == nullptr) {
        ESP_LOGI(TAG, "No assets partition found");
        return false;
    }

    const uint32_t storage_size = spi_flash_mmap_get_free_pages(SPI_FLASH_MMAP_DATA) * 64 * 1024;
    ESP_LOGI(TAG, "mmap free=%lu KB, partition=%lu KB", storage_size / 1024, partition_->size / 1024);
    if (storage_size < partition_->size) {
        ESP_LOGE(TAG, "mmap free size is smaller than assets partition");
        return false;
    }

    const esp_err_t err =
        esp_partition_mmap(partition_, 0, partition_->size, ESP_PARTITION_MMAP_DATA, (const void**)&mmap_root_,
                           &mmap_handle_);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to mmap assets partition: %s", esp_err_to_name(err));
        return false;
    }
    partition_valid_ = true;

    const uint32_t stored_files  = *(uint32_t*)(mmap_root_ + 0);
    const uint32_t stored_chksum = *(uint32_t*)(mmap_root_ + 4);
    const uint32_t stored_len    = *(uint32_t*)(mmap_root_ + 8);
    if (stored_len > partition_->size - 12) {
        ESP_LOGW(TAG, "Invalid assets table length: 0x%lx", stored_len);
        return false;
    }

    const int64_t start_us       = esp_timer_get_time();
    const uint32_t checksum      = CalculateChecksum(mmap_root_ + 12, stored_len);
    const int64_t elapsed_ms     = (esp_timer_get_time() - start_us) / 1000;
    ESP_LOGI(TAG, "assets checksum took %lld ms", elapsed_ms);
    if (checksum != stored_chksum) {
        ESP_LOGE(TAG, "assets checksum mismatch: calculated=0x%lx stored=0x%lx", checksum, stored_chksum);
        return false;
    }

    checksum_valid_ = true;
    for (uint32_t i = 0; i < stored_files; i++) {
        auto item = (const mmap_assets_table*)(mmap_root_ + 12 + i * sizeof(mmap_assets_table));
        assets_[item->asset_name] = Asset{
            .size   = static_cast<size_t>(item->asset_size),
            .offset = static_cast<size_t>(12 + sizeof(mmap_assets_table) * stored_files + item->asset_offset),
        };
    }
    return true;
}

void Assets::UnmapPartition()
{
    if (mmap_handle_ != 0) {
        esp_partition_munmap(mmap_handle_);
        mmap_handle_ = 0;
    }
    mmap_root_        = nullptr;
    partition_valid_  = false;
    checksum_valid_   = false;
    assets_.clear();
}

bool Assets::GetAssetData(const std::string& name, void*& ptr, size_t& size)
{
    if (!checksum_valid_ || mmap_root_ == nullptr) {
        return false;
    }

    auto asset = assets_.find(name);
    if (asset == assets_.end()) {
        return false;
    }
    auto data = (const char*)(mmap_root_ + asset->second.offset);
    if (data[0] != 'Z' || data[1] != 'Z') {
        ESP_LOGE(TAG, "asset %s has invalid magic %02x%02x", name.c_str(), data[0], data[1]);
        return false;
    }

    ptr  = static_cast<void*>(const_cast<char*>(data + 2));
    size = asset->second.size;
    return true;
}
