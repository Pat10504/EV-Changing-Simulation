// Q22-PP0827A01: [elapsed hours, ambient °C, top-oil °C] at reported readings.
export const heatRuns = {
  30: {
    page: 'A13.2', startHour: 21, referenceHour: 11, hvRise: 43.1, lvRise: 44.1,
    coolingNote: 'เปิดวาล์วหม้อน้ำทั้งหมดเวลา 02:00',
    samples: [
      [0,28.0,34.9], [1,28.0,42.1], [2,28.0,50.2], [3,28.2,57.9],
      [4,28.2,63.9], [5,28.4,69.8], [6,28.5,70.2], [7,28.5,69.5],
      [8,28.6,69.7], [9,28.7,69.8], [10,28.9,70.3], [11,29.1,70.5], [12,29.1,68.8],
    ],
  },
  40: {
    page: 'A13.6', startHour: 9.5, referenceHour: 4.5, hvRise: 44.7, lvRise: 45.4,
    coolingNote: 'เปิดพัดลม 2 ตัวตั้งแต่ 10:00 ถึง 15:00',
    samples: [
      [0,29.1,67.8], [0.5,29.3,69.8], [1.5,29.8,72.5], [2.5,30.4,73.0],
      [3.5,30.7,73.1], [4.5,31.0,73.4], [5.5,31.4,72.0],
    ],
  },
  50: {
    page: 'A13.10', startHour: 21, referenceHour: 11, hvRise: 47.0, lvRise: 48.0,
    coolingNote: 'เปิดพัดลม 4 ตัวตลอดการทดสอบ',
    samples: [
      [0,31.1,30.5], [1,31.1,47.6], [2,31.0,59.1], [3,31.1,66.1],
      [4,30.4,69.8], [5,30.3,71.4], [6,30.2,72.7], [7,30.1,73.6],
      [8,30.2,74.3], [11,30.4,75.4], [12,30.2,74.1],
    ],
  },
}

export function referenceSample(heatRun) {
  return heatRun.samples.find(([hour]) => hour === heatRun.referenceHour)
}

export function clockTime(start, elapsed) {
  const minutes = Math.round((start + elapsed) * 60) % 1440
  return [Math.floor(minutes / 60), minutes % 60].map(n => String(n).padStart(2, '0')).join(':')
}
