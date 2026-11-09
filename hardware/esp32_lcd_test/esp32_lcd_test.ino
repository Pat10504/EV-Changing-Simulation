#include <Wire.h>
#include <LiquidCrystal_I2C.h>

const int LCD_ADDRESS = 0x27;
const int LCD_COLUMNS = 16;
const int LCD_ROWS = 2;
const int SDA_PIN = 21;
const int SCL_PIN = 22;

LiquidCrystal_I2C lcd(LCD_ADDRESS, LCD_COLUMNS, LCD_ROWS);

void setup() {
  Serial.begin(115200);
  Wire.begin(SDA_PIN, SCL_PIN);

  lcd.init();
  lcd.backlight();
  lcd.clear();

  lcd.setCursor(0, 0);
  lcd.print("EV Charging");
  lcd.setCursor(0, 1);
  lcd.print("LCD OK 0x27");

  Serial.println("LCD test started at address 0x27");
}

void loop() {
  static unsigned long lastUpdate = 0;
  static int counter = 0;

  if (millis() - lastUpdate >= 1000) {
    lastUpdate = millis();
    counter++;

    lcd.setCursor(11, 1);
    lcd.print("     ");
    lcd.setCursor(11, 1);
    lcd.print(counter);

    Serial.print("LCD counter: ");
    Serial.println(counter);
  }
}
