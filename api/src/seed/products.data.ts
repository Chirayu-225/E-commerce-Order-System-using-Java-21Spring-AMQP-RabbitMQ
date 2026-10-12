/** Fictional brands only.  Prices in paise (INR minor units). */
export interface SeedProduct {
  sku: string; name: string; brand: string; category: string; description: string;
  price: number; mrp: number; rating: number; ratings: number; hue: number; stock: number;
}
const r = (n: number) => n * 100;
export const PRODUCTS: SeedProduct[] = [
  // Audio
  { sku: 'AUD-001', name: 'Aurora Pro ANC Wireless Headphones', brand: 'Aurora', category: 'Audio', description: 'Over-ear headphones with hybrid active noise cancellation, 40-hour battery and multipoint Bluetooth.', price: r(7999), mrp: r(14999), rating: 4.5, ratings: 18420, hue: 262, stock: 400 },
  { sku: 'AUD-002', name: 'Nimbus Buds 2 True Wireless Earbuds', brand: 'Nimbus', category: 'Audio', description: 'Compact earbuds with 12mm drivers, low-latency gaming mode and IPX5 sweat resistance.', price: r(1499), mrp: r(3999), rating: 4.2, ratings: 52310, hue: 200, stock: 1200 },
  { sku: 'AUD-003', name: 'Boomer Mini Portable Speaker', brand: 'Boomer', category: 'Audio', description: 'Pocket Bluetooth speaker with 360-degree sound and 15 hours of playtime.', price: r(1999), mrp: r(3499), rating: 4.3, ratings: 9210, hue: 14, stock: 600 },
  { sku: 'AUD-004', name: 'Studio One Wired Monitor Headphones', brand: 'Studio One', category: 'Audio', description: 'Flat-response studio headphones with detachable cable and replaceable ear pads.', price: r(4499), mrp: r(6999), rating: 4.6, ratings: 3120, hue: 340, stock: 250 },
  // Wearables
  { sku: 'WEA-001', name: 'Pulse Watch S3 Smartwatch', brand: 'Pulse', category: 'Wearables', description: '1.8-inch AMOLED display, heart-rate and SpO2 tracking, 7-day battery, built-in GPS.', price: r(3499), mrp: r(8999), rating: 4.1, ratings: 27540, hue: 160, stock: 800 },
  { sku: 'WEA-002', name: 'Stride Band 5 Fitness Tracker', brand: 'Stride', category: 'Wearables', description: 'Slim fitness band with sleep tracking, 14-day battery and 100+ workout modes.', price: r(1299), mrp: r(2999), rating: 4.0, ratings: 41200, hue: 120, stock: 1500 },
  { sku: 'WEA-003', name: 'Orbit Ring Smart Ring', brand: 'Orbit', category: 'Wearables', description: 'Titanium smart ring for sleep, readiness and temperature trends. No subscription.', price: r(8999), mrp: r(12999), rating: 4.4, ratings: 1860, hue: 40, stock: 150 },
  // Mobiles
  { sku: 'MOB-001', name: 'Zenith X12 5G (8GB/128GB)', brand: 'Zenith', category: 'Mobiles', description: '6.67-inch 120Hz AMOLED, 50MP OIS camera, 5000mAh battery with 67W fast charging.', price: r(18999), mrp: r(24999), rating: 4.4, ratings: 88200, hue: 215, stock: 500 },
  { sku: 'MOB-002', name: 'Vertex Lite 5G (6GB/128GB)', brand: 'Vertex', category: 'Mobiles', description: 'Slim 5G phone with a 6.5-inch display, dual cameras and all-day battery.', price: r(11499), mrp: r(14999), rating: 4.2, ratings: 120400, hue: 190, stock: 700 },
  { sku: 'MOB-003', name: 'Zenith Ultra 5G (12GB/256GB)', brand: 'Zenith', category: 'Mobiles', description: 'Flagship-class 200MP camera, Snapdragon-class chipset, vapour-chamber cooling.', price: r(44999), mrp: r(59999), rating: 4.6, ratings: 14230, hue: 280, stock: 200 },
  // Laptops
  { sku: 'LAP-001', name: 'Atlas Book 14 Thin & Light (16GB/512GB)', brand: 'Atlas', category: 'Laptops', description: '14-inch 2.2K display, 12-core processor, 18-hour battery, 1.3 kg aluminium body.', price: r(52990), mrp: r(74990), rating: 4.4, ratings: 6120, hue: 230, stock: 180 },
  { sku: 'LAP-002', name: 'Forge G15 Gaming Laptop (RTX-class GPU)', brand: 'Forge', category: 'Laptops', description: '15.6-inch 165Hz display, 16GB RAM, 1TB SSD, per-key RGB keyboard and dual-fan cooling.', price: r(78990), mrp: r(104990), rating: 4.5, ratings: 3890, hue: 5, stock: 120 },
  { sku: 'LAP-003', name: 'Clerk Air 13 Student Laptop', brand: 'Clerk', category: 'Laptops', description: 'Light 13-inch laptop with 8GB RAM, 256GB SSD and a full-size backlit keyboard.', price: r(31990), mrp: r(42990), rating: 4.1, ratings: 9820, hue: 175, stock: 300 },
  // Home
  { sku: 'HOM-001', name: 'Brew Master Drip Coffee Maker', brand: 'Brew Master', category: 'Home', description: '1.2L programmable coffee maker with reusable filter and keep-warm plate.', price: r(2799), mrp: r(4999), rating: 4.3, ratings: 7410, hue: 25, stock: 350 },
  { sku: 'HOM-002', name: 'AirFry 6L Digital Air Fryer', brand: 'AirFry', category: 'Home', description: 'Rapid-air circulation, 8 presets, touch controls and dishwasher-safe basket.', price: r(4299), mrp: r(8499), rating: 4.4, ratings: 33210, hue: 50, stock: 450 },
  { sku: 'HOM-003', name: 'Dustless V8 Cordless Vacuum', brand: 'Dustless', category: 'Home', description: 'Cordless stick vacuum with 45-minute runtime, HEPA filter and wall dock.', price: r(9999), mrp: r(17999), rating: 4.2, ratings: 5120, hue: 300, stock: 220 },
  { sku: 'HOM-004', name: 'Lumen Smart LED Bulb (Pack of 4)', brand: 'Lumen', category: 'Home', description: 'Wi-Fi bulbs with 16 million colours, schedules and voice-assistant support.', price: r(1199), mrp: r(2999), rating: 4.0, ratings: 19800, hue: 90, stock: 2000 },
  // Fashion
  { sku: 'FAS-001', name: 'Trail Runner Cushioned Running Shoes', brand: 'Trailhead', category: 'Fashion', description: 'Breathable mesh upper with responsive foam midsole and grippy outsole.', price: r(2499), mrp: r(5999), rating: 4.2, ratings: 28900, hue: 150, stock: 900 },
  { sku: 'FAS-002', name: 'Heritage Leather Slim Wallet', brand: 'Heritage', category: 'Fashion', description: 'Full-grain leather bifold with RFID shield and 8 card slots.', price: r(799), mrp: r(1999), rating: 4.3, ratings: 15400, hue: 30, stock: 1100 },
  { sku: 'FAS-003', name: 'Urbanite 28L Laptop Backpack', brand: 'Urbanite', category: 'Fashion', description: 'Water-resistant commuter backpack with padded laptop sleeve and USB charging port.', price: r(1399), mrp: r(2999), rating: 4.4, ratings: 21700, hue: 205, stock: 700 },
  // Gaming
  { sku: 'GAM-001', name: 'Vortex Pro Wireless Gaming Controller', brand: 'Vortex', category: 'Gaming', description: 'Hall-effect sticks, 40-hour battery and remappable back paddles. PC and mobile.', price: r(3999), mrp: r(6499), rating: 4.5, ratings: 4310, hue: 320, stock: 300 },
  { sku: 'GAM-002', name: 'Keystone TKL Mechanical Keyboard', brand: 'Keystone', category: 'Gaming', description: 'Hot-swappable tenkeyless keyboard with gasket mount and per-key RGB.', price: r(4999), mrp: r(8999), rating: 4.5, ratings: 6720, hue: 250, stock: 320 },
  { sku: 'GAM-003', name: 'Swift Z Ultra-Light Gaming Mouse', brand: 'Swift', category: 'Gaming', description: '58g wireless mouse with a 26K DPI sensor and 70-hour battery.', price: r(2999), mrp: r(5499), rating: 4.4, ratings: 8940, hue: 185, stock: 400 },
  { sku: 'GAM-004', name: 'Nexus Console X (1TB Digital Edition)', brand: 'Nexus', category: 'Gaming', description: 'Next-gen digital console with 4K 120fps support, 1TB SSD and one controller.', price: r(36990), mrp: r(42990), rating: 4.7, ratings: 11200, hue: 235, stock: 200 },
];

/** Products used for the rotating demo flash sales. */
export const FLASH_SKUS = ['MOB-001', 'AUD-001', 'GAM-004', 'LAP-001'];
/** Product behind the pre-ended, sold-out sale in the demo data. */
export const ENDED_SALE_SKU = 'WEA-003';
