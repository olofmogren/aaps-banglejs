const COMMAND_FILE = "aaps.cmd.json";

const menu = {
  "" : { "title" : "AAPS Menu" },
  "< Back" : () => {
    // Go back to the main clock face
    load("aaps.app.js");
  },
  'Bolus / Carbs': () => {
    // Write a command to the file for the main app to pick up.
    require("Storage").writeJSON(COMMAND_FILE, { command: "startBolusFlow" });
    // Go back to the clock face, which will then see the command file.
    load("aaps.app.js");
  },
  'Refresh Data': () => {
    // Write a different command to the file.
    require("Storage").writeJSON(COMMAND_FILE, { command: "refreshData" });
    load("aaps.app.js");
  },
  // You can add other actions here
};

// Clear the screen and show the menu
g.clear();
E.showMenu(menu);


