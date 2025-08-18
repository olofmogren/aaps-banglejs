(function(back) {
  const SETTINGS_FILE = 'aaps.settings.json';

  // Get a list of all installed app names
  const applist = require("Storage").list(/\.app\.js$/)
    .map(app => app.slice(0, -7)) // Remove the '.app.js' part
    .sort();

  // Add a "None" option to the beginning of the list
  const applistWithNone = ["[None]"].concat(applist);

  // Load current settings, providing safe defaults
  let settings = require('Storage').readJSON(SETTINGS_FILE, 1) || {
    swipeUp: 'aaps-menu',
    swipeDown: 'messages',
    swipeLeft: '',
    swipeRight: '',
    swipeBottomUp: '',
  };

  function save(key, value) {
    settings[key] = value;
    require('Storage').writeJSON(SETTINGS_FILE, settings);
  }

  // Helper function to create a menu item for a gesture
  const createGestureMenuItem = (label, key) => {
    // Find the current app's index in the list. Default to 0 ([None]) if not found.
    let currentIndex = applistWithNone.indexOf(settings[key]);
    if (currentIndex < 0) currentIndex = 0;

    return {
      value: currentIndex,
      min: 0, max: applistWithNone.length - 1,
      format: v => applistWithNone[v],
      onchange: v => {
        // If the user selects [None], save an empty string. Otherwise, save the app name.
        save(key, v === 0 ? "" : applistWithNone[v]);
      },
    };
  };

  const menu = {
    '': { 'title': 'AAPS Gestures' },
    '< Back': back,
    'Tap Action': {
        value: 0, // Always launch the AAPS Menu
        format: () => "AAPS Menu",
    },
    'Swipe Up': createGestureMenuItem('Swipe Up', 'swipeUp'),
    'Swipe Down': createGestureMenuItem('Swipe Down', 'swipeDown'),
    'Swipe Left': createGestureMenuItem('Swipe Left', 'swipeLeft'),
    'Swipe Right': createGestureMenuItem('Swipe Right', 'swipeRight'),
  };

  E.showMenu(menu);
});

