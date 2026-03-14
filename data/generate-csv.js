import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Pattern การใช้งานตู้ชาร์จตลอดวัน
// หม้อแปลง 50 MVA, limit 80% = 40,000 kW, base load 65% = 32,500 kW
// NORMAL   < 80% → ev_load < 7,500 kW
// WARNING  80-90% → ev_load 7,500-12,500 kW
// OVERLOAD > 90% → ev_load > 12,500 kW

function getActive(hour) {
  if (hour >= 0 && hour < 6)   return { w50: 10,  w150: 2  };  // ดึก: NORMAL
  if (hour >= 6 && hour < 9)   return { w50: 60,  w150: 10 };  // เช้า: NORMAL
  if (hour >= 9 && hour < 12)  return { w50: 80,  w150: 15 };  // สาย: NORMAL
  if (hour >= 12 && hour < 14) return { w50: 100, w150: 20 };  // เที่ยง: WARNING
  if (hour >= 14 && hour < 17) return { w50: 80,  w150: 15 };  // บ่าย: NORMAL
  if (hour >= 17 && hour < 21) return { w50: 300, w150: 70 };  // เย็น: OVERLOAD
  if (hour >= 21 && hour < 23) return { w50: 80,  w150: 15 };  // ค่ำ: NORMAL
  return { w50: 20, w150: 3 };                                  // ดึก: NORMAL
}

const rows = ['time,active_50kW,active_150kW'];

for (let slot = 0; slot < 288; slot++) {
  const totalMinutes = slot * 5;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const { w50, w150 } = getActive(hour);
  rows.push(`${time},${w50},${w150}`);
}

const outputPath = join(__dirname, 'ev_charging.csv');
writeFileSync(outputPath, rows.join('\n'));
console.log(`Generated ${rows.length - 1} records → ${outputPath}`);
