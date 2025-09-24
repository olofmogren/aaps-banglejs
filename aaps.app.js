/*
 * This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 * You should have received a copy of the GNU General Public License along with this program. If not, see <https://www.gnu.org/licenses/>. 
 *
 * Author: Olof Mogren
 * Year: 2025
 *
 */

const lib = require('aaps-lib.js');

// === GLOBAL DATA and CONSTANTS
// ===================================================================================
const MGDL_TO_MMOL = 18.0182;
const HIGH_MMOL = 10.0;
const LOW_MMOL = 4.0;
const H = g.getHeight();
const W = g.getWidth();
let drawTimeout;
let eventQueueInterval;
let commandCheckInterval;
// === EVENT QUEUE PROCESSING ===
const STATUS_FILE = "aaps.current.status";
const HISTORY_BG_FILE = "aaps.history.bg";
const HISTORY_INSULIN_FILE = "aaps.history.insulin";
const HISTORY_BASALS_FILE = "aaps.history.basals";

const EVENT_FILE_PREFIX = "aaps.events."
const MAX_NUMBER_OF_EVENT_FILES = 5

// === GLOBAL DATA and CONSTANTS ===
let currentStatusData = { sgv: "---", delta: "---", trend: "FLAT", iob: "---", cob: "---", basal: '---', ts: 0 };
let historyData = { glucose: [], insulin: [], carbs: [], basals: [], glucoseUpdated: -1, insulinUpdated: -1, carbsUpdated: -1, basalsUpdated: -1, stale: true };
let clockInterval; // To keep track of the main clock timer
let settings;
let tapTimeout; // to track the tap timer for double-taps
let lastStepCount = 0;
let lastReadEventFile = -1
let dialogActive = false; //hinders the watch face from updating the screen.
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
  // 1. Handle the edge case of an empty array.
  //console.log("insertSorted: "+deleteUntilTs)
 
  insertSortedHelper(sortedArray, newElement, onlyIfChanged, key);
  deleteUntil(sortedArray, deleteUntilTs);
}
function insertSortedHelper(sortedArray, newElement, onlyIfChanged, key) {
  // 1. Handle the edge case of an empty array.
  if (sortedArray.length === 0) {
    sortedArray.push(newElement);
    return;
  }

  // 2. --- The Fast Path Optimization ---
  // Check if the new element belongs at the very end of the array.
  
  const lastTS = lastTimestamp(sortedArray);
  //console.log("inserting "+newElement.ts+". last ptev:"+lastTS);
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

  // --- The Binary Search Path (for out-of-order or in-between data) ---
  let low = 0;
  let high = sortedArray.length - 1;

  while (low <= high) {
    // Find the middle index
    let mid = Math.floor((low + high) / 2);
    let midElement = sortedArray[mid];

    // Check for an exact timestamp match to update in place
    if (newElement.ts === midElement.ts) {
      sortedArray[mid] = newElement; // Overwrite existing element
      return;
    }

    if (newElement.ts < midElement.ts) {
      high = mid - 1;
    } else { // newElement.ts > midElement.ts
      low = mid + 1;
    }
  }
  
  // 4.
  // After the loop, 'low' is the correct insertion index.
  const insertIndex = low;

  // Insert the element at the found index using .splice()
  if (!onlyIfChanged || insertIndex == 0 || sortedArray[insertIndex-1][key] != newElement[key] || insertIndex == sortedArray.length || sortedArray[insertIndex] != newElement) {
    sortedArray.splice(insertIndex, 0, newElement);
  }
}
function deleteUntil(sortedArray, deleteUntilTs){
  if (deleteUntilTs!==undefined && sortedArray.length > 0) {
    if (sortedArray[0].ts === undefined){
      // this can probably be removed
      console.log("undefined in sortedArray!");
      console.log(JSON.stringify(sortedArray));
    }
    while (sortedArray.length > 0 && sortedArray[0].ts < deleteUntilTs ) {
      //console.log("deleting "+sortedArray[0].ts+". (until "+deleteUntilTs+")");
      sortedArray.shift();
    }
  }
}
// === MASTER DRAW FUNCTION ===
// This function is very fast because it doesn't read any files.
function draw() {
  if (dialogActive) {
    //if we are currently showing an active dialog, we should not update the screen.
    return;
  }

  // --- This is how we keep the time updated ---
  if (clockInterval) clearInterval(clockInterval);
  clockInterval = setTimeout(() => {
    if (Bangle.isLCDOn()){
      draw();
    }
  }, 60000 - (Date.now() % 60000));
  // ---
  
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

  if (glucoseMmol >= HIGH_MMOL || glucoseMmol <= LOW_MMOL) textColor = "#F00"; // Red if out of range

  const sgvText = (currentStatusData.sgv && (glucoseMmol.toString() != "NaN")) ? glucoseMmol.toFixed(1) : "---";
  const mainBgX = x + w / 2;
  const mainBgY = y + 20;

  // --- Calculate the age of the reading ---
  let minutesAgo = 100; // Default if no data
  // Check if we have a valid timestamp
  if (currentStatusData.ts > 0) {
    // Difference in milliseconds
    let timeDiff = Date.now() - currentStatusData.ts;
    // Convert to minutes and round to the nearest whole number
    minutesAgo = Math.round(timeDiff / 60000);
  }

  if (minutesAgo > 5) {
    let textColor = "#999";
  }
  
  g.setFontAlign(0, 0);
  g.setColor(textColor).setFont("Vector", 32).drawString(sgvText, mainBgX, mainBgY);
  
  if (minutesAgo > 1) {
    // Get the width of the BG text to position the superscript correctly
    const sgvTextWidth = g.stringWidth(currentStatusData.sgv);
    
    // Calculate position: to the right of the main text, and raised up
    const superscriptX = mainBgX + (sgvTextWidth / 2) + 3; // 3px gap
    const superscriptY = mainBgY - 10; // 10px higher than the main text's center

    g.setFontAlign(-1, 0); // Left-align the superscript
    g.setFont("Vector", 12); // Use a small but readable font
    g.drawString(`(${minutesAgo})`, superscriptX, superscriptY);
  }
  
  g.setColor("#000"); 
  deltaMmol = (Math.round(10*(currentStatusData.delta / MGDL_TO_MMOL))/10).toString();
  if (deltaMmol.toString() == "NaN") {
    deltaMmol = "";
  }
  else if (deltaMmol[0] != '-') {
    deltaMmol = "+"+deltaMmol;
  }
  if (!deltaMmol.includes(".")) {
    deltaMmol = deltaMmol+".0";
  }
  g.setFont("Vector", 16).drawString(deltaMmol, x + w/2 - 10, y + 48);
  drawTrendArrow(x + w/2 + 25, y + 48, currentStatusData.trend);

  g.setFont("Vector", 14).setFontAlign(0, 0);
  
  let lengths = historyData.glucose.length + " " + historyData.insulin.length + " " + historyData.basals.length;
  g.drawString(lengths, x + w/2, y + h - 64);
  
  let basal = (currentStatusData.basal != null)?currentStatusData.basal:"---";
  let cob = (currentStatusData.cob != "---")?Math.round(currentStatusData.cob).toString():"---";
  let iob = currentStatusData.iob.toString()
  
  g.drawString("BAS: "+basal, x + w/2, y + h - 48);
  g.drawString("COB: "+cob, x + w/2, y + h - 32);
  g.drawString("IOB: "+iob, x + w/2, y + h - 16);
  
  g.setColor("#FF0000"); // Red separator line
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
  const BASAL_SCALE = 16.0; // Define max basal scale
  
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


  // 0. x-ticks

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
  

  // 1. Basals in the bottom
  if (historyData.basals.length > 0) {
    let maxBasal = 0.0;
    // First loop to find the maximum basal rate for scaling
    for (let i = 0; i < historyData.basals.length; i++) {
      if (historyData.basals[i].rate > maxBasal) {
          maxBasal = historyData.basals[i].rate;
      }
    }
    // Set a minimum maxBasal to avoid division by zero
    if (maxBasal === 0) maxBasal = 1.0;

    let lastY = BASELINE_BASALS;
    let lastVerticalBarX = graphX; // Start at the beginning of the graph

    // Second loop to draw the basal bars
    for (let i = 0; i < historyData.basals.length; i++) {
      let currentPoint = historyData.basals[i];
      let nextPoint = (i + 1 < historyData.basals.length) ? historyData.basals[i+1] : { ts: now, rate: 0.0 };

      // Use ninetyMinutesMillis for time scaling
      let startX = graphX + (currentPoint.ts - graphStartTime) * graphW / ninetyMinutesMillis;
      if (currentPoint.ts < graphStartTime){
        continue;
      }
      let endX = graphX + graphW * (nextPoint.ts - graphStartTime) / ninetyMinutesMillis;

      //console.log('plotting basal'+currentPoint.rate)

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
  
  // 2. insulin in the middle
  
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
  
  
  // 3. glucose history on top of all.
  if (historyData.glucose.length >= 1) {
    let firstAgo = Math.round((now- historyData.glucose[0].ts)/1000);
  let lastAgo = Math.round((now- lastTimestamp(historyData.glucose))/1000);
  //console.log("drawing bgs. "+firstAgo+" to "+lastAgo+"s ago");
    //let radius = 1;
    for (let i = 0; i < historyData.glucose.length; i++) {
        let p1 = historyData.glucose[i];
        //console.log("p1:",p1)
        let p1_mmol = p1.sgv / MGDL_TO_MMOL;
        let p2 = currentStatusData; // for the last point only
        if (i < historyData.glucose.length-1){
          p2 = historyData.glucose[i+1];
        }
        let p2_mmol = p2.sgv / MGDL_TO_MMOL;
        let x1 = Math.round(graphX + graphW * (p1.ts - graphStartTime) / ninetyMinutesMillis);
        let y1 = Math.round(BASELINE_BG - (((p1_mmol - MIN_MMOL_SCALE) / (MAX_MMOL_SCALE - MIN_MMOL_SCALE)) * h));
        let x2 = Math.round(graphX + graphW * (p2.ts - graphStartTime) / ninetyMinutesMillis);
        let y2 = Math.round(BASELINE_BG - (((p2_mmol - MIN_MMOL_SCALE) / (MAX_MMOL_SCALE - MIN_MMOL_SCALE)) * h));
        if (x1 >= graphX && x2 <= graphX+graphW) {
          if (p1_mmol < LOW_MMOL || p2_mmol< LOW_MMOL) {
            g.setColor("#FF0000");
          }
          else if (p1_mmol  > HIGH_MMOL || p2_mmol  > HIGH_MMOL) {
            g.setColor("#FF0000");
          }
          else {
             g.setColor("#00FF00");
          }
          // we'll draw nine thin lines, to make it look like one thick line
          for (let xo = -1; xo < 2; xo++){
            for (let yo = -1; yo < 2; yo++){
              g.drawLine(x1+xo, y1+yo, x2+xo, y2+yo);
            }
          }
        }
      
    }
  }
}



// This is the new, complete gesture handling function.
function setupGestures() {
  let drag; // To track swipe events

  Bangle.on('drag', e => {
    // This drag logic is correct and remains the same.
    // It handles all the swipe gestures
    if (dialogActive) return;
    
    console.log('drag detected')
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
      const startY = drag.start_y;
      drag = undefined;

      const SWIPE_THRESHOLD = 40;

      if (Math.abs(dx) > Math.abs(dy) + 10) { // Horizontal
        if (dx > SWIPE_THRESHOLD && settings.swipeRight) Bangle.load(settings.swipeRight + ".app.js");
        else if (dx < -SWIPE_THRESHOLD && settings.swipeLeft) Bangle.load(settings.swipeLeft + ".app.js");
      } else { // Vertical
        if (dy > SWIPE_THRESHOLD && settings.swipeDown) Bangle.load(settings.swipeDown + ".app.js");
        else if (dy < -SWIPE_THRESHOLD) {
          if (settings.swipeUp) {
             Bangle.load(settings.swipeUp + ".app.js");
          }
        }
      }
    }
  });

  Bangle.on('touch', () => {
    // If a drag is in progress, ignore the touch event.
    if (drag) return;
    if (dialogActive) return;

    if (tapTimeout) {
      // If a timer is already running, this is the SECOND tap.
      // It's a double-click!
      clearTimeout(tapTimeout); // Cancel the single-click timer
      tapTimeout = undefined;
      
      //console.log("Double-click detected, launching treatment menu.");
      // The settings for a Bangle.js app are typically named 'app.settings.js'
      showTreatmentCarbs();
    } else {
      // This is the FIRST tap.
      // Start a timer. If it finishes, it's a single-click.
      tapTimeout = setTimeout(() => {
        tapTimeout = undefined;
        //console.log("Single-click detected, launching AAPS Menu.");
        showMainMenu();
      }, 300); // 300ms is a good timeout for double-clicks
    }
  });
}

function loadSettings() {
  // Load settings from the file, providing safe defaults if the file doesn't exist
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
  // Bangle.getHealthStatus("day") is not ideal for real-time HRM.
  // A better approach is to turn on the HRM and listen for events.
  // For simplicity, we'll use a direct reading here.
  if (!settings.uploadHR) return;
  Bangle.setHRMPower(1); // Turn on the HRM
  Bangle.on('HRM', (hrm) => {
    Bangle.setHRMPower(0); // Turn it off immediately to save power

    // Only send if the confidence is high and the value has changed
    if (hrm.confidence > 80 && hrm.bpm !== lastHeartRate) {
      lastHeartRate = hrm.bpm;
      console.log("Sending HR:", hrm.bpm);
      const url = `http://127.0.0.1:28891/heartrate?bpm=${hrm.bpm}`;
      Bangle.http(url).catch(e => console.log("HR upload error:", e));
    }
  });
}

function sendStepCount() {
  // Get the current step count from the pedometer
  if (!settings.uploadSteps) return;

  const steps = Bangle.getHealthStatus("day").steps;

  if (steps !== lastStepCount) {
    lastStepCount = steps;
    console.log("Sending Steps:", steps);
    const url = `http://127.0.0.1:28891/steps?steps=${steps}`;
    Bangle.http(url).catch(e => console.log("Steps upload error:", e));
  }
}

function processFiles() {
   var needsRedraw = (new Date().getMinutes()) != lastDrawMinutes;
   //console.log("processFiles. BG len:"+historyData.glucose.length);
   for (let i = 0; i < MAX_NUMBER_OF_EVENT_FILES; i++) {
      let currentFileName = EVENT_FILE_PREFIX+String(i).padStart(2, '0');
      let content = require("Storage").read(currentFileName);
      //console.log("processing "+currentFileName);
      if (content !== undefined) {
        console.log("event found in "+currentFileName);
        const events = content.trim().split('\n');
        events.forEach(line => {
          if (!line) continue; // Skip empty lines
          console.log("processing line "+line);
          if (handleSingleEvent(line)) {
            needsRedraw = true;
          }
        });
        console.log("processed "+currentFileName);
        require("Storage").erase(currentFileName);
        //console.log("erased "+currentFileName);
      }
   }
   needsRedraw = needsRedraw || updateCurrentData();
   needsRedraw = needsRedraw || checkForNewHistory();
   if (needsRedraw) {
     draw();
   }
}

// This function handles a single event and returns 'true' if a redraw is needed.
// It uses the "HashMap" pattern to de-duplicate history.
function handleSingleEvent(ev) {
  obj = JSON.parse(ev);
  // receiving: EventNewBG, EventIOB, EventCOB, EventBasal, GlucoseHistory, TreatmentHistory, BasalsHistory, ConfirmAction
  // other direction: ActionBolusConfirmed, 

  switch (obj.eventType) {
    case "ConfirmAction":
      // When a confirmation event arrives, handle it directly.
      console.log("ConfirmAction received by AAPS on watch.");
      handleConfirmActionJson(obj);
      return false;
      break;
    default:
      console.log("Received event which did not match any expected eventtypes:"+ev);
      return false
    // ... add other cases
  }

  return false;
}

function lastTimestamp(list) {
  if (list.length > 0) {
    return list[list.length-1].ts
  }
  else
  {
    return -1;
  }
}

function updateCurrentData() {
  let now = Math.round(new Date().getTime());
  let tenMinutesAgoMillis = now - 10 * 60 * 1000;
  let ninetyMinutesAgoMillis = now - 90 * 60 * 1000;
  var basalChanged = false;
  var needsRedraw = false;
  let newStatusData = require("Storage").readJSON(STATUS_FILE, false);
  for (let key in newStatusData) {
    let val = newStatusData[key];
    if (key == "basal") {
      basalChanged = currentStatusData[key] != val;
      if (basalChanged) {
      console.log("basal changed: "+basalChanged+": "+currentStatusData[key]+"("+typeof(currentStatusData[key])+") => "+val+"("+typeof(val)+")");
      }
    }
    needsRedraw = currentStatusData[key] != val;
    if (key=='ts') {
      runningDebugLog += 'updateCurrentData: old ts: '+currentStatusData.ts+', new ts: '+val+'\n';
    }
    currentStatusData[key] = +val;
  }
  
  // save every five minutes (more than 4.5) in historyData.glucose:
  let timeDiff = currentStatusData.ts - (lastTimestamp(historyData.glucose));
  runningDebugLog += 'updateCurrentData: timeDiff: '+timeDiff+'\n';
  //console.log("bg timediff: "+(timeDiff/1000)+"s");
  let allowAfter = Math.round(4.5 * 60 * 1000);
  //console.log("allowed: "+allowAfter);
  if (timeDiff>allowAfter){
    //console.log("inserting bg");
    let lastAgo = now- currentStatusData.ts;
    //console.log("inserting bg. from "+(lastAgo/1000)+"s ago");
    insertSorted(historyData.glucose, {ts: currentStatusData.ts, sgv: currentStatusData.sgv}, ninetyMinutesAgoMillis, false, "sgv");
  }
  if (basalChanged) {
    //console.log("inserting changed basal");
    /*while (historyData.basals.length > 1 && historyData.basals[historyData.basals.length-1].ts > allowAfter) {
      historyData.basals.pop();
    }*/
    runningDebugLog += 'updateCurrentData: insertSorted('+historyData.basals.length+' '+currentStatusData.ts+' '+currentStatusData.basal+'\n';
    insertSorted(historyData.basals, {ts: currentStatusData.ts, rate: currentStatusData.basal}, ninetyMinutesAgoMillis, true, "rate");
  }
  return needsRedraw;
}

function checkForNewHistory() {
  var needsRedraw = false;
  let ninetyMinutesAgoMillis = Math.round(new Date().getTime() - 90 * 60 * 1000);
  let files = [HISTORY_BG_FILE, HISTORY_INSULIN_FILE, HISTORY_BASALS_FILE];
  let currentBgHistoryLen = historyData.glucose.length;
  let currentBgHistoryStart = (historyData.glucose.length > 0)?historyData.glucose[0].ts:-1;
  let currentBgHistoryEnd =  (historyData.glucose.length > 0)?lastTimestamp(historyData.glucose):-1;
  files.forEach(f => {
    //console.log("checking "+f);
    let content = require("Storage").read(f);
    let updatedNow = 0;
    if (content != undefined) {
      data = JSON.parse(content).data;
      //let lines = content.split('\n');
      let lastUpdated = (f == HISTORY_BG_FILE)?historyData.glucoseUpdated:(f == HISTORY_INSULIN_FILE)?historyData.insulinUpdated:historyData.basalsUpdated;
      if (historyData.stale) {
        runningDebugLog += 'historyData stale. resetting.'+'\n';
        historyData = { glucose: [], insulin: [], carbs: [], basals: [], glucoseUpdated: -1, insulinUpdated: -1, carbsUpdated: -1, basalsUpdated: -1, stale: false };
      }
      //console.log("lastUpdated:"+lastUpdated)
      //lines.forEach(line => {
      data.forEach(obj => {
        //let pairs = line.split(',');
        //let obj = {};
        //pairs.forEach(p => {
        //  const pair = p.split(':');
        //  const key = pair[0]; const val = +pair[1]; //conversion to number
        //if (key) {
        //  obj[key] = val;
        //}
        //});
        if (obj.ts > lastUpdated){
          //console.log("found new data! "+obj.ts+" "+lastUpdated);
          if (f == HISTORY_BG_FILE) {
            // glucose history
            if (currentBgHistoryLen == 0 || obj.ts < currentBgHistoryStart || obj.ts > currentBgHistoryEnd) {
            insertSorted(historyData.glucose, obj, ninetyMinutesAgoMillis, false, "sgv");
            }
          }
          else if (f == HISTORY_INSULIN_FILE) {
              insertSorted(historyData.insulin, obj, ninetyMinutesAgoMillis, false, "amount");
          }
          else if (f == HISTORY_BASALS_FILE) {
            runningDebugLog += 'checkForNewHistory: insertSorted('+historyData.basals.length+' '+obj.ts+' '+obj.rate+'\n';
            insertSorted(historyData.basals, obj, ninetyMinutesAgoMillis, true, "rate");
          }
        }
        if ( obj.ts > updatedNow ) updatedNow = obj.ts;
        needsRedraw = true;
      });
      let content = require("Storage").erase(f);
    }
    if (f == HISTORY_BG_FILE) historyData.glucoseUpdated = updatedNow;
    else if (f == HISTORY_INSULIN_FILE) historyData.insulinUpdated = updatedNow;
    else if (f == HISTORY_BASALS_FILE) historyData.basalsUpdated = updatedNow;

  });
    //TODO: is this next line right?
    historyData.stale = needsRedraw;
    return needsRedraw;
  }

  function handleConfirmActionJson(confirmEvent) {

    confirmEvent.returnCommandJson = confirmEvent.returnCommandJson; 

    Bangle.buzz();

    dialogActive = true; //hinders the watch face from updating the screen.
    console.log("confirmEvent.message: "+confirmEvent.message);
    message = confirmEvent.message.replaceAll("<br/>", "\n");
    lib.confirmDialog(confirmEvent.eventType, message, () => {
      //console.log("User cancelled action.");
      dialogActive=false; //lets the watch face update the screen.
      E.showMessage("Cancelled.");
      setTimeout(() => { hideMenuAndDraw(); }, 300); // if longer, the main menu pops up for some reason
    }, () => {
      //console.log("User confirmed. Sending action.");
      dialogActive=false; //lets the watch face update the screen.
      lib.sendCommand(confirmEvent.returnCommandType, confirmEvent.returnCommandJson);
      E.showMessage("Confirmed.\nSending...");
      setTimeout(() => { hideMenuAndDraw();}, 300);
    });
}


// Helper function to send a command and wait for response
function sendCommandAndWait(command, data) {
  lib.sendCommand(command, data);
  E.showMessage("Sending...");
  setTimeout(() => { processFiles(); draw(); dialogActive = false;}, 1000);
}

// --- UI Flow for Bolus / Carbs ---
let treatmentParams = { carbs: 0, insulin: 0 };
function showTreatmentCarbs() {
  dialogActive = true;
  lib.showNumberEntry("Carbs (g)", treatmentParams.carbs, 5, "g", (carbs) => {
    if (carbs === null) { showMainMenu(); return; } // Go back to main menu
    treatmentParams.carbs = carbs;
    showTreatmentInsulin();
  });
  //hideMenu();
}
function showTreatmentInsulin() {
dialogActive = true;
  lib.showNumberEntry("Insulin (U)", treatmentParams.insulin, 0.5, "U", (insulin) => {
    if (insulin === null) { showTreatmentCarbs(); return; } // Go back to carbs
    treatmentParams.insulin = insulin;
    // We have all the data. Send the final command.
    sendCommandAndWait("ActionBolusPreCheck", treatmentParams);
    treatmentParams = { carbs: 0, insulin: 0 };
    hideMenu();
  });
}
function hideMenuAndDraw() {
  E.showMenu();
  dialogActive = false;
  draw();
}
function hideMenu() {
  console.log("hiding menu");
  E.showMenu();
  dialogActive = false;
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
function showProfileSwitchDuration() {
  dialogActive = true;
  
  lib.showNumberEntry("Duration (min)", profileSwitchParams.duration, 30, "min", (duration) => {
    if (duration === null) { showProfileSwitchPercent(); }
    profileSwitchParams.duration = duration;
    // We have all the data. Send the final command.
    hideMenu();
    sendCommandAndWait("ActionProfileSwitchPreCheck", profileSwitchParams);
  });
}

function refreshData() {
  historyData.stale = true;
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

  // Load settings from the file first
  loadSettings();
  
  draw();

  lib.sendCommand("RequestInitialData", {});
  processFiles(); // Initial read
  
  setInterval(housekeeping, 1*60000); // Poll files every 5s
  setInterval(processFiles, 5000); // Poll files every 5s
  Bangle.on('lcdPower', (on) => { if (on) draw(); });
  // Call the function to enable all our gestures
  setupGestures();

  // --- ADD TIMERS FOR SENSOR UPLOADS ---
  // Send heart rate every 3 minutes
  setInterval(sendHeartRate, 3 * 60 * 1000);
  // Send step count every 10 minutes
  setInterval(sendStepCount, 10 * 60 * 1000);

  // Send initial values on startup
  setTimeout(() => {
    sendHeartRate();
    sendStepCount();
  }, 2000); // Wait 2s for things to settle

}

// Run the setup
start();

