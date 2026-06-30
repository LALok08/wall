/**
 * KMK Digital Twin Campus — REAL GIS data generator (v3)
 * ─────────────────────────────────────────────────────────────────────────────
 * Source maps:
 *   - Satellite imagery (building footprints, orientation)
 *   - Pelan Aliran Trafik & Parkir MPPB 2026/2027 (names, roads, parking)
 *   - DXF vector outline (proportions)
 *
 * v3 improvements (per user request):
 *   1. REALISTIC SIZES — every building scaled to real-world footprint.
 *      Masjid is a proper landmark (large + dome + minaret), not a tiny box.
 *      Dewan Mahawangsa is the biggest hall. Hostels are long multi-wing slabs.
 *   2. COURTYARDS / VOIDS — buildings can have polygon "holes" so the
 *      3D extrude shows an open-air inner courtyard (天井/中庭).
 *   3. CORRIDORS — thin connecting links ("selasar") between blocks.
 *
 * Coordinate system: local ENU metres. Origin [0,0] = entrance roundabout.
 * X = East (+right on map), Z = South (+down on map), Y = height up.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "src", "gis");
mkdirSync(OUT, { recursive: true });

const FLOOR_H = 3.6; // metres per storey (realistic)

// ─────────────────────────────────────────────────────────────────────────────
// Geometry helpers
// ─────────────────────────────────────────────────────────────────────────────
function rect(cx, cz, w, d, rot = 0) {
  const r = (rot * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  const hw = w / 2, hd = d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, z]) => [
    +(cx + x * cos - z * sin).toFixed(1),
    +(cz + x * sin + z * cos).toFixed(1),
  ]);
}

// Rectangle with a rectangular courtyard hole (open-air middle).
// Returns { polygon, holes:[[...]] }
function rectWithCourtyard(cx, cz, w, d, courtFrac = 0.45, rot = 0) {
  const outer = rect(cx, cz, w, d, rot);
  const inner = rect(cx, cz, w * courtFrac, d * courtFrac, rot);
  // hole winding must be opposite for Three.Shape; we store as-is and let renderer handle
  return { polygon: outer, holes: [inner] };
}

// U-shaped / E-shaped slab approximated by outer rect + 1-2 holes opening to one side.
// side: "north" | "south" | "east" | "west" — which edge the courtyard opens toward
function rectWithOpenCourt(cx, cz, w, d, side = "south", courtW = 0.5, courtD = 0.55) {
  const outer = rect(cx, cz, w, d);
  const cw = w * courtW;
  const cd = d * courtD;
  // push the hole toward the open side so it breaks the outer ring visually we
  // instead keep it as an internal void offset toward `side`
  let ox = 0, oz = 0;
  const gap = Math.min(w, d) * 0.08;
  if (side === "south") oz = (d - cd) / 2 - gap;
  if (side === "north") oz = -((d - cd) / 2 - gap);
  if (side === "east")  ox = (w - cw) / 2 - gap;
  if (side === "west")  ox = -((w - cw) / 2 - gap);
  const inner = rect(cx + ox, cz + oz, cw, cd);
  return { polygon: outer, holes: [inner] };
}

function polyCenter(poly) {
  const n = poly.length;
  return [
    +(poly.reduce((s, p) => s + p[0], 0) / n).toFixed(1),
    +(poly.reduce((s, p) => s + p[1], 0) / n).toFixed(1),
  ];
}
function polyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    a += x1 * z2 - x2 * z1;
  }
  return Math.abs(a / 2);
}
function bbox(poly) {
  return [
    Math.min(...poly.map(p => p[0])),
    Math.min(...poly.map(p => p[1])),
    Math.max(...poly.map(p => p[0])),
    Math.max(...poly.map(p => p[1])),
  ].map(n => +n.toFixed(1));
}

// ─────────────────────────────────────────────────────────────────────────────
// Building factory
//   shape: { polygon, holes? }  OR  pass cx,cz,w,d for a simple rect
//   features: { dome, minaret, atriumOpen } for special rendering hints
// ─────────────────────────────────────────────────────────────────────────────
const buildings = [];
const metadataMap = {};

function addBuilding(opts) {
  const {
    id, name, category, color, floors, emoji,
    shape, rot = 0, features = {}, meta = {},
  } = opts;

  const polygon = shape.polygon;
  const holes = shape.holes || [];
  const center = polyCenter(polygon);
  const height = features.parking ? 0.18 : +(floors * FLOOR_H).toFixed(1);

  // net area = outer minus holes
  let area = polyArea(polygon);
  holes.forEach(h => { area -= polyArea(h); });

  buildings.push({
    id, name, category, color,
    polygon,
    holes,                       // ← NEW: courtyard voids
    center,
    height,
    rotation: rot,
    floors,
    area: +area.toFixed(1),
    bbox: bbox(polygon),
    features,                    // ← NEW: { dome, minaret, corridor }
  });

  metadataMap[id] = {
    name, emoji,
    description: meta.description || name,
    tags: meta.tags || [],
    floors,
    hours: meta.hours || "Isnin–Jumaat 08:00–17:00",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY COLOURS
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  admin:       "#7d8aa3",
  academic:    "#6b7fd7",
  dewan:       "#d99a3d",
  masjid:      "#3fa873",
  library:     "#e0a040",
  residence_m: "#5b9bd5",
  residence_f: "#e8557a",
  cafe:        "#e0795b",
  sports:      "#56b87e",
  koop:        "#56a7c4",
  guard:       "#7d8aa3",
  staff_house: "#b08bd6",
  parking:     "#8f97a3",
};

// ═════════════════════════════════════════════════════════════════════════════
//  BUILDINGS — REALISTIC SCALE
//  Reference real-world footprints (metres):
//    Masjid (with dome)        ~45 × 45  (landmark, tall)
//    Dewan Mahawangsa (hall)   ~85 × 60  (biggest single roof)
//    Hostel blocks (5-6 flr)   ~75 × 22 wings, with inner courtyard
//    Academic blocks (3 flr)   ~90 × 30 with corridor courtyard
//    Library                   ~55 × 42
//    Cafe                      ~45 × 26
//    Guard house               ~10 × 8
// ═════════════════════════════════════════════════════════════════════════════

// ── ENTRANCE / GUARD ─────────────────────────────────────────────────────────
addBuilding({
  id: "B_GUARD", name: "Pondok Pengawal", category: "guard", color: C.guard,
  floors: 1, emoji: "🛡️", shape: { polygon: rect(-300, 0, 12, 9) },
  meta: { description: "Pondok pengawal pintu masuk utama kampus KMK. Semua kenderaan mesti mendapat kebenaran.", tags: ["keselamatan","masuk","keluar"], hours: "24 jam" },
});

// ── NORTH SPORTS ZONE ────────────────────────────────────────────────────────
addBuilding({
  id: "B_ASTAKA", name: "Astaka", category: "sports", color: C.sports,
  floors: 2, emoji: "🏟️", shape: { polygon: rect(-235, -202, 55, 30) },
  meta: { description: "Astaka utama menghadap padang dan litar olahraga. Tempat perhimpunan dan acara sukan besar.", tags: ["sukan","astaka","perhimpunan"], hours: "06:00–22:00" },
});
addBuilding({
  id: "B_BBALL", name: "Gelanggang Bola Keranjang", category: "sports", color: C.sports,
  floors: 1, emoji: "🏀", shape: { polygon: rect(28, -200, 32, 19) },
  meta: { description: "Gelanggang bola keranjang & bola jaring terbuka.", tags: ["sukan","bola keranjang"], hours: "06:00–22:00" },
});
addBuilding({
  id: "B_GLG_TENIS", name: "Gelanggang Tenis", category: "sports", color: C.sports,
  floors: 1, emoji: "🎾", shape: { polygon: rect(-160, -200, 36, 22) },
  meta: { description: "Gelanggang tenis kampus.", tags: ["sukan","tenis"], hours: "06:00–22:00" },
});
addBuilding({
  id: "B_GLG_TENIS_E", name: "Gelanggang Tenis (Timur)", category: "sports", color: C.sports,
  floors: 1, emoji: "🎾", shape: { polygon: rect(205, -150, 30, 20) },
  meta: { description: "Gelanggang tenis di zon timur, berdekatan blok kediaman C.", tags: ["sukan","tenis"], hours: "06:00–22:00" },
});
addBuilding({
  id: "B_VOLLEY", name: "Gelanggang Bola Tampar / Sepak Takraw", category: "sports", color: C.sports,
  floors: 1, emoji: "🏐", shape: { polygon: rect(-248, -150, 38, 22) },
  meta: { description: "Kawasan bola tampar / sepak takraw di sebelah gelanggang tenis barat, seperti ditanda '排球' pada peta.", tags: ["bola tampar","sepak takraw","sukan"], hours: "06:00–22:00" },
});
addBuilding({
  id: "B_FUTSAL", name: "Gelanggang Futsal / Badminton Outdoor", category: "sports", color: C.sports,
  floors: 1, emoji: "⚽", shape: { polygon: rect(18, -162, 42, 28) },
  meta: { description: "Gelanggang kecil berhampiran Padang dan Gelanggang Bola Keranjang; ditanda sebagai kawasan futsal/badminton/gelanggang pada peta satelit.", tags: ["futsal","badminton","sukan","gelanggang"], hours: "06:00–22:00" },
});

// ── DEWAN MAHAWANGSA — BIGGEST HALL ──────────────────────────────────────────
addBuilding({
  id: "B_DEWAN", name: "Dewan Mahawangsa", category: "dewan", color: C.dewan,
  floors: 2, emoji: "🎓",
  shape: { polygon: rect(90, -165, 88, 58) },
  features: { bigRoof: true },
  meta: {
    description: "Dewan utama dan terbesar di KMK. Bumbung tinggi tanpa tiang tengah. Digunakan untuk konvokesyen, perhimpunan besar, ceramah dan majlis rasmi kolej.",
    tags: ["dewan","majlis","konvokesyen","perhimpunan"], hours: "Mengikut acara · 08:00–22:00",
  },
});

addBuilding({
  id: "B_GARAJ", name: "Garaj Bas", category: "admin", color: "#9aa3b0",
  floors: 1, emoji: "🚌", shape: { polygon: rect(185, -180, 48, 28) },
  meta: { description: "Garaj dan tempat letak bas kolej.", tags: ["bas","pengangkutan"], hours: "06:00–22:00" },
});

// ── ADMIN — Bangunan Seri Jerai (with internal courtyard) ────────────────────
addBuilding({
  id: "B_SERI_JERAI", name: "Bangunan Seri Jerai (Pentadbiran)", category: "admin", color: C.admin,
  floors: 3, emoji: "🏛️",
  shape: rectWithCourtyard(-228, -78, 78, 46, 0.4),
  features: { corridor: true },
  meta: {
    description: "Bangunan pentadbiran utama KMK dengan laman dalaman (courtyard) terbuka. Menempatkan Pejabat Pengarah, HEP, UPP, kaunseling dan pejabat unit kolej.",
    tags: ["pentadbiran","pejabat","pengarah","HEP","kaunseling"], hours: "Isnin–Jumaat 08:00–17:00",
  },
});
addBuilding({
  id: "B_CAFE_ADMIN", name: "Cafe Admin", category: "cafe", color: C.cafe,
  floors: 1, emoji: "☕", shape: { polygon: rect(-158, -103, 32, 20) },
  meta: { description: "Kafeteria berhampiran blok pentadbiran. Tutup jam 3:00 petang.", tags: ["cafe","makanan","admin"], hours: "07:00–15:00 (tutup 3pm)" },
});
addBuilding({
  id: "B_DEWAN_BAIDURI", name: "Dewan Baiduri", category: "dewan", color: C.dewan,
  floors: 1, emoji: "🏛️", shape: { polygon: rect(-225, -34, 44, 28) },
  features: { bigRoof: true },
  meta: { description: "Dewan Baiduri, dewan kecil berhampiran Pejabat HEP/Kaunseling dan laluan masuk pentadbiran.", tags: ["dewan","baiduri","admin"], hours: "Mengikut acara" },
});
addBuilding({
  id: "B_HEP_KAUNSELING", name: "Pejabat HEP & Kaunseling", category: "admin", color: C.admin,
  floors: 2, emoji: "🧭", shape: { polygon: rect(-245, -80, 38, 28) },
  meta: { description: "Pejabat Hal Ehwal Pelajar dan unit kaunseling, seperti ditanda pada peta satelit.", tags: ["HEP","kaunseling","pelajar","admin"], hours: "Isnin–Jumaat 08:00–17:00" },
});

// ── ACADEMIC CORE (large blocks with corridor courtyards) ────────────────────
addBuilding({
  id: "B_DK", name: "Dewan Kuliah", category: "academic", color: C.academic,
  floors: 2, emoji: "📐",
  shape: rectWithOpenCourt(-165, 30, 62, 46, "south", 0.5, 0.45),
  features: { corridor: true },
  meta: { description: "Dewan kuliah utama untuk syarahan besar pelbagai modul sains dan sastera. Laman dalaman terbuka di tengah.", tags: ["kuliah","dewan kuliah"], hours: "Isnin–Sabtu 07:30–18:00" },
});
addBuilding({
  id: "B_TUTORIAL", name: "Makmal & Bilik Tutorial", category: "academic", color: C.academic,
  floors: 3, emoji: "🔬",
  shape: rectWithCourtyard(-78, 32, 96, 52, 0.42),
  features: { corridor: true },
  meta: {
    description: "Blok akademik terbesar — bilik tutorial (MB, MK, MF), makmal sains (Kimia, Fizik, Biologi), DKK dan DAS. Tiga tingkat mengelilingi laman dalaman terbuka dengan selasar berbumbung.",
    tags: ["tutorial","makmal","MB","MK","MF","DKK","DAS","sains"], hours: "Isnin–Sabtu 07:30–18:00",
  },
});

// ── MASJID — LANDMARK (large, dome + minaret) ────────────────────────────────
addBuilding({
  id: "B_MASJID", name: "Masjid KMK", category: "masjid", color: C.masjid,
  floors: 2, emoji: "🕌",
  shape: { polygon: rect(-25, 68, 46, 46) },
  features: { dome: true, minaret: true, domeRadius: 11, minaretHeight: 32 },
  meta: {
    description: "Masjid utama KMK — mercu tanda kampus dengan kubah besar dan menara (minaret). Ruang solat luas, tempat solat Jumaat, kuliah agama dan program keagamaan pelajar.",
    tags: ["masjid","solat","agama","kubah","minaret","jumaat"], hours: "24 jam · Solat Jumaat 12:45",
  },
});

addBuilding({
  id: "B_SERUMPUN", name: "Gerai Jualan / Serumpun", category: "cafe", color: C.cafe,
  floors: 1, emoji: "🍜", shape: { polygon: rect(-30, 108, 34, 16) },
  meta: { description: "Gerai jualan dan foodtruck berhampiran dataran pelajar (Serumpun).", tags: ["gerai","makanan","foodtruck"], hours: "07:00–21:00" },
});

// ── LIBRARY ──────────────────────────────────────────────────────────────────
addBuilding({
  id: "B_PUSTAKA", name: "Pustaka (Perpustakaan)", category: "library", color: C.library,
  floors: 3, emoji: "📚",
  shape: rectWithOpenCourt(-180, 100, 58, 44, "east", 0.4, 0.5),
  features: { corridor: true },
  meta: {
    description: "Perpustakaan utama KMK, tiga tingkat. Koleksi buku akademik, jurnal, bilik belajar berkumpulan, zon senyap dan ruang baca menghadap laman dalaman.",
    tags: ["perpustakaan","pustaka","buku","belajar","wifi"], hours: "Isnin–Khamis 08:30–21:30 · Sabtu 08:30–17:00",
  },
});
addBuilding({
  id: "B_POS_MIN", name: "Pejabat Pos & Mini Market", category: "koop", color: C.koop,
  floors: 1, emoji: "📮", shape: { polygon: rect(-245, 102, 30, 22) },
  meta: { description: "Pejabat pos kampus dan kedai serbaneka.", tags: ["pos","mini market","kedai"], hours: "Isnin–Sabtu 08:00–18:00" },
});
addBuilding({
  id: "B_KOOP", name: "Koperasi & Kedai Buku (Koop Mait)", category: "koop", color: C.koop,
  floors: 1, emoji: "🛒", shape: { polygon: rect(-180, 142, 46, 26) },
  meta: { description: "Koperasi Mait KMK — buku teks, alat tulis, seragam dan keperluan kampus.", tags: ["koperasi","koop","buku","seragam"], hours: "Isnin–Jumaat 08:30–17:30" },
});
addBuilding({
  id: "B_ATM", name: "ATM", category: "koop", color: C.koop,
  floors: 1, emoji: "🏧", shape: { polygon: rect(-243, 126, 10, 7) },
  meta: { description: "Mesin ATM kampus KMK.", tags: ["ATM","bank","wang"], hours: "24 jam" },
});

// ── BANGUNAN LANGKASUKA (academic, courtyard) ────────────────────────────────
addBuilding({
  id: "B_LANGKASUKA", name: "Bangunan Langkasuka", category: "academic", color: C.academic,
  floors: 3, emoji: "🏫",
  shape: rectWithCourtyard(-230, 152, 66, 44, 0.38),
  features: { corridor: true },
  meta: { description: "Bangunan Langkasuka — bilik kuliah tambahan, bilik pensyarah dan pejabat jabatan akademik mengelilingi laman dalaman.", tags: ["kuliah","pensyarah","jabatan"], hours: "Isnin–Sabtu 07:30–18:00" },
});

// ── MALE HOSTELS — BLOK A (long slabs with courtyard) ────────────────────────
addBuilding({
  id: "B_A1", name: "Blok A1 (Asrama Lelaki)", category: "residence_m", color: C.residence_m,
  floors: 5, emoji: "🛏️",
  shape: rectWithCourtyard(-128, 152, 70, 38, 0.45),
  features: { corridor: true },
  meta: {
    description: "Blok kediaman pelajar lelaki A1 — lima tingkat dengan laman dalaman terbuka dan selasar di setiap aras. Pendaftaran pelajar lelaki dijalankan di sini.",
    tags: ["asrama","lelaki","blok A1"], hours: "24 jam (residen sahaja)",
  },
});
addBuilding({
  id: "B_A2", name: "Blok A2 (Asrama Lelaki)", category: "residence_m", color: C.residence_m,
  floors: 5, emoji: "🛏️",
  shape: rectWithCourtyard(-55, 152, 70, 38, 0.45),
  features: { corridor: true },
  meta: { description: "Blok kediaman pelajar lelaki A2 — bersebelahan Blok A1 dan Kafe A.", tags: ["asrama","lelaki","blok A2"], hours: "24 jam (residen sahaja)" },
});
addBuilding({
  id: "B_BL", name: "Bangunan Langkasuka BL / Bilik Latihan", category: "academic", color: C.academic,
  floors: 2, emoji: "📋", shape: { polygon: rect(-238, 188, 40, 26) },
  meta: { description: "Blok BL — bilik latihan, ujian bertulis dan penilaian pelajar.", tags: ["latihan","ujian","penilaian"], hours: "Isnin–Sabtu 07:30–18:00" },
});
addBuilding({
  id: "B_KAFE_A", name: "Kafe A", category: "cafe", color: C.cafe,
  floors: 1, emoji: "🍽️", shape: { polygon: rect(-92, 200, 64, 26) },
  meta: { description: "Kafeteria utama zon pelajar lelaki (Blok A). Sarapan, makan tengahari dan malam.", tags: ["cafe","kafe","makanan"], hours: "06:30–21:30" },
});

// ── FEMALE HOSTELS — BLOK C / B / P (large slabs, courtyards) ────────────────
addBuilding({
  id: "B_C1", name: "Blok C1 (Asrama Perempuan)", category: "residence_f", color: C.residence_f,
  floors: 6, emoji: "🏠",
  shape: rectWithCourtyard(155, 30, 56, 56, 0.4),
  features: { corridor: true },
  meta: { description: "Blok kediaman pelajar perempuan C1 — enam tingkat dengan laman dalaman terbuka, berdekatan Kafe C.", tags: ["asrama","perempuan","blok C1"], hours: "24 jam (residen sahaja)" },
});
addBuilding({
  id: "B_C2", name: "Blok C2 (Asrama Perempuan)", category: "residence_f", color: C.residence_f,
  floors: 6, emoji: "🏠",
  shape: rectWithCourtyard(85, 32, 56, 56, 0.4),
  features: { corridor: true },
  meta: { description: "Blok kediaman pelajar perempuan C2 — pusat pendaftaran pelajar Blok B1, B2, C2 dan P5.", tags: ["asrama","perempuan","blok C2"], hours: "24 jam (residen sahaja)" },
});
addBuilding({
  id: "B_B1", name: "Blok B1 (Asrama Perempuan)", category: "residence_f", color: C.residence_f,
  floors: 5, emoji: "🏠",
  shape: rectWithCourtyard(88, 122, 58, 50, 0.4),
  features: { corridor: true },
  meta: { description: "Blok kediaman pelajar perempuan B1 — berdekatan Kafe B. Pusat pendaftaran terletak di sini.", tags: ["asrama","perempuan","blok B1"], hours: "24 jam (residen sahaja)" },
});
addBuilding({
  id: "B_B2", name: "Blok B2 (Asrama Perempuan)", category: "residence_f", color: C.residence_f,
  floors: 5, emoji: "🏠",
  shape: rectWithCourtyard(160, 122, 56, 50, 0.4),
  features: { corridor: true },
  meta: { description: "Blok kediaman pelajar perempuan B2.", tags: ["asrama","perempuan","blok B2"], hours: "24 jam (residen sahaja)" },
});
addBuilding({
  id: "B_KAFE_B", name: "Kafe B", category: "cafe", color: C.cafe,
  floors: 1, emoji: "🍽️", shape: { polygon: rect(95, 192, 66, 26) },
  meta: { description: "Kafeteria zon perempuan (Blok B). Tutup selepas 7:00 petang ('Cafe B路线').", tags: ["cafe","kafe","makanan","Cafe B"], hours: "06:30–19:00 (tutup 7pm)" },
});
addBuilding({
  id: "B_KAFE_C", name: "Kafe C", category: "cafe", color: C.cafe,
  floors: 1, emoji: "☕", shape: { polygon: rect(225, -70, 60, 26) },
  meta: { description: "Kafeteria zon C, berdekatan Blok C1/C2. Tutup selepas 7:00 petang ('Cafe C路线').", tags: ["cafe","kafe","Cafe C"], hours: "06:30–19:00 (tutup 7pm)" },
});
addBuilding({
  id: "B_DADDY", name: "Daddy Corner", category: "cafe", color: C.cafe,
  floors: 1, emoji: "🥤", shape: { polygon: rect(55, -20, 20, 14) },
  meta: { description: "Kedai makan kecil 'Daddy Corner' yang popular untuk minuman dan snek.", tags: ["Daddy Corner","makanan","minuman"], hours: "07:00–22:00" },
});

// ── BLOK P (female, east) ────────────────────────────────────────────────────
const pBlocks = [
  ["B_P1", "Blok P1", 228, 25],
  ["B_P2", "Blok P2", 228, 80],
  ["B_P3", "Blok P3", 228, 132],
  ["B_P4", "Blok P4", 228, 178],
  ["B_P5", "Blok P5", 305, -78],
];
pBlocks.forEach(([id, name, x, z]) => {
  const isP5 = id === "B_P5";
  addBuilding({
    id, name: `${name} (Asrama Perempuan)`, category: "residence_f", color: C.residence_f,
    floors: isP5 ? 3 : 4, emoji: "🏠",
    shape: isP5 ? { polygon: rect(x, z, 34, 30, 18) } : rectWithCourtyard(x, z, 44, 40, 0.38),
    features: isP5 ? {} : { corridor: true },
    meta: { description: `${name} — blok kediaman pelajar perempuan ${isP5 ? "di hujung timur laut berhampiran Jalan Bunga Lawang" : "di zon timur kampus dengan laman dalaman"}.`, tags: ["asrama","perempuan", name.split(" ")[1].toLowerCase()], hours: "24 jam (residen sahaja)" },
  });
});

// ── STAFF HOUSES & NURSERY ───────────────────────────────────────────────────
addBuilding({
  id: "B_RUMAH_KJ", name: "Rumah Ketua Jabatan", category: "staff_house", color: C.staff_house,
  floors: 1, emoji: "🏡", shape: { polygon: rect(285, 28, 28, 22) },
  meta: { description: "Kediaman rasmi Ketua Jabatan KMK.", tags: ["kediaman","staf"], hours: "Kawasan kediaman" },
});
addBuilding({
  id: "B_RUMAH_PENGARAH", name: "Rumah Pengarah", category: "staff_house", color: C.staff_house,
  floors: 2, emoji: "🏡", shape: { polygon: rect(285, 170, 32, 26) },
  meta: { description: "Kediaman rasmi Pengarah KMK.", tags: ["kediaman","pengarah"], hours: "Kawasan kediaman" },
});
addBuilding({
  id: "B_SEMAIAN", name: "Rumah Semaian Pokok (Nurseri)", category: "staff_house", color: "#7fae5a",
  floors: 1, emoji: "🌱", shape: { polygon: rect(280, -175, 40, 30) },
  meta: { description: "Tapak semaian pokok dan landskap kampus.", tags: ["semaian","pokok","landskap"], hours: "Isnin–Jumaat 08:00–17:00" },
});

// ── SEARCHABLE PARKING ZONES FROM OFFICIAL PLAN ─────────────────────────────
[
  ["B_PARKIR_STAF_ADMIN", "Parkir Staf Admin", -268, -42, 28, 32, "Parkir staf berhampiran blok pentadbiran."],
  ["B_PARKIR_A1A2", "Parkir A1 & A2", -155, 112, 48, 28, "Parkir untuk Blok A1 dan A2."],
  ["B_PARKIR_B1B2", "Parkir B1 & B2", 125, 178, 46, 20, "Parkir berhampiran Blok B1/B2 dan Kafe B."],
  ["B_PARKIR_C2B2", "Parkir C2 & B2", 200, -55, 36, 56, "Parkir C2 & B2 pada laluan timur."],
  ["B_PARKIR_DEWAN", "Parkir Dewan Mahawangsa", 90, -120, 60, 26, "Parkir untuk Dewan Mahawangsa."],
  ["B_PARKIR_STAF_PENSYARAH", "Parkir Staf & Pensyarah", -130, -118, 60, 24, "Parkir staf dan pensyarah di utara blok akademik."],
  ["B_PARKIR_P5", "Parkir P5", 292, -110, 38, 22, "Parkir P5 di hujung timur laut, berhampiran Blok P5."],
].forEach(([id, name, x, z, w, d, desc]) => {
  addBuilding({
    id, name, category: "parking", color: C.parking,
    floors: 1, emoji: "🅿️", shape: { polygon: rect(x, z, w, d) },
    features: { parking: true },
    meta: { description: desc, tags: ["parkir","parking", name], hours: "24 jam mengikut peraturan kolej" },
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  CORRIDORS (selasar) — thin connecting links between blocks.
//  Rendered as low (1-storey) covered walkways.
// ═════════════════════════════════════════════════════════════════════════════
const corridors = [
  // A1 ↔ A2
  { id: "COR_A", from: [-93, 152], to: [-90, 152], rect: rect(-91.5, 152, 6, 10) },
  // Tutorial ↔ DK
  { id: "COR_DK_TUT", rect: rect(-122, 30, 30, 7) },
  // Seri Jerai ↔ Dewan Kuliah area (academic spine)
  { id: "COR_ADMIN", rect: rect(-150, -45, 7, 60) },
  // B1 ↔ B2
  { id: "COR_B", rect: rect(124, 122, 18, 8) },
  // C1 ↔ C2
  { id: "COR_C", rect: rect(120, 30, 14, 8) },
  // Pustaka ↔ Koop
  { id: "COR_PUS", rect: rect(-180, 122, 8, 18) },
];

// ═════════════════════════════════════════════════════════════════════════════
//  ROADS (from traffic-flow map)
// ═════════════════════════════════════════════════════════════════════════════
const roads = [
  // Internal campus ring and service roads
  { id: "R_MAIN_LOOP", name: "Jalan Gelang Utama (Sehala)", type: "primary", width: 9,
    polyline: [[-290,-35],[-290,-150],[-200,-225],[0,-225],[190,-225],[290,-150],[290,220],[90,235],[-290,160],[-290,-35]] },
  { id: "R_ENTRY_ROUNDABOUT", name: "Bulatan Masuk / Keluar", type: "primary", width: 9,
    polyline: [[-342,-20],[-318,-10],[-300,0],[-286,-10],[-282,-35],[-300,-55],[-326,-50],[-342,-20]] },
  { id: "R_PERSIARAN_KM", name: "Persiaran Kayu Manis (dalam kampus)", type: "primary", width: 11,
    polyline: [[-320,-260],[-320,250]] },
  { id: "R_JALAN_PELAGA", name: "Jalan Pelaga (hadapan kampus)", type: "primary", width: 11,
    polyline: [[-320,-260],[310,-260]] },
  { id: "R_JALAN_BUNGA", name: "Jalan Bunga Lawang (dalam kampus)", type: "primary", width: 11,
    polyline: [[320,-260],[332,-190],[338,-110],[332,-35],[318,40],[308,125],[320,250]] },

  // External roads visible in the correct satellite layout
  { id: "R_EXT_PELAGA_W", name: "Jalan Pelaga — sambungan barat laut", type: "external", width: 12,
    polyline: [[-520,-360],[-455,-330],[-395,-300],[-340,-270],[-320,-260]] },
  { id: "R_EXT_PELAGA_E", name: "Jalan Pelaga — sambungan timur", type: "external", width: 12,
    polyline: [[310,-260],[395,-258],[480,-238],[545,-210]] },
  { id: "R_EXT_KAYU_MANIS_N", name: "Persiaran Kayu Manis — sambungan utara", type: "external", width: 12,
    polyline: [[-320,-260],[-350,-305],[-415,-345],[-500,-370]] },
  { id: "R_EXT_KAYU_MANIS_S", name: "Persiaran Kayu Manis — sambungan selatan", type: "external", width: 12,
    polyline: [[-320,250],[-323,310],[-330,385]] },
  { id: "R_EXT_BUNGA_LAWANG_E", name: "Jalan Bunga Lawang — sambungan ke perumahan timur", type: "external", width: 12,
    polyline: [[330,-245],[392,-220],[440,-170],[452,-100],[435,-30],[382,35],[330,70]] },
  { id: "R_EXT_EXIT_S", name: "Jalan Keluar Selatan", type: "external", width: 12,
    polyline: [[92,235],[125,288],[160,360]] },

  // Internal connectors
  { id: "R_CENTRAL_NS", name: "Jalan Tengah (Jalan Cengkih)", type: "secondary", width: 7,
    polyline: [[0,-225],[0,-165],[0,-40],[0,220]] },
  { id: "R_ACADEMIC_SPINE", name: "Lorong Akademik", type: "secondary", width: 6,
    polyline: [[-290,-80],[-245,-80],[-200,-80],[-120,-80],[-35,-80],[0,-80]] },
  { id: "R_DATARAN_LOOP", name: "Jalan Dataran Pelajar", type: "secondary", width: 6,
    polyline: [[-290,0],[-200,0],[-100,0],[0,0],[0,-40]] },
  { id: "R_KAFE_A_ROAD", name: "Lorong Kafe A / Blok A", type: "secondary", width: 6,
    polyline: [[-290,160],[-200,160],[-95,160],[0,160]] },
  { id: "R_KAFE_B_ROAD", name: "Lorong Kafe B / Blok B", type: "secondary", width: 6,
    polyline: [[0,160],[90,160],[200,160],[290,220]] },
  { id: "R_EAST_BLOK_P", name: "Lorong Blok P (Timur)", type: "secondary", width: 5,
    polyline: [[200,-225],[200,-120],[200,0],[200,120],[200,220]] },
  { id: "R_DATARAN_KAWAD", name: "Lorong Dataran Kawad", type: "path", width: 4,
    polyline: [[-290,10],[-200,10],[-160,10],[-130,10]] },
  { id: "R_MASJID_PATH", name: "Laluan Masjid", type: "path", width: 3,
    polyline: [[0,0],[-12,35],[-25,55]] },
  { id: "R_PUSTAKA_PATH", name: "Laluan Pustaka", type: "path", width: 3,
    polyline: [[-140,70],[-160,88],[-180,100]] },
];

// Zebra crossings from the correct satellite layout / traffic-plan entrances.
const crossings = [
  { id: "X_ENTRANCE_W", name: "Lintasan Zebra Pintu Masuk", center: [-318, -22], width: 11, length: 9, rotation: 12, stripes: 6 },
  { id: "X_GUARD", name: "Lintasan Zebra Pondok Pengawal", center: [-298, -2], width: 9, length: 8, rotation: 90, stripes: 5 },
  { id: "X_ASTAKA", name: "Lintasan Zebra Astaka / Padang", center: [-225, -175], width: 10, length: 9, rotation: 0, stripes: 6 },
  { id: "X_DEWAN", name: "Lintasan Zebra Dewan Mahawangsa", center: [58, -130], width: 10, length: 9, rotation: 0, stripes: 6 },
  { id: "X_CAFE_C", name: "Lintasan Zebra Kafe C", center: [198, -82], width: 9, length: 8, rotation: 90, stripes: 5 },
  { id: "X_MASJID", name: "Lintasan Zebra Masjid", center: [4, -14], width: 8, length: 8, rotation: 0, stripes: 5 },
  { id: "X_KAFE_A", name: "Lintasan Zebra Kafe A", center: [-70, 174], width: 9, length: 8, rotation: 0, stripes: 5 },
  { id: "X_KAFE_B", name: "Lintasan Zebra Kafe B", center: [108, 176], width: 9, length: 8, rotation: 0, stripes: 5 },
  { id: "X_EXIT_S", name: "Lintasan Zebra Keluar Selatan", center: [96, 232], width: 11, length: 9, rotation: -35, stripes: 6 },
  { id: "X_BUNGA_LAWANG", name: "Lintasan Zebra Jalan Bunga Lawang", center: [320, 64], width: 10, length: 9, rotation: 86, stripes: 6 },
];

// ═════════════════════════════════════════════════════════════════════════════
//  GREENSPACE
// ═════════════════════════════════════════════════════════════════════════════
const greenspace = [
  { id: "G_PADANG", type: "field", name: "Padang (Bola Sepak)", polygon: rect(-110, -195, 130, 80) },
  { id: "G_DATARAN_KAWAD", type: "plaza", name: "Dataran Kawad", polygon: rect(-192, 8, 60, 40) },
  { id: "G_DATARAN_PELAJAR", type: "plaza", name: "Dataran Pelajar", polygon: rect(-92, 110, 80, 28) },
  { id: "G_TAMAN_MAIN", type: "garden", name: "Taman Permainan", polygon: rect(150, 178, 40, 36) },
  { id: "G_ROUNDABOUT", type: "plaza", name: "Bulatan Masuk",
    polygon: [[-285,-15],[-280,-28],[-268,-35],[-255,-35],[-243,-28],[-238,-15],[-243,-2],[-255,5],[-268,5],[-280,-2]] },
  { id: "G_CENTRAL_LAWN", type: "lawn", name: "Kawasan Hijau Tengah", polygon: rect(-90, -30, 80, 55) },
  { id: "G_WEST_LAWN", type: "lawn", name: "Taman Barat", polygon: rect(-265, 55, 36, 55) },
  // Parking zones (rendered as plaza)
  { id: "P_STAF_ADMIN", type: "plaza", name: "Parkir Staf Admin", polygon: rect(-268, -42, 28, 32) },
  { id: "P_A1A2", type: "plaza", name: "Parkir A1 & A2", polygon: rect(-155, 112, 48, 28) },
  { id: "P_B1B2", type: "plaza", name: "Parkir B1 & B2", polygon: rect(125, 178, 46, 20) },
  { id: "P_C2_B2", type: "plaza", name: "Parkir C2 & B2", polygon: rect(200, -55, 36, 56) },
  { id: "P_DEWAN", type: "plaza", name: "Parkir Dewan", polygon: rect(90, -120, 60, 26) },
  { id: "P_STAF_NK", type: "plaza", name: "Parkir Staf & Pensyarah", polygon: rect(-130, -118, 60, 24) },
];

// ═════════════════════════════════════════════════════════════════════════════
//  ATHLETICS TRACK (separate so renderer can draw the rubber ring)
// ═════════════════════════════════════════════════════════════════════════════
const track = {
  outer: [[-80,-245],[30,-245],[55,-218],[30,-180],[-80,-180],[-105,-210]],
  inner: [[-72,-238],[22,-238],[44,-215],[22,-187],[-72,-187],[-94,-212]],
};

// ═════════════════════════════════════════════════════════════════════════════
//  TREES (line planting)
// ═════════════════════════════════════════════════════════════════════════════
function treeLine(arr, x1, z1, x2, z2, n, spread = 4, sc = 3.4) {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    arr.push({
      x: +(x1 + (x2 - x1) * t + (Math.random() - 0.5) * spread).toFixed(1),
      z: +(z1 + (z2 - z1) * t + (Math.random() - 0.5) * spread).toFixed(1),
      s: +(sc * (0.85 + Math.random() * 0.3)).toFixed(2),
      r: +(Math.random() * 6.28).toFixed(2),
    });
  }
}
const trees = [];
treeLine(trees, -200,-232, 190,-232, 14, 5, 3.6);
treeLine(trees, 296,-230, 296,200, 16, 5, 3.6);
treeLine(trees, -296,-230, -296,180, 15, 5, 3.6);
treeLine(trees, -280,165, 90,165, 11, 5, 3.3);
treeLine(trees, -175,-190, -175,-145, 5, 4, 4);
treeLine(trees, -45,-190, -45,-145, 5, 4, 4);
treeLine(trees, -130,-45, -50,-45, 6, 6, 3.8);
treeLine(trees, -60,42, -10,42, 3, 3, 3);
treeLine(trees, 195,-10, 195,160, 8, 4, 3.5);
treeLine(trees, 255,-185, 305,-185, 5, 5, 4.5);
treeLine(trees, 208,10, 208,190, 9, 4, 3.2);
treeLine(trees, 290,50, 312,180, 6, 8, 4);

// ═════════════════════════════════════════════════════════════════════════════
//  BOUNDS & MANIFEST
// ═════════════════════════════════════════════════════════════════════════════
const roadPts = roads.flatMap(r => r.polyline);
const greenPts = greenspace.flatMap(g => g.polygon);
const crossingPts = crossings.flatMap(c => {
  const hw = c.width / 2;
  const hl = c.length / 2;
  return [[c.center[0] - hw, c.center[1] - hl], [c.center[0] + hw, c.center[1] + hl]];
});
const allX = [
  ...buildings.flatMap(b => [b.bbox[0], b.bbox[2]]),
  ...roadPts.map(p => p[0]),
  ...greenPts.map(p => p[0]),
  ...crossingPts.map(p => p[0]),
];
const allZ = [
  ...buildings.flatMap(b => [b.bbox[1], b.bbox[3]]),
  ...roadPts.map(p => p[1]),
  ...greenPts.map(p => p[1]),
  ...crossingPts.map(p => p[1]),
];
const bounds = {
  minX: Math.min(...allX) - 45,
  maxX: Math.max(...allX) + 45,
  minZ: Math.min(...allZ) - 45,
  maxZ: Math.max(...allZ) + 45,
};
const manifest = {
  name: "Kolej Matrikulasi Kedah (KMK) — Digital Twin Campus",
  origin: { lat: 6.1248, lon: 100.3673 },
  crs: "local-ENU-metres",
  generatedAt: new Date().toISOString(),
  source: "Satellite + Pelan Aliran Trafik MPPB 2026/2027 + DXF vector",
  note: "Realistic scale. Buildings include courtyards (holes) and corridors. Masjid is a landmark with dome + minaret.",
  bounds,
  counts: {
    buildings: buildings.length,
    roads: roads.length,
    greenspace: greenspace.length,
    trees: trees.length,
    corridors: corridors.length,
    crossings: crossings.length,
  },
};

function save(file, data) {
  writeFileSync(join(OUT, file), JSON.stringify(data, null, 2));
  const len = Array.isArray(data) ? data.length : Object.keys(data).length;
  console.log(`✓ ${file.padEnd(20)} ${String(len).padStart(4)}`);
}
save("buildings.json", buildings);
save("roads.json", roads);
save("greenspace.json", greenspace);
save("corridors.json", corridors);
save("crossings.json", crossings);
save("track.json", track);
save("trees.json", trees);
save("metadata.json", metadataMap);
save("manifest.json", manifest);

console.log("\n── KMK realistic campus ───────────────");
console.log(`  X: ${bounds.minX} → ${bounds.maxX}  (W ${bounds.maxX - bounds.minX}m)`);
console.log(`  Z: ${bounds.minZ} → ${bounds.maxZ}  (D ${bounds.maxZ - bounds.minZ}m)`);
console.log(`  Masjid area: ${buildings.find(b=>b.id==='B_MASJID').area} m²  (${buildings.find(b=>b.id==='B_MASJID').height}m tall)`);
console.log(`  Dewan area:  ${buildings.find(b=>b.id==='B_DEWAN').area} m²`);
console.log(`  Buildings with courtyards: ${buildings.filter(b=>b.holes.length>0).length}`);
