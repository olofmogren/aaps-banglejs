// aaps-menu.app.js
const lib = require('aaps-lib.js');

let treatmentParams = { carbs: 0, insulin: 0.0 };

function showTreatmentCarbs() {
  lib.showNumberEntry("Carbs (g)", treatmentParams.carbs, 5, "g", (carbs) => {
    if (carbs === null) {
      E.showMenu(mainMenu); // Go back to main menu
      return;
    }
    treatmentParams.carbs = carbs;
    showTreatmentInsulin();
  });
}

// This function starts the process
function showTreatmentInsulin() {
  lib.showNumberEntry("Insulin (U)", treatmentParams.insulin, 0.5, "U", (insulin) => {
    if (insulin === null) {
      showTreatmentCarbs(); // Go back
      return;
    }
    treatmentParams.insulin = insulin;

    // Send the pre-check command to AAPS
    lib.sendCommand("ActionBolusPreCheck", { insulin: treatmentParams.insulin, carbs: treatmentParams.carbs });

    // Start the non-blocking waiting process, with a timeout of 10 seconds.
    waitForConfirmation(10);
  });
}

// This is the new, non-blocking polling function.
function waitForConfirmation(timeoutSeconds) {
  // Show the initial "waiting" message
  if (timeoutSeconds === 10) { // Only show this on the first call
    E.showMessage("Sending...\nWaiting for\nconfirmation.");
  }

  // 1. Check if the file exists.
  const confirmFile = require("Storage").readJSON("aaps_confirm.json", 1);

  if (confirmFile && confirmFile.eventType === "ConfirmAction") {
    // SUCCESS: We found the file.
    handleConfirmAction(confirmFile); // Call the handler to show the dialog
    return; // Stop the polling
  }

  // 2. Check for timeout.
  if (timeoutSeconds <= 0) {
    // TIMEOUT: The loop has finished without finding a file.
    E.showMessage("Confirmation\nTimed Out.");
    // Wait a moment for the user to see the message, then go back to the clock.
    setTimeout(() => { Bangle.showClock(); }, 2000);
    return; // Stop the polling
  }

  // 3. If no file and no timeout, schedule the next check.
  // This will call waitForConfirmation again in 1 second, with a decremented timeout.
  setTimeout(() => {
    waitForConfirmation(timeoutSeconds - 1);
  }, 1000);
}

// This function handles the dialog itself. It does not need to be async.
function handleConfirmAction(confirmFile) {
  Bangle.buzz();

  // E.showPrompt returns a Promise, which is supported. We use .then() to handle the result.
  E.showPrompt(confirmFile.message, {
    title: confirmFile.title,
    buttons: {"Cancel": false, "Confirm": true}
  }).then(confirmed => {
    require("Storage").erase("aaps_confirm.json");

    if (confirmed) {
      console.log("User confirmed. Sending action.");
      const returnData = JSON.parse(confirmFile.returnCommandJson);
      lib.sendCommand(confirmFile.returnCommandType, returnData);
      E.showMessage("Confirmed.\nSending...");
    } else {
      console.log("User cancelled action.");
      E.showMessage("Cancelled.");
    }

    // After showing the result message, wait and then go back to the clock.
    setTimeout(() => { Bangle.showClock(); }, 1500);
  });
}

// --- Main Menu ---
const mainMenu = {
  '': { 'title': 'AAPS Menu' },
  '< Back': () => load('aaps.app.js'),
  'Treatment': () => {
    showTreatmentCarbs();
  },
  'Temp Target': () => {
    // Placeholder for Temp Target UI
    E.showMessage("Temp Target\nNot Implemented");
    setTimeout(() => E.showMenu(mainMenu), 1000);
  },
  'Profile Switch': () => {
    // Placeholder for Profile Switch UI
    E.showMessage("Profile Switch\nNot Implemented");
    setTimeout(() => E.showMenu(mainMenu), 1000);
  },
};

// --- Confirmation Handler ---
GB.on('json', (msg) => {
  if (msg.t === "intent" && msg.data) {
    let data = JSON.parse(msg.data);
    if (data.eventType === "ConfirmAction") {
      E.showPrompt(data.message, {
        title: data.title,
        buttons: {"Confirm": true, "Cancel": false}
      }).then(confirmed => {
        if (confirmed) {
          lib.sendCommand(data.returnCommandType, JSON.parse(data.returnCommandJson));
          E.showMessage("Confirmed!\nSending...");
          setTimeout(() => load('aaps.app.js'), 2000); // Go back to clock
        } else {
          E.showMenu(mainMenu); // Cancelled, go back to menu
        }
      });
    }
  }
});

// Show the main menu when the app starts
E.showMenu(mainMenu);
