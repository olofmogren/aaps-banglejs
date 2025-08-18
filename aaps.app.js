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

// === EVENT QUEUE PROCESSING ===
const QUEUE_FILE = "aaps.in.q";


// === GLOBAL DATA and CONSTANTS ===
let currentStatusData = { sgv: "---", delta: "---", trend: "FLAT", iob: "---", cob: "---", ts: 0 };
let recentGlucoseHistory = {}
let historyData = { glucose: [], treatments: [], basals: [] };
let clockInterval; // To keep track of the main clock timer
let settings;
let tapTimeout; // to track the tap timer for double-taps

// === DATA HANDLING AND DRAWING ===

// ** OPTIMIZED: This function ONLY reads the lightweight files. **
function updateCurrentData() {
  let needsRedraw = false;

  const statusFile = require("Storage").readJSON("aaps_status.json", 1);
  if (statusFile && statusFile.ts > currentStatusData.ts) {
    currentStatusData = statusFile;
    needsRedraw = true;
  }

  // We only redraw if something new was loaded and the screen is on.
  if (needsRedraw && Bangle.isLCDOn()) {
    draw();
  }
}


function updateHistory(glucose, treatments, basals) {
  let now = new Date().getTime();
  let ninetyMinutesMillis = (90 * 60 * 1000);
  let historyStartTime = now - ninetyMinutesMillis;
  if (glucose != null && glucose.length > 0) {
    let tempMap = {}
    historyData.glucose.forEach(g => {
      tempMap[g.ts] = g;
    });
    glucose.forEach(g => {
      tempMap[g.ts] = g;
    });
    deleteOldHistoryEntries(tempMap, historyStartTime);
    historyData.glucose = Object.values(tempMap).sort((a, b) => a.ts - b.ts);
  }
  if (treatments != null && treatments.length > 0) {
    let tempMap = {}
    historyData.treatments.forEach(g => {
      tempMap[g.ts] = g;
    });
    treatments.forEach(g => {
      tempMap[g.ts] = g;
    });
    deleteOldHistoryEntries(tempMap, historyStartTime);
    historyData.treatments = Object.values(tempMap).sort((a, b) => a.ts - b.ts);
  }
  if (basals != null && basals.length > 0) {
    let tempMap = {}
    historyData.basals.forEach(g => {
      tempMap[g.ts] = g;
    });
    basals.forEach(g => {
      tempMap[g.ts] = g;
    });
    deleteOldHistoryEntries(tempMap, historyStartTime);
    historyData.basals = Object.values(tempMap).sort((a, b) => a.ts - b.ts);
  }
}

function deleteOldHistoryEntries(obj, thresholdTimestamp) {
  // THE CRITICAL FIX: Use Object.keys() to get an array of keys from the object.
  const allKeys = Object.keys(obj);

  const keysToDelete = allKeys.filter(key => key < thresholdTimestamp);

  // The 'delete' keyword is the correct way to remove a property from an object.
  keysToDelete.forEach(key => delete obj[key]);

}

// === MASTER DRAW FUNCTION ===
// This function is very fast because it doesn't read any files.
function draw() {
  // --- This is how we keep the time updated ---
  if (clockInterval) clearInterval(clockInterval);
  clockInterval = setTimeout(() => {
    if (Bangle.isLCDOn()){
      draw();
    }
  }, 60000 - (Date.now() % 60000));
  // ---

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

  const sgvText = currentStatusData.sgv ? glucoseMmol.toFixed(1) : "---";
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
  if (deltaMmol[0] != '-') {
    deltaMmol = "+"+deltaMmol;
  }
  if (!deltaMmol.includes(".")) {
    deltaMmol = deltaMmol+".0";
  }
  g.setFont("Vector", 16).drawString(deltaMmol, x + w/2 - 10, y + 48);
  drawTrendArrow(x + w/2 + 25, y + 48, currentStatusData.trend);

  let basal = (currentStatusData.basal != null)?currentStatusData.basal:"---";

  g.setFont("Vector", 14).setFontAlign(0, 0);
  g.drawString("BAS: "+basal, x + w/2, y + h - 48);
  g.drawString("COB: "+Math.round(currentStatusData.cob).toString(), x + w/2, y + h - 32);
  g.drawString("IOB: "+currentStatusData.iob.toString(), x + w/2, y + h - 16);
  
  g.setColor("#F00"); // Red separator line
  g.fillRect(x + w -1, y, x + w, y + h);
}

function drawTrendArrow(x, y, type) {
  g.setColor("#000");
  const ARROW_SIZE = 8;
  const T = 2; // shaft thickness

  if (!type) return;
  switch (type) {
    case "FLAT":
      // head
      g.fillPoly([x-ARROW_SIZE,y, x,y-ARROW_SIZE/2, x,y+ARROW_SIZE/2, x-ARROW_SIZE,y]);
      // shaft
      g.fillRect(x-ARROW_SIZE, y - T/2, x, y + T/2);
      break;

    case "UP":
      // head (tip at y-ARROW_SIZE)
      g.fillPoly([x, y-ARROW_SIZE, x-ARROW_SIZE/2, y, x+ARROW_SIZE/2, y, x, y-ARROW_SIZE]);
      // shaft (from base up to head)
      g.fillRect(x - T/2, y-ARROW_SIZE, x + T/2, y);
      break;

    case "DOWN":
      // head (tip at y+ARROW_SIZE)
      g.fillPoly([x, y+ARROW_SIZE, x-ARROW_SIZE/2, y, x+ARROW_SIZE/2, y, x, y+ARROW_SIZE]);
      // shaft (from base down to head)
      g.fillRect(x - T/2, y, x + T/2, y+ARROW_SIZE);
      break;

    case "FORTY_FIVE_UP":
      // shaft: slim parallelogram along SW -> NE
      g.fillPoly([
        x-ARROW_SIZE,   y+ARROW_SIZE - T,   // tail low
        x-ARROW_SIZE+T, y+ARROW_SIZE,       // tail high
        x+ARROW_SIZE,   y-ARROW_SIZE + T,   // near tip high
        x+ARROW_SIZE-T, y-ARROW_SIZE        // near tip low
      ]);

      // head: small right-isosceles triangle at tip
      g.fillPoly([
        x+ARROW_SIZE,   y-ARROW_SIZE,       // tip
        x+ARROW_SIZE-4, y-ARROW_SIZE,       // base left
        x+ARROW_SIZE,   y-ARROW_SIZE+4      // base down
      ]);
      break;

    case "FORTY_FIVE_DOWN":
      // shaft: slim parallelogram along NW -> SE
      g.fillPoly([
        x-ARROW_SIZE,   y-ARROW_SIZE + T,   // tail high
        x-ARROW_SIZE+T, y-ARROW_SIZE,       // tail low
        x+ARROW_SIZE,   y+ARROW_SIZE - T,   // near tip low
        x+ARROW_SIZE-T, y+ARROW_SIZE        // near tip high
      ]);

      // head: small right-isosceles triangle at tip
      g.fillPoly([
        x+ARROW_SIZE,   y+ARROW_SIZE,       // tip
        x+ARROW_SIZE-4, y+ARROW_SIZE,       // base left
        x+ARROW_SIZE,   y+ARROW_SIZE-4      // base up
      ]);
      break;

    default: ;
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
  let threshColor = g.getBgColor() == "#ffffff" ? [0.8,0,0] : [0,0,0];
  g.setColor.apply(g, threshColor);
  let highY = y + h - (((HIGH_MMOL - MIN_MMOL_SCALE) / (MAX_MMOL_SCALE - MIN_MMOL_SCALE)) * h);
  let lowY = y + h - (((LOW_MMOL - MIN_MMOL_SCALE) / (MAX_MMOL_SCALE - MIN_MMOL_SCALE)) * h);
  g.drawLine(graphX, highY, graphX + graphW, highY);
  g.drawLine(graphX, lowY, graphX + graphW, lowY);

  let now = new Date().getTime();
  let ninetyMinutesMillis = 90 * 60 * 1000;
  let graphStartTime = now - ninetyMinutesMillis;

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

    let lastY = y + h;
    let lastVerticalBarX = graphX; // Start at the beginning of the graph

    // Second loop to draw the basal bars
    for (let i = 0; i < historyData.basals.length; i++) {
      let currentPoint = historyData.basals[i];
      // Corrected: Removed semicolon
      let nextPoint = (i + 1 < historyData.basals.length) ? historyData.basals[i+1] : { ts: now, rate: currentPoint.rate };

      // Corrected: Use ninetyMinutesMillis for time scaling
      let startX = graphX + graphW * (currentPoint.ts - graphStartTime) / ninetyMinutesMillis;
      if (startX < graphX) continue;
      let endX = graphX + graphW * (nextPoint.ts - graphStartTime) / ninetyMinutesMillis;

      const MAX_BASAL_AS_MMOL = 8.0; // Define max basal scale
      let equivalentMmol = (currentPoint.rate / maxBasal) * MAX_BASAL_AS_MMOL;
      let barY = y + h - (((equivalentMmol - MIN_MMOL_SCALE) / (MAX_MMOL_SCALE - MIN_MMOL_SCALE)) * h);

      startX = Math.max(graphX, startX);
      endX = Math.min(graphX + graphW, endX);

      g.setColor("#00FFFF").fillRect(startX, barY, endX, y + h);
      g.setColor("#0000FF").drawLine(startX, barY, endX, barY);

      if (lastVerticalBarX < startX) {
        g.drawLine(startX, lastY, startX, barY);
      }

      // Corrected: use historyData.basals.length
      if (i + 1 < historyData.basals.length) {
        let nextEquivalentMmol = (nextPoint.rate / maxBasal) * MAX_BASAL_AS_MMOL;
        let nextPointBarY = y + h - (((nextEquivalentMmol - MIN_MMOL_SCALE) / (MAX_MMOL_SCALE - MIN_MMOL_SCALE)) * h);
        g.drawLine(endX, barY, endX, nextPointBarY);
        lastVerticalBarX = endX;
      } else {
        g.drawLine(endX, barY, endX, y + h);
      }

      lastY = barY;
    }
  }
  
  // 2. treatments in the middle
  
  historyData.treatments.forEach(t => {
      let start = new Date(t.ts).getTime();
      if (t.insulin) {
          let bolusX = graphX + graphW * (start - graphStartTime) / ninetyMinutesMillis;
          let triangle_half_width = 3;
          //if (bolusX > graphX && bolusX < graphX + graphW){
          //     g.fillCircle(bolusX, y + radius + 1, radius);
          //}
          if (bolusX > graphX && bolusX < graphX + graphW) {

              // 1. Define the 3 vertices of the triangle
              // The triangle will point downwards, with its tip at the bottom.
              const y_top = y + h - 12; // Top top of the triangle
              const y_bottom = y_top + 0.866 * triangle_half_width * 2; // Bottom of the triangle (Pythagoras)

              const vertices = [
                bolusX, y_top,              // Vertex 1: Top tip (at the center X)
                bolusX - triangle_half_width, y_bottom,   // Vertex 2: Top-left corner
                bolusX + triangle_half_width, y_bottom    // Vertex 3: Top-right corner
              ];

              // 2. Draw the filled triangle
              g.setColor("#0000FF");
              g.fillPoly(vertices);
          }
      }
  });
  
  // 3. glucose history on top of all.
  if (historyData.glucose.length >= 1) {
    let diameter = 2;
    for (let i = 0; i < historyData.glucose.length - 1; i++) {
        let p1 = historyData.glucose[i];
        let p1_mmol = p1.sgv / MGDL_TO_MMOL;
        let x1 = graphX + graphW * (new Date(p1.ts).getTime() - graphStartTime) / ninetyMinutesMillis;
        let y1 = y + h - (((p1_mmol - MIN_MMOL_SCALE) / (MAX_MMOL_SCALE - MIN_MMOL_SCALE)) * h);
        if (x1 >= graphX && x1 <= graphX+graphW) {
          if (p1_mmol < LOW_MMOL) {
            g.setColor("#FF0000");
          }
          else if (p1_mmol  > HIGH_MMOL) {
            g.setColor("#FF0000");
          }
          else {
             g.setColor("#00FF00");
          }
          g.fillCircle(x1, y1, diameter);
        }
      
    }
  }
}



// This is the new, complete gesture handling function.
function setupGestures() {
  let drag; // To track swipe events

  Bangle.on('drag', e => {
    // This drag logic is correct and remains the same.
    // It handles all the swipe gestures.
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

  // --- THIS IS THE NEW DOUBLE-CLICK LOGIC ---
  Bangle.on('touch', () => {
    // If a drag is in progress, ignore the touch event.
    if (drag) return;

    if (tapTimeout) {
      // If a timer is already running, this is the SECOND tap.
      // It's a double-click!
      clearTimeout(tapTimeout); // Cancel the single-click timer
      tapTimeout = undefined;
      
      console.log("Double-click detected, launching Settings.");
      // The settings for a Bangle.js app are typically named 'app.settings.js'
      Bangle.load("aaps.settings.js"); 

    } else {
      // This is the FIRST tap.
      // Start a timer. If it finishes, it's a single-click.
      tapTimeout = setTimeout(() => {
        tapTimeout = undefined;
        console.log("Single-click detected, launching AAPS Menu.");
        Bangle.load("aaps-menu.app.js");
      }, 300); // 300ms is a good timeout for double-clicks
    }
  });
}

function loadSettings() {
  // Load settings from the file, providing safe defaults if the file doesn't exist
  settings = require('Storage').readJSON('aaps.settings.json', 1) || {
    swipeUp: 'aaps-menu',
    swipeDown: 'messages',
    swipeLeft: '',
    swipeRight: '',
    swipeBottomUp: '',
  };
}

function processQueue() {
  // 1. Read the ENTIRE queue file into memory.
  const queueFile = require("Storage").open(QUEUE_FILE, 'r');
  const queueContent = queueFile.read(100000); // cutting off at 100kB. Not sure it will fit in mem.

  // If the file exists and has content...
  if (queueContent) {
    // 2. IMMEDIATELY delete the file. This "acknowledges" the batch.
    // AAPS can now start creating a new file.
    queueFile.erase();

    // 3. Process the content we read from memory.
    const events = queueContent.trim().split('\n');
    let needsRedraw = false;

    events.forEach(line => {
      if (!line) return; // Skip empty lines
      try {
        const event = JSON.parse(line);
        // handleSingleEvent returns true if a redraw is needed.
        if (handleSingleEvent(event)) {
          needsRedraw = true;
        }
      } catch (e) {
        console.log("JSON parsing error in queue:", e);
      }
    });

    // 4. After processing the whole batch, redraw if necessary.
    if (needsRedraw && Bangle.isLCDOn()) {
      draw();
    }
  }
}

// This function handles a single event and returns 'true' if a redraw is needed.
// It uses the "HashMap" pattern to de-duplicate history.
function handleSingleEvent(event) {
  // For history, we'll build it up in temporary maps.
  let tempGlucoseMap = {};
  let tempTreatmentMap = {};

  switch (event.eventType) {
    case "EventNewBG":
      // Always update current data
      currentStatusData.sgv = event.sgv;i
      currentStatusData.trend = event.trend;
      currentStatusData.delta = event.delta;
      currentStatusData.iob = event.iob;
      currentStatusData.cob = event.cob;
      currentStatusData.basal = event.basal;
      currentStatusData.ts = event.ts;
      return true; // Needs an immediate redraw
    /*case "StatusUpdate":
      currentStatusData.iob = event.iob; currentStatusData.cob = event.cob;
      return true; // Needs an immediate redraw*/
    /*case "GraphData":
      // Add to a temporary map to build the full history
      event.history.forEach(p => tempGlucoseMap[p.ts] = p);
      // We don't redraw yet, we wait for all chunks to be processed.*/
    case "ConfirmAction":
      //should be handled by AAPS Menu.
      console.log("ConfirmAction received by AAPS. SHOULD BE RECEIVED BY aaps menu!")
      return false;
    case "GlucoseHistoy":
      updateHistory(event.glucose, null, null);
      return true;
    case "TreatmentsHistoy":
      updateHistory(null, event.treatments, null);
      return true;
    case "BasalsHistoy":
      updateHistory(null, null, event.basals);
      return true;
      break;
    // ... add other cases
  }

  return false;
}


// Let's use the SUPERIOR multi-file model we arrived at. It is the best.
// This is the simplest and most robust.


// === INITIAL SETUP ===
function start() {
  Bangle.setUI("clock");
  Bangle.loadWidgets();

  // Load settings from the file first
  loadSettings();

  lib.sendCommand("RequestInitialData", {});
  processQueue(); // Initial read
  
  setInterval(processQueue, 5000); // Poll files every 5s
  Bangle.on('lcdPower', (on) => { if (on) draw(); });
  // Call the function to enable all our gestures
  setupGestures();

  draw();
}

// Run the setup
start();

