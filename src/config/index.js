import 'dotenv/config';

export const config = {
  port: process.env.PORT || 3000,
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '',
  simulation: {
    transformerMva: Number(process.env.TRANSFORMER_MVA || 50),
    limitPercent: Number(process.env.LIMIT_PERCENT || 80),
    defaultSpeedMs: Number(process.env.SIMULATION_INTERVAL_MS || 2000),
  },
};
