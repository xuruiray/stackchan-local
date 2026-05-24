#pragma once

#include <cstddef>
#include <cstdint>
#include <map>
#include <string>

#include <esp_partition.h>
#include <spi_flash_mmap.h>

struct Asset {
    size_t size   = 0;
    size_t offset = 0;
};

class Assets {
public:
    static Assets& GetInstance()
    {
        static Assets instance;
        return instance;
    }

    ~Assets();

    bool GetAssetData(const std::string& name, void*& ptr, size_t& size);
    bool partition_valid() const { return partition_valid_; }

private:
    Assets();
    Assets(const Assets&)            = delete;
    Assets& operator=(const Assets&) = delete;

    bool InitializePartition();
    void UnmapPartition();
    static uint32_t CalculateChecksum(const char* data, uint32_t length);

    const esp_partition_t* partition_              = nullptr;
    esp_partition_mmap_handle_t mmap_handle_       = 0;
    const char* mmap_root_                         = nullptr;
    bool partition_valid_                          = false;
    bool checksum_valid_                           = false;
    std::map<std::string, Asset> assets_;
};
