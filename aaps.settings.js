(function(back) {
  const SETTINGS_FILE = 'aaps.settings.json';
  
  // Get a list of all installed app names for the gesture settings
  const applist = require("Storage").list(/\.app\.js$/)
    .map(app => app.slice(0, -7)) // Remove the '.app.js' part
    .sort();
  const applistWithNone = ["[None]"].concat(applist);

  // Load current settings, providing safe defaults for ALL options
  let settings = require('Storage').readJSON(SETTINGS_FILE, 1) || {
    swipeUp: 'aaps-menu',
    swipeDown: 'messages',
    swipeLeft: '',
    swipeRight: '',
    swipeBottomUp: '',
    debugLogs: 0,
    uploadHR: false,
    uploadSteps: false,
  };

  function save(key, value) {
    settings[key] = value;
    require('Storage').writeJSON(SETTINGS_FILE, settings);
  }
  
  // Helper function to create a menu item for a gesture
  const createGestureMenuItem = (key) => {
    let currentIndex = applistWithNone.indexOf(settings[key]);
    if (currentIndex < 0) currentIndex = 0; // Default to [None] if not found

    return {
      value: currentIndex,
      min: 0, max: applistWithNone.length - 1,
      format: v => applistWithNone[v],
      onchange: v => {
        save(key, v === 0 ? "" : applistWithNone[v]);
      },
    };
  };

  // --- Main Menu Definition ---
  const menu = {
    '': { 'title': 'AAPS Clock Settings' },
    '< Back': back,
    
    // --- Gestures Sub-Menu ---
    'Gestures': { 'title': '-- Gestures --' },
    'Tap Action': {
        value: 0, // Always launch the AAPS Menu
        format: () => "AAPS Menu", // Display-only, not changeable
    },
    'Swipe Up': createGestureMenuItem('swipeUp'),
    'Swipe Down': createGestureMenuItem('swipeDown'),
    'Swipe Left': createGestureMenuItem('swipeLeft'),
    'Swipe Right': createGestureMenuItem('swipeRight'),
    'Bottom-Up Swipe': createGestureMenuItem('swipeBottomUp'),
    'Debug log files':  {
      value: settings['debugLogs']|0,
      min: 0, max: 10, step: 1,
      format: v => v,
      onchange: v => {
        save('debugLogs', v);
      },
    },

    // --- Data Uploads Sub-Menu ---
    'Data Uploads': { 'title': '-- Data Uploads --' },
    'Upload HR': {
      value: !!settings.uploadHR, // The '!!' ensures it's a true boolean (On/Off)
      format: v => v ? "On" : "Off",
      onchange: v => {
        save('uploadHR', v);
      }
    },
    'Upload Steps': {
      value: !!settings.uploadSteps,
      format: v => v ? "On" : "Off",
      onchange: v => {
        save('uploadSteps', v);
      }
    }
  };

  E.showMenu(menu);
});