export const CONFIG = {
  PORT: Number(process.env.PORT || 8080),
  AI_URL: process.env.AI_URL || 'http://127.0.0.1:8001',
  HMAC_SECRET: process.env.HMAC_SECRET || 'setu-demo-hmac-v1',
  MERCHANT: {
    id: 'MERCHANT_PAYTM_99482',
    name: 'Sharma General Store',
    nameHi: 'शर्मा जनरल स्टोर',
    locality: 'Rajendra Nagar, Patna (Tier-2 demo store)',
    posDevice: 'PAYTM_SMART_POS_01',
    soundbox: 'PAYTM_SOUNDBOX_01',
    nearMeRadiusKm: 1.5,
  },
  RESERVATION_TTL_SECONDS: 90,
  CLOSE_HOUR: 22.5,
};
