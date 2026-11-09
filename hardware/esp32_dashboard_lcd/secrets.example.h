#pragma once

// Copy this file to secrets.h and set the values for your local network.
// secrets.h is ignored by Git.
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Use the backend computer's LAN IP address, not localhost.
const char* API_URL = "http://192.168.1.100:3000/api/hardware/latest";
