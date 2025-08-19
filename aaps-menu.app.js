// In your aaps-menu.app.js file

const COMMAND_FILE = "aaps.cmd.json";

// Helper function to write a command and load the main app
function sendCommandAndLoad(command, data) {
  require("Storage").writeJSON(COMMAND_FILE, { command: command, data: data });
  load("aaps.app.js");
}

// --- UI Flow for Bolus / Carbs ---
let treatmentParams = { carbs: 0, insulin: 0 };
function showTreatmentCarbs() {
  E.showNumberEntry("Carbs (g)", treatmentParams.carbs, 0, 300, 5, (carbs) => {
    if (carbs === null) { showMainMenu(); return; } // Go back to main menu
    treatmentParams.carbs = carbs;
    showTreatmentInsulin();
  });
}
function showTreatmentInsulin() {
  E.showNumberEntry("Insulin (U)", treatmentParams.insulin, 0, 20, 0.5, (insulin) => {
    if (insulin === null) { showTreatmentCarbs(); return; } // Go back to carbs
    treatmentParams.insulin = insulin;
    // We have all the data. Send the final command.
    sendCommandAndLoad("ActionBolusPreCheck", treatmentParams);
  });
}

// --- UI Flow for Temp Targets ---
function showTempTargetMenu() {
  const menu = {
    "" : { "title" : "Temp Target" },
    "< Back" : showMainMenu,
    "Eating Soon": () => sendCommandAndLoad("ActionTempTargetPreCheck", { command: "PRESET_EATING" }),
    "Activity": () => sendCommandAndLoad("ActionTempTargetPreCheck", { command: "PRESET_ACTIVITY" }),
    "Hypo": () => sendCommandAndLoad("ActionTempTargetPreCheck", { command: "PRESET_HYPO" }),
    "Cancel": () => sendCommandAndLoad("ActionTempTargetPreCheck", { command: "CANCEL" }),
  };
  E.showMenu(menu);
}

// --- UI Flow for Profile Switch ---
let profileSwitchParams = { percentage: 100, duration: 0 };
function showProfileSwitchPercent() {
  E.showNumberEntry("Percent (%)", profileSwitchParams.percentage, 10, 200, 10, (percent) => {
    if (percent === null) { showMainMenu(); return; }
    profileSwitchParams.percentage = percent;
    showProfileSwitchDuration();
  });
}
function showProfileSwitchDuration() {
  E.showNumberEntry("Duration (min)", profileSwitchParams.duration, 0, 1440, 30, (duration) => {
    if (duration === null) { showProfileSwitchPercent(); return; }
    profileSwitchParams.duration = duration;
    // We have all the data. Send the final command.
    sendCommandAndLoad("ActionProfileSwitchPreCheck", profileSwitchParams);
  });
}

// --- The Main Menu ---
function showMainMenu() {
  const mainMenu = {
    "" : { "title" : "AAPS Menu" },
    "< Back" : () => { load("aaps.app.js"); },
    'Bolus / Carbs': showTreatmentCarbs,
    'Temp Target': showTempTargetMenu,
    'Profile Switch': showProfileSwitchPercent,
    'Refresh Data': () => sendCommandAndLoad("RequestInitialData"),
  };
  E.showMenu(mainMenu);
}

// --- Start the App ---
g.clear();
showMainMenu();

