// === GLOBAL DATA and CONSTANTS
// ===================================================================================
const MGDL_TO_MMOL = 18.0182;
const HIGH_MMOL = 10.0;
const LOW_MMOL = 4.0;
const H = g.getHeight();
const W = g.getWidth();
let drawTimeout;

// Data variables that your drawing functions expect
let recentGlucose = [];    // Used for BG value, delta, and trend
let plotGlucose = [];      // Used for the graph line
let treatmentData = [];    // Used for basals, temps, and boluses
let aapsStatus = { iob: "---", cob: "---" }; // For current IOB/COB

// === AAPS COMMUNICATION
// ===================================================================================

// AAPS will remotely execute this function with the JSON data.
global.handleAAPSData = function(jsonString) {
  try {
    const data = JSON.parse(jsonString);
    let needsRedraw = false;
    
    switch (data.eventType) {
      case "StatusUpdate":
        // Update the live status data
        aapsStatus.iob = data.iob || "---";
        aapsStatus.cob = data.cob || "---";
        needsRedraw = true;
        break;

      case "GraphData":
        // Populate both glucose arrays from the single history source
        recentGlucose = data.history || [];
        plotGlucose = data.history || [];
        needsRedraw = true;
        break;
        
      case "TreatmentData":
        // Adapt the AAPS treatment data into the single array your graph function expects
        let combinedTreatments = [];
        if (data.basals) {
          data.basals.forEach(b => combinedTreatments.push({ eventType: "Scheduled Basal", created_at: new Date(b.ts).toISOString() }));
        }
        if (data.temps) {
          data.temps.forEach(t => combinedTreatments.push({ eventType: "Temp Basal", created_at: new Date(t.ts).toISOString(), absolute: t.rate, duration: (t.end_ts - t.ts) / 60000 }));
        }
        if (data.treatments) {
          data.treatments.forEach(t => combinedTreatments.push({ eventType: "Bolus/Carbs", created_at: new Date(t.ts).toISOString(), insulin: t.insulin, carbs: t.carbs }));
        }
        treatmentData = combinedTreatments;
        needsRedraw = true;
        break;
    }
    
    if (needsRedraw && Bangle.isLCDOn()) {
      draw();
    }
  } catch (e) {
    // This log is vital for debugging on the watch
    console.log("Error in handleAAPSData:", e);
  }
};

// Function to send commands TO AAPS, using the correct method.
function requestDataRefresh() {
  const command = {
    t: "intent",
    action: "app.aaps.gadgetbridge.COMMAND",
    extra: { commandType: "RequestInitialData", commandJson: "{}" }
  };
  Bluetooth.println(JSON.stringify(command));
}

// === MASTER DRAW FUNCTION and COMPONENT DRAWING (Your Code)
// ===================================================================================
function draw() {
  if (drawTimeout) clearTimeout(drawTimeout);
  drawTimeout = setTimeout(() => { draw(); }, 60000 - (Date.now() % 60000));
  
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
  let glucoseMmol = null, deltaMmol = null, arrowType = null;
  let textColor = "#FFF"; // Default to white

  if (recentGlucose && recentGlucose.length > 0) {
    const latestEntry = recentGlucose[0];
    glucoseMmol = latestEntry.sgv / MGDL_TO_MMOL;

    if (glucoseMmol >= HIGH_MMOL || glucoseMmol <= LOW_MMOL) textColor = "#F00"; // Red if out of range

    let fiveMinOldEntry = null;
    if (recentGlucose.length > 1) {
      const latestTime = new Date(latestEntry.ts).getTime();
      for (let i = 1; i < recentGlucose.length; i++) {
        if (latestTime - new Date(recentGlucose[i].ts).getTime() >= 270000) {
          fiveMinOldEntry = recentGlucose[i];
          break;
        }
      }
    }
    if (fiveMinOldEntry) {
      deltaMmol = glucoseMmol - (fiveMinOldEntry.sgv / MGDL_TO_MMOL);
      const absDelta = Math.abs(deltaMmol);
      if (absDelta < 0.3) arrowType = "FLAT";
      else if (absDelta < 0.7) arrowType = (deltaMmol > 0) ? "UP_45" : "DOWN_45";
      else arrowType = (deltaMmol > 0) ? "UP" : "DOWN";
    }
  }

  g.setFontAlign(0, 0);
  g.setColor(textColor).setFont("Vector", 32).drawString(glucoseMmol ? glucoseMmol.toFixed(1) : "---", x + w/2, y + 20);
  
  g.setColor("#FFF"); // Delta is always white
  if (deltaMmol !== null) {
    const deltaString = (deltaMmol >= 0 ? "+" : "") + deltaMmol.toFixed(1);
    g.setFont("6x8", 2).drawString(deltaString, x + w/2 - 10, y + 48);
    drawTrendArrow(x + w/2 + 25, y + 48, arrowType);
  }

  g.setFont("6x8", 2).setFontAlign(0, 0);
  g.drawString(aapsStatus.cob, x + w/2, y + h/2 + 15);
  g.drawString(aapsStatus.iob, x + w/2, y + h - 20);
  
  g.setColor("#F00"); // Red separator line
  g.fillRect(x + w -1, y, x + w, y + h);
}

function drawTrendArrow(x, y, type) {
  g.setColor("#FFF"); // Arrow is always white
  const ARROW_SIZE = 8;
  if (!type) return;
  // Using simple lines for clarity on Bangle.js 2's anti-aliased screen
  if (type==="FLAT") g.drawLine(x-ARROW_SIZE,y, x,y);
  if (type==="UP_45") g.drawLine(x-ARROW_SIZE,y+ARROW_SIZE/2, x,y-ARROW_SIZE/2);
  if (type==="DOWN_45") g.drawLine(x-ARROW_SIZE,y-ARROW_SIZE/2, x,y+ARROW_SIZE/2);
  if (type==="UP") g.drawLine(x,y-ARROW_SIZE, x,y);
  if (type==="DOWN") g.drawLine(x,y, x,y+ARROW_SIZE);
}

function drawTopRight(x, y, w, h) {
  g.setColor("#FFF");
  const d = new Date();
  const timeStr = require("locale").time(d, 1);
  g.setFont("Vector", 40).setFontAlign(0,0);
  g.drawString(timeStr, x + w/2, y + h/2 - 10);
  
  const day = require("locale").dow(d, 1).toUpperCase();
  const date = d.getDate();
  const month = require("locale").month(d, 1).toUpperCase();
  g.setFont("Vector", 15).setFontAlign(0, 0);
  g.drawString(`${day} ${date} ${month}`, x + w/2, y + h - 15);
}

function drawBottomRightGraph(x, y, w, h) {
  const margin = 5;
  const graphX = x + margin;
  const graphW = w - (margin * 2);
  const MIN_MMOL_SCALE = 2.0;
  const MAX_MMOL_SCALE = 14.0;

  g.setColor("#F00"); // Red for threshold lines
  let highY = y + h - (((HIGH_MMOL - MIN_MMOL_SCALE) / (MAX_MMOL_SCALE - MIN_MMOL_SCALE)) * h);
  let lowY = y + h - (((LOW_MMOL - MIN_MMOL_SCALE) / (MAX_MMOL_SCALE - MIN_MMOL_SCALE)) * h);
  g.drawLine(graphX, highY, graphX + graphW, highY);
  g.drawLine(graphX, lowY, graphX + graphW, lowY);

  let now = new Date().getTime();
  let twoHoursAgo = now - (2 * 60 * 60 * 1000);

  g.setColor("#FFF"); // White for glucose plot
  if (plotGlucose && plotGlucose.length >= 2) {
    for (let i = 0; i < plotGlucose.length - 1; i++) {
        let p1 = plotGlucose[i], p2 = plotGlucose[i+1];
        if (!p1 || !p2) continue;
        let p1_mmol = p1.sgv / MGDL_TO_MMOL, p2_mmol = p2.sgv / MGDL_TO_MMOL;
        let x1 = graphX + graphW * (new Date(p1.ts).getTime() - twoHoursAgo) / (2 * 60 * 60 * 1000);
        let x2 = graphX + graphW * (new Date(p2.ts).getTime() - twoHoursAgo) / (2 * 60 * 60 * 1000);
        let y1 = y + h - (((p1_mmol - MIN_MMOL_SCALE) / (MAX_MMOL_SCALE - MIN_MMOL_SCALE)) * h);
        let y2 = y + h - (((p2_mmol - MIN_MMOL_SCALE) / (MAX_MMOL_SCALE - MIN_MMOL_SCALE)) * h);
        g.drawLine(x1, y1, x2, y2);
    }
  }
  
  treatmentData.forEach(t => {
      let start = new Date(t.created_at).getTime();
      if (t.eventType === "Temp Basal" && t.absolute !== undefined) {
          g.setColor(0, 0, 1); // Blue for temp basals
          let duration = t.duration * 60 * 1000;
          let end = start + duration;
          let startX = graphX + Math.round(graphW * (start - twoHoursAgo) / (2 * 60 * 60 * 1000));
          let endX = graphX + Math.round(graphW * (end - twoHoursAgo) / (2 * 60 * 60 * 1000));
          let rate = t.absolute;
          let barY = y + h - ((rate / 3.0) * (h / 2)); // Scale against max 3.0 U/hr
          if (startX < graphX + graphW && endX > graphX) {
              g.fillRect(Math.max(graphX, startX), barY, Math.min(graphX + graphW, endX), y + h);
          }
      }
      if (t.insulin) {
          g.setColor("#0FF"); // Cyan for bolus markers
          let bolusX = graphX + graphW * (start - twoHoursAgo) / (2 * 60 * 60 * 1000);
          let radius = Math.max(2, t.insulin * 1.5);
          if (bolusX > graphX && bolusX < graphX + graphW){
               g.fillCircle(bolusX, y + radius + 1, radius);
          }
      }
  });
}

// === INITIAL SETUP
// ===================================================================================
function start() {
  Bangle.setUI("clock");
  Bangle.loadWidgets();
  
  // Draw the layout immediately, it will show "---" for data.
  draw();

  // Request fresh data from AAPS.
  setTimeout(requestDataRefresh, 1000);
}

start();