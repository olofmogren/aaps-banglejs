/*
 * This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 * You should have received a copy of the GNU General Public License along with this program. If not, see <https://www.gnu.org/licenses/>. 
 *
 * Author: Olof Mogren
 * Year: 2025-2026
 *
 */

const lib = require('aaps-lib.js');

// === GLOBAL DATA and CONSTANTS
// ===================================================================================
global.aapsQueue = global.aapsQueue || [];

const MGDL_TO_MMOL = 18.0182;
const HIGH_MMOL = 10.0;
const LOW_MMOL = 4.0;
const H = g.getHeight();
const W = g.getWidth();
let drawTimeout;

// === GLOBAL DATA and CONSTANTS ===
let currentStatusData = { sgv: "---", delta: "---", trend: "FLAT", iob: "---", cob: "---", basal: '---', ts: 0 };
let historyData = { glucose: [], insulin: [], carbs: [], basals: [], stale: false };
let clockInterval; // To keep track of the main clock timer
let settings;
let tapTimeout; // to track the tap timer for double-taps
let lastStepCount = 0;
let dialogActive = false; // hinders the watch face from updating the screen.
let lastDrawMinutes = -1;
let currentDebugLog = 0;
let runningDebugLog = '';

// === DATA HANDLING AND DRAWING ===

/**
 * Inserts an element into a sorted array while maintaining the sort order.
 * The array and the element must have a numeric 'ts' (timestamp) property.
 * The array is assumed to be already sorted by 'ts' in ascending order.
 *
 * It performs a fast check for the common case (inserting at the end)
 * and falls back to a robust binary search for all other insertions.
 *
 * @param {Array<Object>} sortedArray The array to insert into (will be modified).
 * @param {Object} newElement The new element to insert, containing a 'ts' property.
 */
function insertSorted(sortedArray, newElement, deleteUntilTs, onlyIfChanged, key) {
  insertSortedHelper(sortedArray, newElement, onlyIfChanged, key);
  deleteUntil(sortedArray, deleteUntilTs);
}

function insertSortedHelper(sortedArray, newElement, onlyIfChanged, key) {
  if (sortedArray.length === 0) {
    sortedArray.push(newElement);
    return;
  }

  const lastTS = lastTimestamp(sortedArray);
  if (newElement.ts >= lastTS) {
    if (newElement.ts === lastTS) {
        sortedArray[sortedArray.length - 1] = newElement; // Update
    } else {
      if (!onlyIfChanged || sortedArray[sortedArray.length-1][key] != newElement[key]) {
        sortedArray.push(newElement); // Append
      }
    }
    return;
  }

  let low = 0;
  let high = sortedArray.length - 1;

  while (low <= high) {
    let mid = Math.floor((low + high) / 2);
    let midElement = sortedArray[mid];

    if (newElement.ts === midElement.ts) {
      sortedArray[mid] = newElement; // Overwrite existing element
      return;
    }

    if (newElement.ts < midElement.ts) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  
  const insertIndex = low;

  if (!onlyIfChanged || insertIndex == 0 || sortedArray[insertIndex-1][key] != newElement[key] || insertIndex == sortedArray.length || sortedArray[insertIndex] != newElement) {
    sortedArray.splice(insertIndex, 0, newElement);
  }
}

function deleteUntil(sortedArray, deleteUntilTs){
  if (deleteUntilTs!==undefined && sortedArray.length > 0) {
    while (sortedArray.length > 0 && sortedArray[0].ts < deleteUntilTs ) {
      sortedArray.shift();
    }
  }
}

// === NEW RAM QUEUE CONSUMER ===
function consumeAapsQueue() {
  let needsRedraw = (new Date().getMinutes()) != lastDrawMinutes;
  let ninetyMinutesAgoMillis = Math.round(new Date().getTime() - 90 * 60 * 1000);

  while (global.aapsQueue && global.aapsQueue.length > 0) {
    let item = global.aapsQueue.shift();
    if (!item || !item.type) continue;

    needsRedraw = true;

    switch (item.type) {
      case "status":
        let basalChanged = currentStatusData.basal != item.basal;
        
        if (settings['debugLogs'] > 0){
          runningDebugLog += 'Queue Status: old ts: '+currentStatusData.ts+', new ts: '+item.ts+'\n';
        }

        // Map tracking properties dynamically AND safely enforce numeric conversion
        for (let key in item) {
          if (key !== "type") {
            // Use parseFloat if it's a string representation of a number, otherwise keep as is
            if (typeof item[key] === "string" && !isNaN(item[key])) {
              currentStatusData[key] = parseFloat(item[key]);
            } else {
              currentStatusData[key] = item[key];
            }
          }
        }

        // Inline appending to rolling glucose history
        let timeDiff = currentStatusData.ts - (lastTimestamp(historyData.glucose));
        let allowAfter = Math.round(4.5 * 60 * 1000);
        if (timeDiff > allowAfter){
          insertSorted(historyData.glucose, {ts: currentStatusData.ts, sgv: currentStatusData.sgv}, ninetyMinutesAgoMillis, false, "sgv");
        }

        if (basalChanged) {
          if (settings['debugLogs'] > 0){
            runningDebugLog += 'Queue Status Basal Update: insertSorted('+historyData.basals.length+' '+currentStatusData.ts+' '+currentStatusData.basal+'\n';
          }
          insertSorted(historyData.basals, {ts: currentStatusData.ts, rate: currentStatusData.basal}, ninetyMinutesAgoMillis, true, "rate");
        }
        break;
      case "confirmAction":
        console.log("ConfirmAction payload received via RAM pipeline.");
        handleConfirmActionJson(item);
        break;

      case "history_bg":
        if (item.flat && Array.isArray(item.flat)) {
          let currentBgHistoryLen = historyData.glucose.length;
          let currentBgHistoryStart = (currentBgHistoryLen > 0) ? historyData.glucose[0].ts : -1;
          let currentBgHistoryEnd = (currentBgHistoryLen > 0) ? lastTimestamp(historyData.glucose) : -1;

          // Step by 2: i = timestamp, i+1 = blood glucose value (sgv)
          for (let i = 0; i < item.flat.length; i += 2) {
            let obj = { ts: item.flat[i], sgv: item.flat[i+1] };
            // Deduplicate incoming array bounds
            if (currentBgHistoryLen == 0 || obj.ts < currentBgHistoryStart || obj.ts > currentBgHistoryEnd) {
              insertSorted(historyData.glucose, obj, ninetyMinutesAgoMillis, false, "sgv");
            }
          }
          needsRedraw = true;
        }
        break;

      case "history_insulin":
        if (item.flat && Array.isArray(item.flat)) {
          historyData.insulin = []; // Flush old timeline segment for fresh bulk sync
          // Step by 2: i = timestamp, i+1 = insulin units
          for (let i = 0; i < item.flat.length; i += 2) {
            insertSorted(historyData.insulin, { ts: item.flat[i], amount: item.flat[i+1] }, ninetyMinutesAgoMillis, false, "amount");
          }
          needsRedraw = true;
        }
        break;

      case "history_carbs":
        if (item.flat && Array.isArray(item.flat)) {
          historyData.carbs = []; // Flush old timeline segment
          // Step by 2: i = timestamp, i+1 = carb grams
          for (let i = 0; i < item.flat.length; i += 2) {
            insertSorted(historyData.carbs, { ts: item.flat[i], amount: item.flat[i+1] }, ninetyMinutesAgoMillis, false, "amount");
          }
          needsRedraw = true;
        }
        break;

      case "history_basal":
        if (item.flat && Array.isArray(item.flat)) {
          historyData.basals = []; // Flush past cached steps to process clean compressed blocks
          // Step by 2: i = timestamp, i+1 = raw basal rate profile float
          for (let i = 0; i < item.flat.length; i += 2) {
            let obj = { ts: item.flat[i], rate: item.flat[i+1] };
            if (settings['debugLogs'] > 0){
              runningDebugLog += 'Queue Basal Array: insertSorted(' + historyData.basals.length + ' ' + obj.ts + ' ' + obj.rate + '\n';
            }
            insertSorted(historyData.basals, obj, ninetyMinutesAgoMillis, true, "rate");
          }
          needsRedraw = true;
        }
        break;
    }
  }

  if (needsRedraw) {
    draw();
  }
}

// Global hooks so the Gadgetbridge engine code snippet can trigger processing on the watch dynamically
global.onAapsUpdate = function() {
  consumeAapsQueue();
};

// === MASTER DRAW FUNCTION ===
function draw() {
  if (dialogActive) return;

  if (clockInterval) clearTimeout(clockInterval);
  clockInterval = undefined;
  clockInterval = setTimeout(() => {
    if (Bangle.isLCDOn()){
      draw();
    }
  }, 60000 - (Date.now() % 60000));
  
  lastDrawMinutes = new Date().getMinutes();

  g.reset();
  g.clear();
  Bangle.loadWidgets();
  Bangle.drawWidgets();

  const leftCol = { x: 0, y: 24, w: 72, h: H - 24 };
  const topRight = { x: leftCol.w + 1, y: 24, w: W - leftCol.w - 1, h: 80 };
  const bottomRight = { x: leftCol.w + 1, y: topRight.y + topRight.h, w: W - leftCol.w - 1, h: H - topRight.y - topRight.h };

  drawLeftColumn(leftCol.x, leftCol.y, leftCol.w, leftCol.h);
  drawTopRight(topRight.x, topRight.y, topRight.w, topRight.h);
  drawBottomRightGraph(bottomRight.x, bottomRight.y, bottomRight.w, bottomRight.h);
}

function drawLeftColumn(x, y, w, h) {
  let glucoseMmol = null, deltaMmol = null;
  let textColor = "#000";

  glucoseMmol = currentStatusData.sgv / MGDL_TO_MMOL;

  if (glucoseMmol >= HIGH_MMOL || glucoseMmol <= LOW_MMOL) textColor = "#F00";

  const sgvText = (currentStatusData.sgv && (glucoseMmol.toString() != "NaN")) ? glucoseMmol.toFixed(1) : "---";
  const mainBgX = x + w / 2;
  const mainBgY = y + 20;

  let minutesAgo = 100;
  if (currentStatusData.ts > 0) {
    let timeDiff = Date.now() - currentStatusData.ts;
    minutesAgo = Math.round(timeDiff / 60000);
  }

  if (minutesAgo > 5) textColor = "#999";
  
  g.setFontAlign(0, 0);
  g.setColor(textColor).setFont("Vector", 32).drawString(sgvText, mainBgX, mainBgY);
  
  if (minutesAgo > 1) {
    const sgvTextWidth = g.stringWidth(sgvText);
    const superscriptX = mainBgX + (sgvTextWidth / 2) + 3;
    const superscriptY = mainBgY - 10;

    g.setFontAlign(-1, 0);
    g.setFont("Vector", 12);
    g.drawString(`(${minutesAgo})`, superscriptX, superscriptY);
  }
  
  g.setColor("#000"); 
  deltaMmol = (Math.round(10*(currentStatusData.delta / MGDL_TO_MMOL))/10).toString();
  if (deltaMmol.toString() == "NaN") {
    deltaMmol = "";
  } else if (deltaMmol[0] != '-') {
    deltaMmol = "+"+deltaMmol;
  }
  if (!deltaMmol.includes(".")) {
    deltaMmol = deltaMmol+".0";
  }
  g.setFont("Vector", 16).drawString(deltaMmol, x + w/2 - 10, y + 48);
  drawTrendArrow(x + w/2 + 25, y + 48, currentStatusData.trend);

  g.setFont("Vector", 14).setFontAlign(0, 0);

  g.drawString(process.memory().free, x + w/2, y + h - 76);
  let lengths = historyData.glucose.length + " " + historyData.insulin.length + " " + historyData.basals.length;
  g.drawString(lengths, x + w/2, y + h - 64);
  
  
  let basal = (currentStatusData.basal !== null && currentStatusData.basal !== undefined) ? currentStatusData.basal : "---";
  let cob = (currentStatusData.cob !== "---" && currentStatusData.cob !== undefined) ? Math.round(currentStatusData.cob).toString() : "---";
  let iob = (currentStatusData.iob !== undefined) ? currentStatusData.iob.toString() : "---";
  
  g.drawString("BAS: "+basal, x + w/2, y + h - 48);
  g.drawString("COB: "+cob, x + w/2, y + h - 32);
  g.drawString("IOB: "+iob, x + w/2, y + h - 16);
  
  g.setColor("#FF0000");
  g.fillRect(x + w -1, y, x + w, y + h);
}

function hypot(x, y) {
  return Math.sqrt(x*x + y*y);
}

function drawTrendArrow(x, y, slope) {
  if (!slope) return;

  console.log("trend arrow "+slope)

  // Style (tweak to taste)
  const COLOR = "#000";
  const L = 8;          // total arrow length (tail -> tip) in pixels
  const T = 2;          // shaft thickness
  const HEAD_L = 4;     // head length along the arrow direction
  const HEAD_W = 6;     // head base width

  g.setColor(COLOR);

  // --- helper: draw an arrow given a TIP and a DIRECTION vector ---
  function drawArrowTip(tipX, tipY, dirX, dirY) {
    console.log("drawing arrow "+tipX+" "+tipY+" "+dirX+" "+dirY);
    // normalize direction
    const len = hypot(dirX, dirY) || 1;
    const ux = dirX / len;
    const uy = dirY / len;

    // perpendicular (to build thickness + head width)
    const nx = -uy;
    const ny = ux;

    // key points along the arrow axis
    const baseX = tipX - ux * HEAD_L; // start of head (end of shaft)
    const baseY = tipY - uy * HEAD_L;
    const tailX = tipX - ux * L;      // tail of shaft
    const tailY = tipY - uy * L;

    const halfT = T / 2;
    const halfW = HEAD_W / 2;

    // shaft quad (tail -> base), offset by ±halfT along the normal
    const s1x = tailX + nx * halfT, s1y = tailY + ny * halfT;
    const s2x = tailX - nx * halfT, s2y = tailY - ny * halfT;
    const s3x = baseX - nx * halfT, s3y = baseY - ny * halfT;
    const s4x = baseX + nx * halfT, s4y = baseY + ny * halfT;

    // head triangle at the tip, base centered at (baseX, baseY)
    const h1x = tipX,         h1y = tipY;               // tip
    const h2x = baseX + nx*halfW, h2y = baseY + ny*halfW;
    const h3x = baseX - nx*halfW, h3y = baseY - ny*halfW;

    // draw (rounded to integers for crisp pixels)
    function r(v){ return Math.round(v); }

    g.fillPoly([
      r(s1x), r(s1y),
      r(s2x), r(s2y),
      r(s3x), r(s3y),
      r(s4x), r(s4y)
    ]);

    g.fillPoly([
      r(h1x), r(h1y),
      r(h2x), r(h2y),
      r(h3x), r(h3y)
    ]);
  }

  // Preserve your original *placement conventions*:
  // - FLAT: tip at (x, y), pointing right
  // - UP:   tip at (x, y - L), pointing up
  // - DOWN: tip at (x, y + L), pointing down
  // - FORTY_FIVE_UP:   tip at (x + L, y - L), pointing 45° up-right
  // - FORTY_FIVE_DOWN: tip at (x + L, y + L), pointing 45° down-right

  switch (slope) {
    case "FLAT":
      drawArrowTip(x, y, +1, 0);
      break;
    case "UP":
      drawArrowTip(x, y - L, 0, -1);
      break;
    case "DOWN":
      drawArrowTip(x, y + L, 0, +1);
      break;
    case "FORTY_FIVE_UP":
      drawArrowTip(x + L, y - L, +1, -1);
      break;
    case "FORTY_FIVE_DOWN":
      drawArrowTip(x + L, y + L, +1, +1);
      break;
    default: console.log("no case matched for the arrow");
  }
}

function drawTopRight(x, y, w, h) {
  g.setColor(0,0,0);
  const d = new Date();
  const timeYPos = y + 2;
  let hStr = ("0"+d.getHours()).substr(-2), mStr = ("0"+d.getMinutes()).substr(-2);
  g.setFont("Vector", 42); 
  const hWidth = g.stringWidth(hStr);
  g.setFont("Vector", 30);
  const mWidth = g.stringWidth(mStr);
  const gap = 2, totalWidth = hWidth + gap + mWidth, horizontalShift = 4;
  let currentX = x + (w - totalWidth) / 2 + horizontalShift;
  g.setFont("Vector", 42).setFontAlign(-1, -1);
  g.drawString(hStr, currentX, timeYPos);
  currentX += hWidth + gap;
  g.setFont("Vector", 30).setFontAlign(-1, -1); 
  g.drawString(mStr, currentX, timeYPos);
  const dateYPos = timeYPos + 46;
  const locale = require("locale");
  const day = locale.dow(d, 1).toUpperCase(), date = d.getDate(), month = locale.month(d, 1).toUpperCase();
  g.setFont("Vector", 15).setFontAlign(0, 0);
  g.drawString(`${day} ${date} ${month}`, x + w/2, dateYPos);
}

function drawBottomRightGraph(x, y, w, h) {
  const margin = 5;
  const graphX = x + margin;
  const graphW = w - (margin * 2);
  const MIN_MMOL_SCALE = 2.0;
  const MAX_MMOL_SCALE = 14.0;
  const BASELINE_XTICKS = y+h-6;
  const BASELINE_BG = y+h-24;
  const BASELINE_BASALS = y+h-12;
  const BASELINE_BOLUSES = y+h-16;
  const BASAL_SCALE = 16.0; 
  
  let threshColor = g.getBgColor() == "#ffffff" ? [0.8,0,0] : [0,0,0];
  g.setColor.apply(g, threshColor);
  let highY = BASELINE_BG - (((HIGH_MMOL - MIN_MMOL_SCALE) / (MAX_MMOL_SCALE - MIN_MMOL_SCALE)) * h);
  let lowY = BASELINE_BG - (((LOW_MMOL - MIN_MMOL_SCALE) / (MAX_MMOL_SCALE - MIN_MMOL_SCALE)) * h);
  g.drawLine(graphX, highY, graphX + graphW, highY);
  g.drawLine(graphX, lowY, graphX + graphW, lowY);

  let nowDate = new Date();
  let now = Math.round(nowDate.getTime());
  let ninetyMinutesMillis = 90 * 60 * 1000;
  let graphStartTime = now - ninetyMinutesMillis;

  let lastHourX = x+w-(nowDate.getMinutes()*(w/90));
  let lastHourLabel = nowDate.getHours()+":00";
  let previousHourX = lastHourX-60*(w/90);
  let previousHourLabel = (nowDate.getHours()-1)+":00";
  g.setColor("#000000");
  g.setFont("Vector", 12).setFontAlign(0, 0);
  g.drawString(lastHourLabel, lastHourX, BASELINE_XTICKS);
  g.setColor("#808080");
  g.drawLine(lastHourX, BASELINE_XTICKS, lastHourX, y);
  if (previousHourX > graphX) {
    g.setColor("#000000");
    g.drawString(previousHourLabel, previousHourX, BASELINE_XTICKS);
    g.setColor("#808080");
    g.drawLine(previousHourX, BASELINE_XTICKS, previousHourX, y);
  }
  
  // Basals Rendering
  if (historyData.basals.length > 0) {
    let maxBasal = 0.0;
    for (let i = 0; i < historyData.basals.length; i++) {
      if (historyData.basals[i].rate > maxBasal) {
          maxBasal = historyData.basals[i].rate;
      }
    }
    if (maxBasal === 0) maxBasal = 1.0;

    let lastY = BASELINE_BASALS;
    let lastVerticalBarX = graphX;

    for (let i = 0; i < historyData.basals.length; i++) {
      let currentPoint = historyData.basals[i];
      let nextPoint = (i + 1 < historyData.basals.length) ? historyData.basals[i+1] : { ts: now, rate: 0.0 };

      let startX = graphX + (currentPoint.ts - graphStartTime) * graphW / ninetyMinutesMillis;
      if (currentPoint.ts < graphStartTime) continue;
      let endX = graphX + graphW * (nextPoint.ts - graphStartTime) / ninetyMinutesMillis;

      let barHeight = (currentPoint.rate / maxBasal) * BASAL_SCALE;
      let barY = BASELINE_BASALS - barHeight;

      startX = Math.max(graphX, startX);
      endX = Math.min(graphX + graphW, endX);

      g.setColor("#00FFFF").fillRect(startX, barY, endX, BASELINE_BASALS);
      g.setColor("#0000FF").drawLine(startX, barY, endX, barY);

      if (lastVerticalBarX < startX) {
        g.drawLine(startX, lastY, startX, barY);
      }
      
      if (i + 1 < historyData.basals.length) {
        let nextBarHeight = (nextPoint.rate / maxBasal) * BASAL_SCALE;
        let nextPointBarY = BASELINE_BASALS - nextBarHeight;
        g.drawLine(endX, barY, endX, nextPointBarY);
        lastVerticalBarX = endX;
      } else {
        g.drawLine(endX, barY, endX, BASELINE_BASALS);
      }
      lastY = barY;
    }
  }
  
  // Insulin Rendering
  historyData.insulin.forEach(t => {
      let start = Math.round(new Date(t.ts).getTime());
      if (t.insulin) {
          let bolusX = graphX + graphW * (start - graphStartTime) / ninetyMinutesMillis;
          let triangle_half_width = 3;
          if (bolusX > graphX && bolusX < graphX + graphW) {

              // 1. Define the 3 vertices of the triangle
              let baseline = BASELINE_BOLUSES;
              if (+t.amount > 0.9) {
                baseline -= 8;
              }
              const y_top = baseline + 8; // Top top of the triangle
              const y_bottom = y_top + 0.866 * triangle_half_width * 2; // Bottom of the triangle (Pythagoras)

              const vertices = [
                bolusX, y_top,
                bolusX - triangle_half_width, y_bottom,  
                bolusX + triangle_half_width, y_bottom
              ];

              g.setColor("#0000FF");
              g.fillPoly(vertices);
          }
      }
  });
  
  // Glucose Line Rendering
  if (historyData.glucose.length >= 1) {
    for (let i = 0; i < historyData.glucose.length; i++) {
        let p1 = historyData.glucose[i];
        let p1_mmol = p1.sgv / MGDL_TO_MMOL;
        let p2 = currentStatusData; 
        if (i < historyData.glucose.length-1){
          p2 = historyData.glucose[i+1];
        }
        let p2_mmol = p2.sgv / MGDL_TO_MMOL;
        let x1 = Math.round(graphX + graphW * (p1.ts - graphStartTime) / ninetyMinutesMillis);
        let y1 = Math.round(BASELINE_BG - (((p1_mmol - MIN_MMOL_SCALE) / (MAX_MMOL_SCALE - MIN_MMOL_SCALE)) * h));
        let x2 = Math.round(graphX + graphW * (p2.ts - graphStartTime) / ninetyMinutesMillis);
        let y2 = Math.round(BASELINE_BG - (((p2_mmol - MIN_MMOL_SCALE) / (MAX_MMOL_SCALE - MIN_MMOL_SCALE)) * h));
        
        if (x1 >= graphX && x2 <= graphX+graphW) {
          if (p1_mmol < LOW_MMOL || p2_mmol< LOW_MMOL || p1_mmol > HIGH_MMOL || p2_mmol > HIGH_MMOL) {
            g.setColor("#FF0000");
          } else {
             g.setColor("#00FF00");
          }
          for (let xo = -1; xo < 2; xo++){
            for (let yo = -1; yo < 2; yo++){
              g.drawLine(x1+xo, y1+yo, x2+xo, y2+yo);
            }
          }
        }
    }
  }
}

function setupGestures() {
  console.log("setupGestures()");
  let drag; 

  Bangle.on('drag', e => {
    if (dialogActive) return;
    if (!drag) { 
      drag = { x: e.x, y: e.y, start_y: e.y };
    }
    if (e.b) {
      drag.x = e.x;
      drag.y = e.y;
    }
    if (!e.b) {
      const dx = e.x - drag.x;
      const dy = e.y - drag.y;
      drag = undefined;

      const SWIPE_THRESHOLD = 40;

      if (Math.abs(dx) > Math.abs(dy) + 10) { 
        if (dx > SWIPE_THRESHOLD && settings.swipeRight) Bangle.load(settings.swipeRight + ".app.js");
        else if (dx < -SWIPE_THRESHOLD && settings.swipeLeft) Bangle.load(settings.swipeLeft + ".app.js");
      } else { 
        if (dy > SWIPE_THRESHOLD && settings.swipeDown) Bangle.load(settings.swipeDown + ".app.js");
        else if (dy < -SWIPE_THRESHOLD && settings.swipeUp) Bangle.load(settings.swipeUp + ".app.js");
      }
    }
  });

  Bangle.on('touch', () => {
    if (drag) return;
    if (dialogActive) return;

    if (tapTimeout) {
      clearTimeout(tapTimeout); 
      tapTimeout = undefined;
      showTreatmentCarbs();
    } else {
      tapTimeout = setTimeout(() => {
        tapTimeout = undefined;
        showMainMenu();
      }, 300); 
    }
  });
}

function loadSettings() {
  settings = require('Storage').readJSON('aaps.settings.json', 1) || {
    swipeUp: '',
    swipeDown: 'messages',
    swipeLeft: '',
    swipeRight: '',
    swipeBottomUp: '',
    debugLogs: 0,
    uploadHR: false,
    uploadSteps: false,
  };
}

function sendHeartRate() {
  if (!settings.uploadHR) return;
  Bangle.setHRMPower(1); 
  Bangle.on('HRM', (hrm) => {
    Bangle.setHRMPower(0); 

    if (hrm.confidence > 80 && hrm.bpm !== lastHeartRate) {
      lastHeartRate = hrm.bpm;
      console.log("Sending HR:", hrm.bpm);
      const url = `http://127.0.0.1:28891/heartrate?bpm=${hrm.bpm}`;
      Bangle.http(url).catch(e => console.log("HR upload error:", e));
    }
  });
}

function sendStepCount() {
  if (!settings.uploadSteps) return;

  const steps = Bangle.getHealthStatus("day").steps;

  if (steps !== lastStepCount) {
    lastStepCount = steps;
    console.log("Sending Steps:", steps);
    const url = `http://127.0.0.1:28891/steps?steps=${steps}`;
    Bangle.http(url).catch(e => console.log("Steps upload error:", e));
  }
}

function lastTimestamp(list) {
  return list.length > 0 ? list[list.length-1].ts : -1;
}

function handleConfirmActionJson(confirmEvent) {
    Bangle.buzz();
    dialogActive = true; 
    console.log("confirmEvent.message: "+confirmEvent.message);
    let message = confirmEvent.message.replaceAll("<br/>", "\n");
    
    lib.confirmDialog(confirmEvent.eventType, message, () => {
      dialogActive = false; 
      E.showMessage("Cancelled.");
      setTimeout(() => { hideMenuAndDraw(); }, 300); 
    }, () => {
      dialogActive = false; 
      lib.sendCommand(confirmEvent.returnCommandType, confirmEvent.returnCommandJson);
      E.showMessage("Confirmed.\nSending...");
      setTimeout(() => { hideMenuAndDraw();}, 300);
    });
}

function sendCommandAndWait(command, data) {
  lib.sendCommand(command, data);
  E.showMessage("Sending...");
  setTimeout(() => { consumeAapsQueue(); draw(); dialogActive = false;}, 1000);
}

// --- UI Flow for Bolus / Carbs ---
let treatmentParams = { carbs: 0, insulin: 0 };
function showTreatmentCarbs() {
  dialogActive = true;
  lib.showNumberEntry("Carbs (g)", treatmentParams.carbs, 5, "g", (carbs) => {
    if (carbs === null) { showMainMenu(); return; } 
    treatmentParams.carbs = carbs;
    showTreatmentInsulin();
  });
}

function showTreatmentInsulin() {
  dialogActive = true;
  lib.showNumberEntry("Insulin (U)", treatmentParams.insulin, 0.5, "U", (insulin) => {
    if (insulin === null) { showTreatmentCarbs(); return; } 
    treatmentParams.insulin = insulin;
    sendCommandAndWait("ActionBolusPreCheck", treatmentParams);
    treatmentParams = { carbs: 0, insulin: 0 };
    hideMenu();
  });
}

function hideMenuAndDraw() {
  //E.showMenu();
  //dialogActive = false;
  hideMenu();
  draw();
}

function hideMenu() {
  console.log("hiding menu");
  E.showMenu();
  dialogActive = false;
  Bangle.setUI("clock");
}

// --- UI Flow for Temp Targets ---
function showTempTargetMenu() {
  dialogActive = true;
  const menu = {
    "" : { "title" : "Temp Target" },
    "< Back" : showMainMenu,
    "Eating Soon": () => {hideMenu(); sendCommandAndWait("ActionTempTargetPreCheck", { command: "PRESET_EATING" })},
    "Activity": () => {hideMenu(); sendCommandAndWait("ActionTempTargetPreCheck", { command: "PRESET_ACTIVITY" })},
    "Hypo": () => {hideMenu(); sendCommandAndWait("ActionTempTargetPreCheck", { command: "PRESET_HYPO" })},
    "Cancel": () => {hideMenu(); sendCommandAndWait("ActionTempTargetPreCheck", { command: "CANCEL" })},
  };
  E.showMenu(menu);
}

// --- UI Flow for Profile Switch ---
let profileSwitchParams = { percentage: 100, duration: 0, timeShift: 0 };
function showProfileSwitchPercent() {
  dialogActive = true;
  lib.showNumberEntry("Percent (%)", profileSwitchParams.percentage, 10, "%", (percent) => {
    if (percent === null) { showMainMenu(); return; }
    profileSwitchParams.percentage = percent;
    E.showMenu();
    showProfileSwitchDuration();
  });
}

// --- UI Flow for Profile Switch ---
function showProfileSwitchDuration() {
  dialogActive = true;
  lib.showNumberEntry("Duration (min)", profileSwitchParams.duration, 30, "min", (duration) => {
    if (duration === null) { showProfileSwitchPercent(); }
    profileSwitchParams.duration = duration;
    hideMenu();
    sendCommandAndWait("ActionProfileSwitchPreCheck", profileSwitchParams);
  });
}

function refreshData() {
  historyData.glucose = [];
  historyData.insulin = [];
  historyData.basals = [];
  lib.sendCommand("RequestInitialData");
  hideMenuAndDraw();
}

// --- The Main Menu ---
function showMainMenu() {
  dialogActive = true;
  const mainMenu = {
    "" : { "title" : "AAPS Menu" },
    "< Back" : hideMenuAndDraw,
    'Treatment': showTreatmentCarbs,
    'Temp Target': showTempTargetMenu,
    'Profile Switch': showProfileSwitchPercent,
    'Refresh Data': refreshData,
  };
  E.showMenu(mainMenu);
}

function housekeeping() {
  console.log('housekeeping');
  if (settings['debugLogs'] > 0) {
    currentDebugLog = (currentDebugLog+1)%settings['debugLogs'];
    let fileName = "aaps.debug."+currentDebugLog;
    console.log('configured to save logs. saving '+fileName);
    require("Storage").write(fileName, (Date.now())+'\n\n'+JSON.stringify(historyData.basals)+' \n\n'+runningDebugLog);
    runningDebugLog = '';
  }
}

function start() {
  Bangle.setUI("clock");
  Bangle.loadWidgets();

  loadSettings();
  draw();

  lib.sendCommand("RequestInitialData", {});
  consumeAapsQueue(); // Initial dynamic RAM sync validation

  setInterval(housekeeping, 60000); 
  setInterval(consumeAapsQueue, 5000); // Check RAM queue timeline buffer safely every 5 seconds
  
  Bangle.on('lcdPower', (on) => { if (on) draw(); });
  setupGestures();

  setInterval(sendHeartRate, 3 * 60 * 1000);
  setInterval(sendStepCount, 10 * 60 * 1000);

  setTimeout(() => {
    sendHeartRate();
    sendStepCount();
  }, 2000);
}

// Run the setup
start();
