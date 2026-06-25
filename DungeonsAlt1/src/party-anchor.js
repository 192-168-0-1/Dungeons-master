import { nearestPartySlot, normalizeOcrPartyName } from "./party-interface.js?v=20260625-6";

// Sprite-anchor reader for the RuneScape Dungeoneering party interface, ported
// from the working Sleepy-meh-alt-1/dg-map plugin (with the maintainer's
// blessing, same as the map anchor). Instead of inferring the panel from
// divider geometry, it locates the panel deterministically from the fixed 14x19
// Dungeoneering skill icon at its top-left, then reads each of the five 22px
// rows with the RuneScape chatbox font and the row's player colour. This is far
// more reliable on a real capture; it does require 100% RuneScape UI scale
// (the sprites are not scaled), so the divider reader in party-interface.js
// stays as the fallback for scaled interfaces.

export const PARTY_ROW_HEIGHT = 22;

// 14x19 Dungeoneering skill icon shown at the top-left of the party panel.
export const DG_ICON = Object.freeze({
  icon: "KjA2/ykxNf8kKjb/GiI4/xQfLf8YIy7/FChE/xMth/8GJ5r/BQp3/xAUYP8cIUz/Jyw3/yoyNv8kLDP/FiRY/wZHrf8UZ8j/MpLX/zBuof8jXNv/A1HZ/0Ws8f9No+3/GIfr/wNt2P8NH37/ISky/xkhMf8eT6v/MnPj/0ST7P9fmcL/MmWT/wx02/8ig93/nuH6/1rI9/8Bm/L/AWvm/wJW1v8LK5X/R19r/0OEuv80YYn/PGuN/0+PsP8zZqL/H1rM/z2H4/9ttvH/AyO9/wElvv8BauX/B4fQ/wYtnP8cZZn/AQ0V/wAAAP8KDA3/LUVX/0WDrP8hS7//XJbt/zan8P8CJcf/AE/Z/wKU3/8iStz/DBNS/w1Nbf8AAQP/ARUh/xIoNf8ZHyP/LmWU/wk0mf85juX/CI7v/wFi4P8BauH/C0LC/yNyx/8eKDn/G01n/wYjNP8NWIb/LW2R/w4XHP8lN1H/BhpL/wADf/8BcuL/AWLd/woonv8bW4T/EV/D/xIaMv8ZR17/NWiL/1GCnf8uaYT/GlNu/xUbIP8fLjr/GUJl/wAZdv8XUJ3/JW2p/02Nuf8Ta5v/EClL/xchJ/80ZYD/IE5x/wk/af8JN1P/N1Nm/xkfIv8cIiv/IjVF/yVKYv9DeqH/Iomu/xRjsP8SQ4T/Iiks/xMoNv8wVnP/CjpY/zRykv95psT/UIif/xglLv8ZHiH/ICcq/wofOv9Hh6//AnTg/wYwp/8jKi7/HiQo/xI2S/85d5b/ma67/26VqP8bW33/CVR+/yBPb/8fLjj/CSEy/yx0sP8HcOL/DjGm/yMqLv8jKi7/ICcq/xIuRP9Kfpv/F0Fd/wY8W/8McKv/Vn2U/xhEYv8DFSf/H4jN/wZs2P8QIW3/Iyou/yMqLv8jKi7/HyUq/xMhK/8gTGL/OWmE/199kf8ySV7/BhAc/wQyU/8cibn/ECJk/x4lNP8jKi7/Iyou/yMqLv8jKi7/Iyou/xshJf8SLDf/GExj/yVMY/8XUmz/F194/xEZIP8gJyv/Iyou/yMqLv8jKi7/Iyou/yMqLv8jKi7/Iyou/yIpLP8fJCn/GiEl/xohJf8eJCj/Iikt/yMqLv8jKi7/Iyou/yMqLv8jKi7/Iyou/yMqLv8jKi7/Iyou/yMqLv8jKi7/Iyou/yMqLv8jKi7/Iyou/yMqLv8jKi7/Iyou/yMqLv8jKi7/Iyou/yMqLv8jKi7/Iyou/yMqLv8jKi7/Iyou/yMqLv8jKi7/Iyou/yMqLv95hJX/eYSV/3mElf95hJX/eYSV/3mElf95hJX/eYSV/3mElf95hJX/eYSV/3mElf95hJX/Iyou/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8=",
  width: 14,
  height: 19,
});

// 2x2 marker sitting at the right end of each party row divider line.
export const DG_INTERFACE_ROW_END = Object.freeze({
  icon: "eYSV/yMqLv8AAAD/Iyou/w==",
  width: 2,
  height: 2,
});

// The muted colours the interface renders each player's RSN in. Identical to the
// SLOT_RGB references the divider reader uses.
export const PARTY_SLOT_COLORS = Object.freeze([
  Object.freeze([210, 53, 0]),
  Object.freeze([0, 137, 133]),
  Object.freeze([72, 129, 0]),
  Object.freeze([145, 150, 0]),
  Object.freeze([109, 134, 95]),
]);

export const CHATBOX_FONT_URL = new URL("../assets/fonts/chatbox/12pt.data.png", import.meta.url).href;

// OCR.loadFontImage configuration copied verbatim from dg-map's fonts.js.
export const CHATBOX_FONT_CONFIG = Object.freeze({
  basey: 9,
  spacewidth: 3,
  treshold: 0.3,
  color: [127, 169, 255],
  unblendmode: "removebg",
  shadow: false,
  chars: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789%/+?!@#$^~&*()_-=[]{}:;\"'<>\\.,|",
  seconds: ",.-:;\"'",
});

export async function loadChatboxFont(runtime = globalThis) {
  const a1lib = runtime?.A1lib ?? runtime?.a1lib;
  const ocr = runtime?.OCR ?? runtime?.ocr;
  if (typeof a1lib?.ImageDetect?.imageDataFromUrl !== "function" || typeof ocr?.loadFontImage !== "function") {
    return null;
  }
  try {
    const image = await a1lib.ImageDetect.imageDataFromUrl(CHATBOX_FONT_URL);
    return ocr.loadFontImage(image, { ...CHATBOX_FONT_CONFIG });
  } catch {
    return null;
  }
}

function parseMatches(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function findDgIcon(api) {
  if (!api || typeof api.bindRegion !== "function" || typeof api.bindFindSubImg !== "function") return null;
  const width = Number(api.rsWidth) || 0;
  const height = Number(api.rsHeight) || 0;
  if (width <= 0 || height <= 0) return null;
  try {
    const bind = api.bindRegion(0, 0, width, height);
    const matches = parseMatches(api.bindFindSubImg(bind, DG_ICON.icon, DG_ICON.width, 0, 0, width, height));
    const match = matches[0];
    return match && Number.isFinite(match.x) && Number.isFinite(match.y)
      ? { x: Math.round(match.x), y: Math.round(match.y) }
      : null;
  } catch {
    return null;
  }
}

// Derive the five row capture rectangles from the located DG icon, mirroring
// dg-map's scanInterface geometry exactly.
export function locatePartyRows(api, dgIcon) {
  if (!api || !dgIcon || typeof api.bindRegion !== "function" || typeof api.bindFindSubImg !== "function") return null;
  const clientWidth = Number(api.rsWidth) || 0;
  if (clientWidth <= 0) return null;
  const rowX = dgIcon.x;
  const firstRowLineBottomY = dgIcon.y + DG_ICON.height;
  let rowEndX;
  try {
    const bandY = firstRowLineBottomY - DG_INTERFACE_ROW_END.height;
    const bind = api.bindRegion(rowX, bandY, clientWidth - rowX, DG_INTERFACE_ROW_END.height);
    const matches = parseMatches(api.bindFindSubImg(
      bind, DG_INTERFACE_ROW_END.icon, DG_INTERFACE_ROW_END.width, 0, 0, clientWidth - rowX, DG_INTERFACE_ROW_END.height,
    ));
    const rowEnd = matches[0];
    if (!rowEnd || !Number.isFinite(rowEnd.x)) return null;
    rowEndX = rowEnd.x;
  } catch {
    return null;
  }
  const rowWidth = rowEndX > 120 ? 120 : rowEndX;
  if (rowWidth <= 0) return null;
  const cropX = rowX + Math.floor((rowEndX - rowWidth) / 2);
  const rows = Array.from({ length: 5 }, (_, index) => ({
    slot: index + 1,
    x: cropX,
    y: firstRowLineBottomY + PARTY_ROW_HEIGHT * index - PARTY_ROW_HEIGHT,
    width: rowWidth,
    height: PARTY_ROW_HEIGHT - DG_INTERFACE_ROW_END.height,
    color: PARTY_SLOT_COLORS[index],
  }));
  return { cropX, rowWidth, firstRowLineBottomY, rows };
}

const DG_BACKGROUND_COLORS = [
  [43, 40, 34], [50, 46, 40], [50, 48, 40], [51, 48, 40], [51, 46, 40],
];

// Blacken the divider line above the text and the known panel background tones so
// the OCR only sees the coloured name. Mirrors dg-map's removeDgInterfaceBackground.
export function removeDgInterfaceBackground(image, textY = 5) {
  if (!image?.data) return image;
  const { width, height, data } = image;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const isBackground = y < textY
        || DG_BACKGROUND_COLORS.some((color) => r === color[0] && g === color[1] && b === color[2]);
      if (isBackground) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 255;
      }
    }
  }
  return image;
}

function countSlotPixels(image, slot) {
  if (!image?.data) return 0;
  const { width, height, data } = image;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (nearestPartySlot([data[i], data[i + 1], data[i + 2], data[i + 3]]) === slot) count += 1;
    }
  }
  return count;
}

function cloneImage(image) {
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
}

// Read the whole party panel via the icon anchor. Returns the same member shape
// as the divider reader ({ slot, occupied, name, pixelCount }) so the app can
// reconcile it identically, or null when the icon is not on screen. The font is
// optional: locating the panel and per-row occupancy (by player-colour pixels)
// work without OCR, so the panel is still found when the chatbox font failed to
// load — names are just read with whatever fonts are available.
export function readPartyByAnchor({ api, capture, ocr, font, fonts } = {}) {
  if (!api || typeof capture !== "function") return null;
  const dgIcon = findDgIcon(api);
  if (!dgIcon) return null;
  const layout = locatePartyRows(api, dgIcon);
  if (!layout) return null;

  const fontList = [font, ...(Array.isArray(fonts) ? fonts : [])]
    .filter((candidate, index, list) => candidate?.chars && list.indexOf(candidate) === index);
  const canOcr = typeof ocr?.findReadLine === "function" && fontList.length > 0;

  let foundEmptyRow = false;
  let capturedAny = false;
  const members = layout.rows.map((row) => {
    let pixelCount = 0;
    let name = "";
    let captured = null;
    try {
      captured = capture(row.x, row.y, row.width, row.height);
    } catch {
      captured = null;
    }
    if (captured?.data) {
      capturedAny = true;
      pixelCount = countSlotPixels(captured, row.slot);
      if (canOcr) {
        const cleaned = removeDgInterfaceBackground(cloneImage(captured), 5);
        const probeX = Math.max(0, Math.round(captured.width / 2) - 10);
        const probeY = Math.round(captured.height / 2);
        for (const candidateFont of fontList) {
          try {
            const result = ocr.findReadLine(cleaned, candidateFont, [row.color], probeX, probeY);
            const candidate = normalizeOcrPartyName(result?.text);
            if (candidate) { name = candidate; break; }
          } catch {
            // Try the next font.
          }
        }
      }
    }
    // PARITY: same occupancy gate as the divider reader's MIN_OCCUPIED_PIXELS.
    const hasEvidence = pixelCount >= 6 || Boolean(name);
    const occupied = !foundEmptyRow && hasEvidence;
    if (!occupied) foundEmptyRow = true;
    return { slot: row.slot, occupied, name: occupied ? name : "", pixelCount };
  });

  // A transient all-rows capture failure is indistinguishable from no panel.
  if (!capturedAny) return null;
  return { panel: { ...layout, anchor: dgIcon, method: "anchor" }, members };
}
