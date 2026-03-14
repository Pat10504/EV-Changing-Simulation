import 'dotenv/config';

export const config = {
  port: process.env.PORT || 3000,
  sheetsUrl: process.env.SHEETS_URL || '',
  serialPort: process.env.SERIAL_PORT || '',
};
