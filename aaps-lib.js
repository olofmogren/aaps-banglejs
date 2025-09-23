// aaps-uilib.js
exports.showNumberEntry = function(title, initialValue, step, unit, callback) {
  let value = initialValue;
  const W = g.getWidth();
  const H = g.getHeight();

  function draw() {
    g.reset().clear();
    g.setFont("Vector", 16).setFontAlign(0, -1).drawString(title, W / 2, 10);
    g.setFont("Vector", 32).setFontAlign(0, 0).drawString(value.toFixed(1) + " " + unit, W / 2, 44);
    
    // Buttons
    g.setFont("Vector", 24);
    g.drawRect(10, H / 2 - 25, 60, H / 2 + 25);
    g.drawString("-", 35, H / 2); // Decrease
    
    g.drawRect(W - 60, H / 2 - 25, W - 10, H / 2 + 25);
    g.drawString("+", W - 35, H / 2); // Increase

    g.setFont("Vector", 20);
    g.drawRect(10, H - 40, 80, H - 10);
    g.drawString("Cancel", 45, H - 25); // Cancel
    
    g.drawRect(W - 80, H - 40, W - 10, H - 10);
    g.drawString("OK", W - 45, H - 25); // OK
  }

  Bangle.setUI({
    mode: "custom",
    touch: (btn, xy) => {
      if (xy.y > H / 2 - 30 && xy.y < H / 2 + 30) {
        if (xy.x < 70) { // Decrease
          value = Math.max(0, value - step);
          draw();
        } else if (xy.x > W - 70) { // Increase
          value += step;
          draw();
        }
      } else if (xy.y > H - 50) {
        if (xy.x < 90) { // Cancel
          callback(null);
        } else if (xy.x > W - 90) { // OK
          callback(value);
        }
      }
    }
  });

  draw();
};
exports.confirmDialog = function(title, message, callbackCancel, callbackConfirmed) {
  const W = g.getWidth();
  const H = g.getHeight();

  const allLines = message.split("\n");
  const lines = allLines.filter((line) => line.length > 0);

  function draw() {
    g.reset().clear();
    g.setFont("Vector", 16).setFontAlign(0, -1).drawString(title, W / 2, 10);
    g.setFont("Vector", 14).setFontAlign(0, 0);
    var offset = 0;
    lines.forEach(l => {
      console.log("line: "+l);
      g.drawString(l, W / 2, 44+offset);
      offset += 14;
    });
    //g.setFont("Vector", 14).setFontAlign(0, 0).drawString(message, W / 2, 44);
    
    g.setFont("Vector", 20);
    g.drawRect(10, H - 40, 80, H - 10);
    g.drawString("Cancel", 45, H - 25); // Cancel
    
    g.drawRect(W - 80, H - 40, W - 10, H - 10);
    g.drawString("Confirm", W - 45, H - 25); // OK
  }

  Bangle.setUI({
    mode: "custom",
    back: callbackCancel,
    redraw: draw,
    touch: (btn, xy) => {
      if (xy.y > H - 50) {
        if (xy.x < 90) { // Cancel
          callbackCancel();
        } else if (xy.x > W - 90) { // OK
          callbackConfirmed();
        }
      }
    }
  });

  draw();
};

// sending commands to AAPS over http.
exports.sendCommand = function(type, data) {
  // 1. Create the data payload object.
  const commandData = data || {}; // Use the provided data or an empty object.

  // 2. Convert the payload object to a JSON string.
  const jsonString = JSON.stringify(commandData);

  // 3. IMPORTANT: URL-encode the JSON string to make it safe for a URL.
  const encodedJson = encodeURIComponent(jsonString);

  // 4. Construct the URL using a backtick template literal.
  // We send the type and the encoded JSON as two separate query parameters.
  const url = `http://127.0.0.1:28891/command?commandType=${type}&commandJson=${encodedJson}`;

  console.log("Sending URL:", url);

  // 5. Send the HTTP request.
  Bangle.http(url).then(data => {
    console.log("AAPS replied:", data.resp);
  }).catch(error => {
    console.log("HTTP request error:", error);
  });
}

