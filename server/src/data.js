// Seed catalog for the demo store: kirana staples + bakery + slow-moving apparel.
// `vel` is a 24-point hourly velocity curve (units/hr) used by the AI feature builder.

const PEAK = [0, 0, 0, 0, 0, 1, 3, 6, 8, 7, 5, 4, 5, 6, 7, 9, 12, 15, 14, 11, 8, 5, 3, 1];

function vel(scale, spikeEvening = 0) {
  return PEAK.map((v, h) => +(v * scale * (1 + (h >= 17 && h <= 20 ? spikeEvening : 0))).toFixed(2));
}

export const CATALOG = [
  { id: 'SKU_MILK_TONED_1L',      name: 'Toned Milk 1L',          hi: 'टोन्ड दूध 1 ली',       cat: 'dairy',   price: 66,   cost: 58,  stock: 12, shelfLifeH: 12,  ageH: 7.5,  turnDays: 1,  emoji: '🥛', vel: vel(0.9, 0.2) },
  { id: 'SKU_MILK_FULLCREAM_500', name: 'Full-Cream Milk 500ml',  hi: 'फुल-क्रिम दूध 500 मि.',  cat: 'dairy',   price: 42,   cost: 36,  stock: 8,  shelfLifeH: 14,  ageH: 9.0,  turnDays: 1,  emoji: '🥛', vel: vel(0.7, 0.2) },
  { id: 'SKU_BREAD_WHOLE_GRAIN',  name: 'Whole-Grain Bread',      hi: 'फाइबर ब्रेड',           cat: 'bakery',  price: 45,   cost: 30,  stock: 9,  shelfLifeH: 8,   ageH: 4.2,  turnDays: 1,  emoji: '🍞', vel: vel(0.8, 0.5) },
  { id: 'SKU_CROISSANT_BUTTER',   name: 'Butter Croissant',       hi: 'बटर क्रुअासॉन',           cat: 'bakery',  price: 60,   cost: 38,  stock: 6,  shelfLifeH: 6,   ageH: 3.4,  turnDays: 1,  emoji: '🥐', vel: vel(0.5, 0.6) },
  { id: 'SKU_TART_CHOCO_EGG',     name: 'Choco-Egg Tart (4 pc)',  hi: 'चॉको-एग टार्ट',           cat: 'bakery',  price: 55,   cost: 34,  stock: 7,  shelfLifeH: 6,   ageH: 3.8,  turnDays: 1,  emoji: '🥧', vel: vel(0.55, 0.4) },
  { id: 'SKU_SANDWICH_CHEESE',    name: 'Cheese Sandwich',        hi: 'चিজ सैंडविच',             cat: 'bakery',  price: 80,   cost: 48,  stock: 10, shelfLifeH: 5,   ageH: 2.5,  turnDays: 1,  emoji: '🥪', vel: vel(0.7, 0.7) },
  { id: 'SKU_EGGS_12PC',          name: 'Eggs (12 pack)',         hi: 'अंडा (12 पैक)',            cat: 'staple',  price: 96,   cost: 84,  stock: 15, shelfLifeH: null,ageH: 26,   turnDays: 2,  emoji: '🥚', vel: vel(0.45, 0.1) },
  { id: 'SKU_CHAI_LEAF_250G',     name: 'Chai Leaves 250g',       hi: 'चाय पत्ती 250 ग्राम',       cat: 'grocery', price: 145,  cost: 112, stock: 20, shelfLifeH: null,ageH: 310,  turnDays: 38, emoji: '☕', vel: vel(0.3, 0.3) },
  { id: 'SKU_BISCUIT_GOLDEN',     name: 'Golden Biscuits 200g',   hi: 'गोल्डन बिस्कुट',           cat: 'grocery', price: 55,   cost: 41,  stock: 24, shelfLifeH: null,ageH: 190,  turnDays: 22, emoji: '🍪', vel: vel(0.4, 0.2) },
  { id: 'SKU_NOODLES_MASALA',     name: 'Masala Noodles (4 pack)',hi: 'मसाला नूडल्स',             cat: 'grocery', price: 99,   cost: 74,  stock: 18, shelfLifeH: null,ageH: 240,  turnDays: 18, emoji: '🍜', vel: vel(0.45, 0.3) },
  { id: 'SKU_GHEE_1L',            name: 'Pure Ghee 1L',           hi: 'खुद्द घी 1 ली',            cat: 'grocery', price: 599,  cost: 512, stock: 6,  shelfLifeH: null,ageH: 900,  turnDays: 40, emoji: '🧈', vel: vel(0.15, 0.2) },
  { id: 'SKU_RICE_10KG',          name: 'Basmati Rice 10kg',      hi: 'बासमती चावल 10 किलो',      cat: 'grocery', price: 520,  cost: 455, stock: 5,  shelfLifeH: null,ageH: 700,  turnDays: 30, emoji: '🍚', vel: vel(0.12, 0.1) },
  { id: 'SKU_KURTA_COTTON_M',     name: 'Cotton Kurta (Blue, M)', hi: 'कॉटन कमीज़ (नीला, M)',      cat: 'apparel', price: 499,  cost: 320, stock: 4,  shelfLifeH: null,ageH: 1250, turnDays: 52, emoji: '👕', vel: vel(0.05, 0.4) },
  { id: 'SKU_SHIRT_LINEN_FS',     name: 'Linen Shirt (Free size)',hi: 'लिनन शर्ट (फ्री साइज़)',     cat: 'apparel', price: 899,  cost: 560, stock: 3,  shelfLifeH: null,ageH: 1470, turnDays: 61, emoji: '👔', vel: vel(0.04, 0.5) },
];

export const byId = Object.fromEntries(CATALOG.map((s) => [s.id, s]));

export function alternativesFor(sku, stockMap, exclude = []) {
  return CATALOG.filter(
    (s) =>
      s.id !== sku.id &&
      s.cat === sku.cat &&
      !exclude.includes(s.id) &&
      (stockMap[s.id] ?? 0) > 0
  )
    .sort((a, b) => a.price - b.price)
    .slice(0, 3)
    .map((s) => ({
      skuId: s.id, name: s.name, hi: s.hi, price: s.price, stock: stockMap[s.id], emoji: s.emoji,
    }));
}
