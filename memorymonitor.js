// ---- Espruino memory growth monitor -----------------------------------------
// startMemMonitor({ interval: 60000, threshold: 2, buzz: true, logTop: 10 })
// stopMemMonitor()

let __memMon = { timer: undefined, last: undefined };

function startMemMonitor(opts) {
  opts = opts||{};
  const interval  = opts.interval  || 60000; // ms
  const threshold = opts.threshold || 1;     // minimum growth to report (units are E.getSizeOf 'size' units)
  const buzz      = !!opts.buzz;
  const logTop    = opts.logTop || 10;

  // don't stack timers
  stopMemMonitor();

  function flatten(entries, prefix, out) {
    if (!entries || !entries.forEach) return;
    entries.forEach(e => {
      const name = (prefix ? prefix + "." : "") + e.name;
      out[name] = (out[name]||0) + (e.size|0);
      // Nested children appear under 'more' (Espruino docs/discussions show this)
      if (e.more) flatten(e.more, name, out);
    });
  }

  function snapshot() {
    let map = Object.create(null);
    try {
      // Multi-level breakdown of globals:
      const arr = E.getSizeOf(global, 2); // returns [{name,size,more:[...]}...]
      flatten(arr, "", map);
    } catch (e) {
      console.log("memMon: E.getSizeOf failed:", e);
    }
    return map;
  }

  function compare(prev, curr) {
    const grows = [];
    for (let k in curr) {
      const before = prev && (prev[k]|0) || 0;
      const after  = curr[k]|0;
      const delta  = after - before;
      if (delta >= threshold) grows.push({ path:k, before, after, delta });
    }
    // Sort biggest first
    grows.sort((a,b)=>b.delta - a.delta);
    return grows;
  }

  function notify(grows) {
    if (!grows.length) return;
    // Optional gentle buzz on Bangle.js
    if (buzz && global.Bangle && Bangle.buzz) {
      try { Bangle.buzz(100); } catch(_) {}
    }
    const top = grows.slice(0, logTop);
    console.log("memMon: growth detected (top "+top.length+")");
    top.forEach(g => {
      console.log("  +", g.delta, " → ", g.after, " | ", g.path);
    });
  }

  // first sample
  __memMon.last = snapshot();

  __memMon.timer = setInterval(() => {
    const curr = snapshot();
    const grows = compare(__memMon.last||Object.create(null), curr);
    notify(grows);
    __memMon.last = curr; // keep only one snapshot to avoid our own memory growth
  }, interval);

  console.log("memMon: started; interval="+interval+"ms, threshold="+threshold);
}

function stopMemMonitor() {
  if (__memMon.timer) {
    clearInterval(__memMon.timer);
    __memMon.timer = undefined;
  }
  __memMon.last = undefined;
  // no console here to stay quiet in production
}
  
  startMemMonitor({ interval: 60000, threshold: 2, buzz: true });
