#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <LiquidCrystal_I2C.h>
#include "secrets.h"

const int LCD_ADDRESS = 0x27;
const int LCD_COLUMNS = 16;
const int LCD_ROWS = 2;
const int SDA_PIN = 21;
const int SCL_PIN = 22;
const unsigned long DEFAULT_POLL_INTERVAL_MS = 1000;
const unsigned long MIN_POLL_INTERVAL_MS = 300;
const unsigned long MAX_POLL_INTERVAL_MS = 5000;

LiquidCrystal_I2C lcd(LCD_ADDRESS, LCD_COLUMNS, LCD_ROWS);

unsigned long lastPoll = 0;
unsigned long pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;

void setup() {
  Serial.begin(115200);
  Wire.begin(SDA_PIN, SCL_PIN);

  lcd.init();
  lcd.backlight();
  showLines("EV Charging", "WiFi connecting");

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.print("WiFi connected. IP: ");
  Serial.println(WiFi.localIP());
  showLines("WiFi connected", WiFi.localIP().toString());
  delay(1200);
}

void loop() {
  if (millis() - lastPoll < pollIntervalMs) {
    return;
  }

  lastPoll = millis();

  if (WiFi.status() != WL_CONNECTED) {
    showLines("WiFi lost", "Reconnecting...");
    WiFi.reconnect();
    return;
  }

  fetchAndDisplay();
}

void fetchAndDisplay() {
  HTTPClient http;
  http.begin(API_URL);
  int httpCode = http.GET();

  if (httpCode != HTTP_CODE_OK) {
    Serial.print("HTTP error: ");
    Serial.println(httpCode);
    showLines("HTTP error", String(httpCode));
    http.end();
    return;
  }

  String payload = http.getString();
  http.end();

  StaticJsonDocument<768> doc;
  DeserializationError error = deserializeJson(doc, payload);
  if (error) {
    Serial.print("JSON error: ");
    Serial.println(error.c_str());
    showLines("JSON error", error.c_str());
    return;
  }

  bool hasData = doc["has_data"] | false;
  if (!hasData) {
    showLines("Waiting data", "Start dashboard");
    return;
  }

  bool running = doc["running"] | false;
  pollIntervalMs = getPollInterval(doc["interval_ms"] | DEFAULT_POLL_INTERVAL_MS);
  const char* status = doc["status"] | "NO_DATA";
  const char* timeSlot = doc["time"] | "--:--";
  int pwm = doc["pwm"] | 0;
  float loadPercent = doc["total_load_percent"] | 0.0;
  float reduceKw = doc["reduce_per_charger_kW"] | 0.0;
  bool controlLimited = doc["control_limited"] | false;
  bool redistributionApplied = doc["redistribution_applied"] | false;

  if (!running) {
    Serial.print("Paused. Last status=");
    Serial.print(status);
    Serial.print(" PWM=");
    Serial.print(pwm);
    Serial.print(" Load=");
    Serial.println(loadPercent);

    showLines(
      "PAUSED PWM:" + String(pwm),
      "Load " + String(loadPercent, 1) + "%"
    );
    return;
  }

  Serial.print("Status=");
  Serial.print(status);
  Serial.print(" PWM=");
  Serial.print(pwm);
  Serial.print(" Load=");
  Serial.print(loadPercent);
  Serial.print(" Interval=");
  Serial.println(pollIntervalMs);

  renderDashboard(status, timeSlot, pwm, loadPercent, reduceKw, controlLimited, redistributionApplied);
}

unsigned long getPollInterval(unsigned long value) {
  if (value < MIN_POLL_INTERVAL_MS) return MIN_POLL_INTERVAL_MS;
  if (value > MAX_POLL_INTERVAL_MS) return MAX_POLL_INTERVAL_MS;
  return value;
}

String shortStatus(const char* status) {
  String value = String(status);
  if (value == "NORMAL") return "NORMAL";
  if (value == "WARNING") return "WARN";
  if (value == "OVERLOAD") return "OVR";
  return "NO DATA";
}

void renderDashboard(
  const char* status,
  const char* timeSlot,
  int pwm,
  float loadPercent,
  float reduceKw,
  bool controlLimited,
  bool redistributionApplied
) {
  String statusText = shortStatus(status);

  if (statusText == "OVR") {
    String line2 = controlLimited
      ? "MIN20 LIMIT"
      : redistributionApplied
        ? "MIN20 REDIST"
        : "Load" + String(loadPercent, 1) + "% Cut" + String(reduceKw, 1);
    showLines(
      "OVR " + String(timeSlot) + " P:" + String(pwm),
      line2
    );
    return;
  }

  showLines(
    statusText + " " + String(timeSlot) + " P:" + String(pwm),
    "Load " + String(loadPercent, 1) + "%"
  );
}

void showLines(String line1, String line2) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(fitLcd(line1));
  lcd.setCursor(0, 1);
  lcd.print(fitLcd(line2));
}

String fitLcd(String text) {
  if (text.length() > LCD_COLUMNS) {
    return text.substring(0, LCD_COLUMNS);
  }
  while (text.length() < LCD_COLUMNS) {
    text += " ";
  }
  return text;
}
