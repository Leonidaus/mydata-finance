/**
 * Animated widgets: code blocks that use the injected libraries (gsap, Matter, THREE).
 *
 * House rules for motion, which the LLM prompt repeats: motion is free while the card is on
 * screen (living scenes, longer stories, touch), driven by `mydata.loop` or GSAP so the app can
 * pause it off screen; with `mydata.reducedMotion` nothing moves on its own. A widget gets the
 * whole screen when the user presses the card's full-screen button (`html.fullscreen`).
 */
import type { Block, Control } from "../blocks";
import { SPENDING_CATEGORIES } from "../engine/util";

let seq = 0;
const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

const periodControl: Control = { kind: "period", arg: "period" };

/**
 * Every widget starts the same way: remember the newest data, and play when the card is both
 * visible and has data. `play(rows, result)` is called again whenever the data changes.
 */
const START = `
  var seen = false, latest = null;
  mydata.onData(function (rows, result) { latest = [rows, result]; if (seen) play(rows, result); });
  mydata.whenVisible(function () { seen = true; if (latest) play(latest[0], latest[1]); });`;

/**
 * 3D glass jar (Three.js) that coins drop into (Matter.js physics); the amount counts up (GSAP).
 * Where WebGL is unavailable, the same jar and physics are drawn flat on a 2D canvas.
 */
const JAR_CODE = `<style>
  .jar { max-width: 420px; margin: 0 auto; text-align: center; }
  .jar b { display: block; font-size: 28px; line-height: 1.2; font-variant-numeric: tabular-nums; }
  .jar span { font-size: 13px; color: var(--muted); }
  canvas { display: block; width: 100%; height: 250px; cursor: pointer; }
</style>
<div class="jar"><b id="amt">&nbsp;</b><span id="sub">&nbsp;</span><canvas id="c"></canvas></div>
<script>
(function () {
  // Jar interior in physics units: 200 wide; 60 coins of radius 11 settle about 152 high.
  var W = 200, R = 11, H = 185, GOAL = 152, MAX = 60;
  var canvas = document.getElementById("c"), amt = document.getElementById("amt"), sub = document.getElementById("sub");
  // Some browsers have WebGL switched off (privacy settings, no GPU). Check on a spare canvas,
  // and without it draw the same jar flat on a 2D canvas instead of failing.
  var renderer = null, ctx = null, dpr = Math.min(window.devicePixelRatio || 1, 2);
  try {
    var probe = document.createElement("canvas");
    if (probe.getContext("webgl2") || probe.getContext("webgl")) {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(dpr);
    }
  } catch (e) { renderer = null; }
  if (!renderer) ctx = canvas.getContext("2d");
  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(30, 1, 1, 3000);
  scene.add(new THREE.AmbientLight(0xffffff, 1.7));
  var sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-120, 320, 260);
  scene.add(sun);

  function ring(y, tube, opacity) {
    var m = new THREE.Mesh(new THREE.TorusGeometry(W / 2 + 5, tube, 10, 72), new THREE.MeshBasicMaterial({ transparent: true, opacity: opacity }));
    m.rotation.x = Math.PI / 2; m.position.y = y; scene.add(m); return m;
  }
  var glass = new THREE.Mesh(
    new THREE.CylinderGeometry(W / 2 + 5, W / 2 + 5, H, 64, 1, true),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false })
  );
  glass.position.y = H / 2; scene.add(glass);
  var floor = new THREE.Mesh(new THREE.CircleGeometry(W / 2 + 5, 64), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.1, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  var rim = ring(H, 2.2, 0.55), base = ring(0, 2.2, 0.55), goal = ring(GOAL, 1.4, 0.9);

  var coinGeo = new THREE.CylinderGeometry(R, R, 4.5, 28);
  var coinMat = new THREE.MeshStandardMaterial({ color: 0xe2b24c, metalness: 0.35, roughness: 0.42 });
  var coins = [], engine = null, raf = 0, tween = null, sig = "";

  function colours() {
    var text = mydata.css("--text") || "#222", muted = mydata.css("--muted") || "#888";
    glass.material.color.set(text); floor.material.color.set(text);
    rim.material.color.set(muted); base.material.color.set(muted);
    goal.material.color.set(mydata.css("--green-500") || "#00a04b");
  }
  function draw2d() {
    var w = canvas.clientWidth || 300, h = canvas.clientHeight || 250;
    var s = Math.min(w / 250, h / 225), hw = W / 2 + 5, ry = 9;
    var text = mydata.css("--text") || "#222", muted = mydata.css("--muted") || "#888";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w / 2, h - 16 * s); ctx.scale(s, s);   // origin: centre of the jar floor, y up is negative
    function oval(y, colour, width, dash) {
      ctx.beginPath(); ctx.ellipse(0, -y, hw, ry, 0, 0, Math.PI * 2);
      ctx.setLineDash(dash || []); ctx.lineWidth = width; ctx.strokeStyle = colour; ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.globalAlpha = 0.07; ctx.fillStyle = text; ctx.fillRect(-hw, -H, hw * 2, H);
    ctx.beginPath(); ctx.ellipse(0, 0, hw, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    for (var i = 0; i < coins.length; i++) {
      var p = coins[i].body.position;
      ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.fillStyle = "#e2b24c"; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = "#b8872b"; ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, R - 4, 0, Math.PI * 2); ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.stroke();
    }
    ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.moveTo(-hw, -H); ctx.lineTo(-hw, 0); ctx.moveTo(hw, -H); ctx.lineTo(hw, 0); ctx.lineWidth = 2; ctx.strokeStyle = muted; ctx.stroke();
    oval(0, muted, 2); oval(H, muted, 2);
    ctx.globalAlpha = 0.9;
    oval(GOAL, mydata.css("--green-500") || "#00a04b", 2, [6, 5]);
    ctx.globalAlpha = 1;
  }
  function draw() { if (renderer) renderer.render(scene, camera); else draw2d(); }
  function resize() {
    var w = canvas.clientWidth || 300, h = canvas.clientHeight || 250;
    if (!renderer) { canvas.width = w * dpr; canvas.height = h * dpr; return draw(); }
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    var t = Math.tan(Math.PI / 12);
    var dist = Math.max(225 / (2 * t), 250 / (2 * t * camera.aspect));
    camera.position.set(0, 150, dist); camera.lookAt(0, 90, 0);
    camera.updateProjectionMatrix();
    draw();
  }
  window.addEventListener("resize", resize);

  function spawn() {
    var i = coins.length;
    var body = Matter.Bodies.circle(Math.sin(i * 2.4) * 0.6 * (W / 2 - R - 4), -260, R, { restitution: 0.15, friction: 0.4, frictionAir: 0.012, density: 0.004 });
    Matter.Composite.add(engine.world, body);
    var mesh = new THREE.Mesh(coinGeo, coinMat);
    mesh.rotation.set(Math.PI / 2 + (Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.4);
    mesh.position.z = (Math.random() - 0.5) * 16;
    scene.add(mesh);
    coins.push({ body: body, mesh: mesh });
  }
  function sync() {
    for (var i = 0; i < coins.length; i++) { coins[i].mesh.position.x = coins[i].body.position.x; coins[i].mesh.position.y = -coins[i].body.position.y; }
  }
  function atRest() {
    for (var i = 0; i < coins.length; i++) if (!coins[i].body.isSleeping && coins[i].body.speed > 0.15) return false;
    return true;
  }
  function tick(n) {
    if (coins.length < n) spawn();
    Matter.Engine.update(engine, 1000 / 60);
  }

  function play(rows, result) {
    colours();
    var row = rows[0] || {}, saved = Number(row.saved) || 0, target = Number(row.target) || 0;
    var next = saved + "|" + target;
    if (next === sig) return draw();   // same figures (e.g. a theme change): recolour only
    sig = next;
    cancelAnimationFrame(raf);
    if (tween) tween.kill();
    coins.forEach(function (c) { scene.remove(c.mesh); });
    coins = [];
    engine = Matter.Engine.create({ enableSleeping: true });
    Matter.Composite.add(engine.world, [
      Matter.Bodies.rectangle(0, 20, W + 80, 40, { isStatic: true }),
      Matter.Bodies.rectangle(-W / 2 - 20, -300, 40, 800, { isStatic: true }),
      Matter.Bodies.rectangle(W / 2 + 20, -300, 40, 800, { isStatic: true })
    ]);
    var pct = target > 0 ? Math.min(1, saved / target) : 0;
    var n = pct <= 0 ? 0 : Math.max(1, Math.round(pct * MAX));
    sub.textContent = Math.round(pct * 100) + "% of " + mydata.formatEur(target);
    canvas.onclick = function () { mydata.select({ label: row.label }); };
    resize();

    if (mydata.reducedMotion) {
      for (var s = 0; s < 700; s++) tick(n);
      amt.textContent = mydata.formatEur(saved);
      sync(); draw();
      return;
    }
    var shown = { v: 0 };
    tween = gsap.to(shown, { v: saved, duration: 1.8, ease: "power2.out", onUpdate: function () { amt.textContent = mydata.formatEur(shown.v); } });
    var frames = 0, last = performance.now();
    (function loop(now) {
      // Fixed physics steps, so fast screens don't run the coins in fast-forward.
      var steps = Math.max(1, Math.min(3, Math.round(((now || last) - last) / (1000 / 60))));
      last = now || last;
      for (var k = 0; k < steps; k++) { if (frames % 2 === 0 || coins.length >= n) tick(n); else Matter.Engine.update(engine, 1000 / 60); frames++; }
      sync(); draw();
      if ((coins.length >= n && frames > 40 && atRest()) || frames > 900) return;   // then rest
      raf = requestAnimationFrame(loop);
    })();
  }
${START}
})();
</script>`;

/** Half-circle gauge that sweeps to the safe amount, then the working appears line by line (GSAP). */
const GAUGE_CODE = `<style>
  .gauge { max-width: 380px; margin: 0 auto; }
  .dial { position: relative; }
  svg { display: block; width: 100%; height: auto; }
  .track { fill: none; stroke: var(--border); stroke-width: 14; stroke-linecap: round; }
  .fill { fill: none; stroke: var(--green-500); stroke-width: 14; stroke-linecap: round; }
  .num { position: absolute; left: 0; right: 0; bottom: 4px; text-align: center; }
  .num b { display: block; font-size: 30px; line-height: 1.15; font-variant-numeric: tabular-nums; }
  .num span { font-size: 13px; color: var(--muted); }
  ul { list-style: none; margin: 14px 0 4px; padding: 0; font-size: 13px; }
  li { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; border-top: 1px solid var(--border); }
  li span:last-child { font-variant-numeric: tabular-nums; white-space: nowrap; }
  li.minus span:last-child { color: var(--muted); }
  li.total { font-weight: 700; }
</style>
<div class="gauge">
  <div class="dial">
    <svg viewBox="0 0 200 112" aria-hidden="true">
      <path class="track" d="M 20 100 A 80 80 0 0 1 180 100"/>
      <path class="fill" id="fill" d="M 20 100 A 80 80 0 0 1 180 100"/>
    </svg>
    <div class="num"><b id="amt">&nbsp;</b><span id="sub">&nbsp;</span></div>
  </div>
  <ul id="terms"></ul>
</div>
<script>
(function () {
  var LEN = Math.PI * 80;
  var fill = document.getElementById("fill"), amt = document.getElementById("amt"), sub = document.getElementById("sub"), list = document.getElementById("terms");
  fill.style.strokeDasharray = LEN + " " + LEN;
  fill.style.strokeDashoffset = LEN;
  var state = { v: 0, f: 0 }, tl = null;
  function paint() { amt.textContent = mydata.formatEur(state.v); fill.style.strokeDashoffset = LEN * (1 - state.f); fill.style.opacity = state.f > 0.005 ? 1 : 0; }

  function play(rows, result) {
    var value = Number(result.value) || 0;
    var balance = rows.length ? Number(rows[0].amount) || 0 : 0;
    var share = balance > 0 ? Math.max(0, Math.min(1, value / balance)) : 0;
    sub.textContent = balance > 0 ? "safe to spend, of " + mydata.formatEur(balance) + " in your account" : "safe to spend";
    list.innerHTML = "";
    var items = rows.map(function (r, i) {
      var li = document.createElement("li"), a = document.createElement("span"), b = document.createElement("span");
      var n = Number(r.amount) || 0;
      li.className = i === rows.length - 1 ? "total" : n < 0 ? "minus" : "";
      a.textContent = r.term;
      b.textContent = (n < 0 ? "\\u2212" : "") + mydata.formatEur(Math.abs(n));
      li.append(a, b); list.appendChild(li);
      return li;
    });
    if (tl) tl.kill();
    if (mydata.reducedMotion) { state.v = value; state.f = share; paint(); return; }
    tl = gsap.timeline();
    tl.to(state, { v: value, f: share, duration: 1.4, ease: "power3.out", onUpdate: paint });
    tl.from(items, { opacity: 0, y: 8, duration: 0.35, stagger: 0.12, ease: "power2.out", clearProps: "all" }, 0.5);
  }
${START}
})();
</script>`;

/** Spending splitting into the three baskets as streams that draw themselves (GSAP). */
const FLOW_CODE = `<style>
  .flow { max-width: 420px; margin: 0 auto; }
  .top { text-align: center; }
  .top b { display: block; font-size: 26px; line-height: 1.2; font-variant-numeric: tabular-nums; }
  .top span { font-size: 13px; color: var(--muted); }
  svg { display: block; width: 100%; height: auto; margin: 6px 0 2px; }
  .src { fill: var(--muted); }
  .stream { fill: none; stroke-linecap: butt; opacity: 0.6; }
  .cols { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; text-align: center; font-size: 12px; color: var(--muted); }
  .col { cursor: pointer; padding: 4px 2px; border-radius: 8px; }
  .col b { display: block; font-size: 15px; color: var(--text); font-variant-numeric: tabular-nums; }
  .col i { display: block; width: 28px; height: 4px; border-radius: 2px; margin: 0 auto 6px; }
</style>
<div class="flow">
  <div class="top"><b id="total">&nbsp;</b><span>went out, into three baskets</span></div>
  <svg id="svg" viewBox="0 0 320 150" aria-hidden="true"></svg>
  <div class="cols" id="cols"></div>
</div>
<script>
(function () {
  var NS = "http://www.w3.org/2000/svg";
  var ORDER = ["regular", "irregular", "everyday"], COLORS = ["var(--chart-1)", "var(--chart-3)", "var(--chart-2)"], XS = [53, 160, 267];
  var SRC_W = 150, SRC_X = 85;
  var svg = document.getElementById("svg"), cols = document.getElementById("cols"), totalEl = document.getElementById("total");
  var tl = null;

  function play(rows, result) {
    var items = ORDER.map(function (k) { return rows.filter(function (r) { return r.basket === k; })[0] || { basket: k, label: k, amount: 0 }; });
    var total = items.reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0);
    svg.innerHTML = ""; cols.innerHTML = "";
    var src = document.createElementNS(NS, "rect");
    src.setAttribute("class", "src"); src.setAttribute("x", SRC_X); src.setAttribute("y", 0); src.setAttribute("width", SRC_W); src.setAttribute("height", 6); src.setAttribute("rx", 3);
    svg.appendChild(src);
    var x = SRC_X, paths = [], counters = [];
    items.forEach(function (r, i) {
      var amount = Number(r.amount) || 0, share = total > 0 ? amount / total : 0;
      var w = share * SRC_W, from = x + w / 2; x += w;
      if (amount > 0) {
        var p = document.createElementNS(NS, "path");
        p.setAttribute("class", "stream");
        p.setAttribute("d", "M " + from + " 6 C " + from + " 80, " + XS[i] + " 70, " + XS[i] + " 150");
        p.setAttribute("stroke", COLORS[i]); p.setAttribute("stroke-width", Math.max(3, w));
        p.setAttribute("pathLength", 1); p.setAttribute("stroke-dasharray", "1 1"); p.setAttribute("stroke-dashoffset", 1);
        svg.appendChild(p); paths.push(p);
      }
      var col = document.createElement("div"), bar = document.createElement("i"), b = document.createElement("b"), name = document.createElement("div"), pct = document.createElement("div");
      col.className = "col"; bar.style.background = COLORS[i];
      name.textContent = r.label; pct.textContent = Math.round(share * 100) + "%";
      col.append(bar, b, name, pct); cols.appendChild(col);
      col.onclick = function () { mydata.select({ basket: r.basket, label: r.label }); };
      counters.push({ el: b, to: amount, v: 0 });
    });
    function paint() { counters.forEach(function (c) { c.el.textContent = mydata.formatEur(c.v); }); totalEl.textContent = mydata.formatEur(sum.v); }
    var sum = { v: 0 };
    if (tl) tl.kill();
    if (mydata.reducedMotion) {
      paths.forEach(function (p) { p.setAttribute("stroke-dashoffset", 0); });
      counters.forEach(function (c) { c.v = c.to; }); sum.v = total; paint();
      return;
    }
    paint();
    tl = gsap.timeline({ onUpdate: paint });
    tl.to(sum, { v: total, duration: 0.9, ease: "power2.out" }, 0);
    tl.to(paths, { attr: { "stroke-dashoffset": 0 }, duration: 1.1, ease: "power2.inOut", stagger: 0.18 }, 0.25);
    counters.forEach(function (c, i) { tl.to(c, { v: c.to, duration: 0.9, ease: "power2.out" }, 0.7 + i * 0.18); });
  }
${START}
})();
</script>`;

/** A year of savings from a cut, as coins that pile up; moving the slider adds or removes coins (Matter.js, GSAP). */
const COINS_CODE = `<style>
  .pile { max-width: 420px; margin: 0 auto; text-align: center; }
  .pile b { display: block; font-size: 28px; line-height: 1.2; font-variant-numeric: tabular-nums; }
  .pile span { font-size: 13px; color: var(--muted); }
  canvas { display: block; width: 100%; height: 170px; margin-top: 6px; border-bottom: 2px solid var(--border); }
</style>
<div class="pile"><b id="amt">&nbsp;</b><span id="sub">&nbsp;</span><canvas id="c"></canvas></div>
<script>
(function () {
  var R = 9, HEIGHT = 170, MAX = 70, UNITS = [5, 10, 20, 50, 100, 200, 500, 1000, 5000];
  var canvas = document.getElementById("c"), ctx = canvas.getContext("2d");
  var amt = document.getElementById("amt"), sub = document.getElementById("sub");
  var engine = null, coins = [], unit = 0, width = 0, raf = 0, frames = 0, target = 0, shown = { v: 0 }, tween = null;

  function setup() {
    width = canvas.clientWidth || 300;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr; canvas.height = HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    engine = Matter.Engine.create({ enableSleeping: true });
    Matter.Composite.add(engine.world, [
      Matter.Bodies.rectangle(width / 2, HEIGHT + 20, width + 80, 40, { isStatic: true }),
      Matter.Bodies.rectangle(-20, HEIGHT / 2 - 300, 40, 1200, { isStatic: true }),
      Matter.Bodies.rectangle(width + 20, HEIGHT / 2 - 300, 40, 1200, { isStatic: true })
    ]);
    coins = [];
  }
  function spawn() {
    var i = coins.length;
    var body = Matter.Bodies.circle(width / 2 + Math.sin(i * 2.4) * (width / 2 - R - 6) * 0.85, -30 - (i % 3) * 14, R, { restitution: 0.2, friction: 0.4, frictionAir: 0.015, density: 0.004 });
    Matter.Composite.add(engine.world, body); coins.push(body);
  }
  function draw() {
    ctx.clearRect(0, 0, width, HEIGHT);
    for (var i = 0; i < coins.length; i++) {
      var p = coins[i].position;
      ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.fillStyle = "#e2b24c"; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = "#b8872b"; ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, R - 3.5, 0, Math.PI * 2); ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.stroke();
    }
  }
  function atRest() {
    for (var i = 0; i < coins.length; i++) if (!coins[i].isSleeping && coins[i].speed > 0.15) return false;
    return true;
  }
  function step() {
    if (coins.length < target && frames % 2 === 0) spawn();
    Matter.Engine.update(engine, 1000 / 60); frames++;
  }
  function run() {
    cancelAnimationFrame(raf);
    var started = frames, last = performance.now();
    (function loop(now) {
      var steps = Math.max(1, Math.min(3, Math.round(((now || last) - last) / (1000 / 60))));
      last = now || last;
      for (var k = 0; k < steps; k++) step();
      draw();
      if ((coins.length >= target && frames - started > 30 && atRest()) || frames - started > 900) return;   // then rest
      raf = requestAnimationFrame(loop);
    })();
  }

  function play(rows, result) {
    var value = Math.max(0, Number(result.value) || 0);
    var perMonth = rows.length ? Number(rows[0].saved) || 0 : 0;
    var u = UNITS[UNITS.length - 1];
    for (var i = 0; i < UNITS.length; i++) if (value / UNITS[i] <= MAX) { u = UNITS[i]; break; }
    var w = canvas.clientWidth || 300;
    if (!engine || u !== unit || w !== width) { unit = u; setup(); }
    target = Math.min(MAX, Math.round(value / unit));
    // Fewer coins than before: take the newest ones away and let the pile settle.
    while (coins.length > target) Matter.Composite.remove(engine.world, coins.pop());
    coins.forEach(function (c) { Matter.Sleeping.set(c, false); });
    sub.textContent = "saved in a year (" + mydata.formatEur(perMonth) + " a month) \\u00b7 one coin = " + mydata.formatEur(unit);
    if (tween) tween.kill();
    if (mydata.reducedMotion) {
      for (var s = 0; s < 700; s++) step();
      shown.v = value; amt.textContent = mydata.formatEur(value); draw();
      return;
    }
    tween = gsap.to(shown, { v: value, duration: 0.9, ease: "power2.out", onUpdate: function () { amt.textContent = mydata.formatEur(shown.v); } });
    run();
  }
${START}
})();
</script>`;

/**
 * 3D city (Three.js with orbit controls): one tower per category, as tall as its spending. It turns
 * slowly; tapping a tower shows its figure. In full screen it can be dragged and zoomed. In the card
 * a touch scrolls the page as usual, so a finger on the scene never traps the dashboard.
 */
const CITY_CODE = `<style>
  .city { position: relative; }
  .stage { position: relative; height: 300px; }
  html.fullscreen .city { height: 100%; display: flex; flex-direction: column; }
  html.fullscreen .stage { flex: 1; height: auto; min-height: 0; }
  canvas { display: block; width: 100%; height: 100%; }
  .chip { position: absolute; left: 0; top: 0; max-width: 70%; padding: 8px 12px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); font-size: 13px; }
  .chip b { display: block; font-size: 22px; line-height: 1.2; font-variant-numeric: tabular-nums; }
  .chip span { color: var(--muted); }
  .chip button { margin-top: 6px; padding: 5px 10px; border-radius: 8px; border: 1px solid var(--border); background: transparent; color: var(--text); font: inherit; font-size: 12px; cursor: pointer; }
  .hint { margin: 6px 0 0; font-size: 12px; color: var(--muted); text-align: center; }
  .flat { list-style: none; margin: 0; padding: 0; font-size: 13px; }
  .flat li { margin: 8px 0; cursor: pointer; }
  .flat i { display: block; height: 10px; border-radius: 5px; background: var(--chart-1); margin-top: 3px; }
</style>
<div class="city">
  <div class="stage" id="stage"><canvas id="c"></canvas><div class="chip" id="chip" hidden></div></div>
  <p class="hint" id="hint"></p>
</div>
<script>
(function () {
  var canvas = document.getElementById("c"), stage = document.getElementById("stage"), chip = document.getElementById("chip"), hint = document.getElementById("hint");
  var webgl = false;
  try { var probe = document.createElement("canvas"); webgl = !!(probe.getContext("webgl2") || probe.getContext("webgl")); } catch (e) {}
  if (!webgl) {
    // No WebGL in this browser: the same figures as plain bars.
    stage.style.height = "auto"; canvas.remove();
    mydata.onData(function (rows) {
      var max = Math.max.apply(null, rows.map(function (r) { return Number(r.amount) || 0; }).concat([1]));
      var ul = document.createElement("ul"); ul.className = "flat";
      rows.forEach(function (r) {
        var li = document.createElement("li"), bar = document.createElement("i");
        li.textContent = r.label + " \\u00b7 " + mydata.formatEur(Number(r.amount) || 0);
        bar.style.width = Math.max(2, (Number(r.amount) || 0) / max * 100) + "%";
        li.appendChild(bar); li.onclick = function () { mydata.select({ key: r.key, label: r.label }); };
        ul.appendChild(li);
      });
      stage.innerHTML = ""; stage.appendChild(ul);
    });
    return;
  }

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(35, 1, 1, 3000);
  camera.position.set(125, 105, 155);
  scene.add(new THREE.AmbientLight(0xffffff, 1.9));
  var sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(-90, 220, 140);
  scene.add(sun);
  var ground = new THREE.Mesh(new THREE.CircleGeometry(100, 72), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.08, depthWrite: false }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.2; scene.add(ground);
  var group = new THREE.Group(); scene.add(group);

  var controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.enablePan = false;
  controls.minDistance = 90; controls.maxDistance = 420; controls.maxPolarAngle = Math.PI / 2 - 0.08;
  controls.target.set(0, 24, 0);
  controls.autoRotate = !mydata.reducedMotion; controls.autoRotateSpeed = 0.7;

  var towers = [], selected = null, total = 0, clock = 0;
  function show(mesh) {
    selected = mesh;
    towers.forEach(function (m) { m.material.opacity = m === mesh ? 1 : 0.5; });
    if (!mesh) { chip.hidden = true; return; }
    var r = mesh.userData.row, amount = Number(r.amount) || 0;
    chip.hidden = false; chip.innerHTML = "";
    var name = document.createElement("span"), fig = document.createElement("b"), share = document.createElement("span"), more = document.createElement("button");
    name.textContent = r.label; fig.textContent = mydata.formatEur(amount);
    share.textContent = total > 0 ? Math.round(amount / total * 100) + "% of your spending" : "";
    more.textContent = "See payments"; more.onclick = function () { mydata.select({ key: r.key, label: r.label }); };
    chip.append(name, fig, share, document.createElement("br"), more);
  }
  function build(rows) {
    towers.forEach(function (m) { group.remove(m); m.geometry.dispose(); m.material.dispose(); });
    towers = [];
    var data = rows.filter(function (r) { return Number(r.amount) > 0; }).slice(0, 16);
    total = rows.reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0);
    var max = data.length ? Number(data[0].amount) : 1;
    data.forEach(function (r) { max = Math.max(max, Number(r.amount)); });
    var cols = Math.ceil(Math.sqrt(data.length)), lines = Math.ceil(data.length / cols), gap = 30;
    var palette = ["--chart-1", "--chart-2", "--chart-3", "--chart-4"].map(function (v) { return mydata.css(v) || "#00693c"; });
    data.forEach(function (r, i) {
      var geo = new THREE.BoxGeometry(18, 1, 18); geo.translate(0, 0.5, 0);   // grows upwards from the ground
      var mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: palette[i % 4], roughness: 0.55, metalness: 0.05, transparent: true }));
      mesh.position.set((i % cols - (cols - 1) / 2) * gap, 0, (Math.floor(i / cols) - (lines - 1) / 2) * gap);
      mesh.userData = { row: r, height: Math.max(3, Number(r.amount) / max * 95), delay: i * 0.07 };
      mesh.scale.y = 0.01;
      group.add(mesh); towers.push(mesh);
    });
    ground.material.color.set(mydata.css("--text") || "#222");
    clock = mydata.reducedMotion ? 99 : 0;
    show(towers[0] || null);
  }
  function fit() {
    var w = canvas.clientWidth || 300, h = canvas.clientHeight || 300;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    // In the card a touch scrolls the page; dragging the scene is for full screen.
    controls.enabled = mydata.fullscreen;
    canvas.style.touchAction = mydata.fullscreen ? "none" : "pan-y";
    canvas.style.cursor = mydata.fullscreen ? "grab" : "pointer";
    hint.textContent = mydata.fullscreen ? "Drag to look around, pinch to zoom, tap a tower" : "Tap a tower \\u00b7 open full screen to look around";
  }
  mydata.onResize(fit);
  if ("ResizeObserver" in window) new ResizeObserver(fit).observe(stage);

  // A tap (not a drag) picks the tower under the finger.
  var down = null, ray = new THREE.Raycaster(), point = new THREE.Vector2();
  canvas.addEventListener("pointerdown", function (e) { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener("pointerup", function (e) {
    if (!down || Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 8) return;
    var box = canvas.getBoundingClientRect();
    point.set((e.clientX - box.left) / box.width * 2 - 1, -((e.clientY - box.top) / box.height) * 2 + 1);
    ray.setFromCamera(point, camera);
    var hit = ray.intersectObjects(towers)[0];
    if (hit) show(hit.object);
  });

  mydata.onData(function (rows) { build(rows); fit(); });
  mydata.loop(function (dt) {
    clock += dt;
    for (var i = 0; i < towers.length; i++) {
      var k = Math.max(0, Math.min(1, (clock - towers[i].userData.delay) / 0.9));
      towers[i].scale.y = Math.max(0.01, (1 - Math.pow(1 - k, 3)) * towers[i].userData.height);
    }
    controls.update();
    renderer.render(scene, camera);
  });
})();
</script>`;

/**
 * A story in steps (GSAP): the balance today, then each thing that still has to come out of it,
 * down to what is safe to spend. Plays by itself once, and has Back / Next to go at your own pace.
 */
const STORY_CODE = `<style>
  .story { max-width: 460px; margin: 0 auto; }
  html.fullscreen .story { height: 100%; max-width: 560px; display: flex; flex-direction: column; justify-content: center; }
  .where { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
  .cap { font-size: 17px; font-weight: 600; min-height: 2.8em; margin: 2px 0 8px; }
  .amt { font-size: 34px; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .amt small { display: block; font-size: 13px; font-weight: 400; color: var(--muted); }
  html.fullscreen .cap { font-size: 22px; } html.fullscreen .amt { font-size: 48px; }
  .bar { display: flex; height: 34px; margin: 14px 0 10px; border-radius: 10px; overflow: hidden; background: var(--border); }
  html.fullscreen .bar { height: 56px; }
  .seg { height: 100%; background: var(--green-500); transition: background-color 0.7s ease; }
  .seg + .seg { box-shadow: inset 2px 0 0 var(--bg); }
  .list { list-style: none; margin: 0 0 12px; padding: 0; font-size: 13px; }
  .list li { display: flex; align-items: center; gap: 8px; padding: 3px 0; opacity: 0; transition: opacity 0.5s ease; }
  .list li.on { opacity: 1; }
  .list i { width: 10px; height: 10px; border-radius: 3px; flex: none; }
  .list span:last-child { margin-left: auto; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .nav { display: flex; align-items: center; gap: 8px; }
  .nav button { padding: 8px 14px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font: inherit; cursor: pointer; }
  .nav button:disabled { opacity: 0.4; cursor: default; }
  .dots { flex: 1; display: flex; justify-content: center; gap: 5px; }
  .dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--border); }
  .dots i.on { background: var(--green-500); }
</style>
<div class="story">
  <div class="where" id="where">&nbsp;</div>
  <div class="cap" id="cap">&nbsp;</div>
  <div class="amt"><span id="amt">&nbsp;</span><small id="what">&nbsp;</small></div>
  <div class="bar" id="bar"></div>
  <ul class="list" id="list"></ul>
  <div class="nav"><button id="back" type="button">Back</button><div class="dots" id="dots"></div><button id="next" type="button">Next</button></div>
</div>
<script>
(function () {
  var COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--muted)"];
  var $ = function (id) { return document.getElementById(id); };
  var where = $("where"), cap = $("cap"), amt = $("amt"), what = $("what"), bar = $("bar"), list = $("list"), dots = $("dots"), back = $("back"), next = $("next");
  var steps = [], segs = [], items = [], marks = [], at = 0, shown = { v: 0 }, tween = null, auto = null, sig = "";

  function go(k, instant) {
    at = Math.max(0, Math.min(steps.length - 1, k));
    var s = steps[at];
    where.textContent = "Step " + (at + 1) + " of " + steps.length;
    cap.textContent = s.caption; what.textContent = s.what;
    segs.forEach(function (el, i) { el.style.backgroundColor = i < s.spent ? COLORS[i % COLORS.length] : ""; });
    items.forEach(function (el, i) { el.className = i < s.spent ? "on" : ""; });
    marks.forEach(function (el, i) { el.className = i === at ? "on" : ""; });
    back.disabled = at === 0;
    next.textContent = at === steps.length - 1 ? "Replay" : "Next";
    if (tween) tween.kill();
    if (instant || mydata.reducedMotion) { shown.v = s.left; amt.textContent = mydata.formatEur(s.left); }
    else tween = gsap.to(shown, { v: s.left, duration: 0.9, ease: "power2.out", onUpdate: function () { amt.textContent = mydata.formatEur(shown.v); } });
  }
  function stopAuto() { if (auto) auto.kill(); auto = null; }
  function play() {
    stopAuto();
    if (mydata.reducedMotion || at >= steps.length - 1) return;
    auto = gsap.delayedCall(2.8, function () { go(at + 1); play(); });
  }
  back.onclick = function () { stopAuto(); go(at - 1); };
  next.onclick = function () { stopAuto(); if (at === steps.length - 1) { go(0); play(); } else go(at + 1); };

  function build(rows, result) {
    var balance = rows.length ? Number(rows[0].amount) || 0 : 0;
    var last = rows[rows.length - 1] || { term: "Safe to spend", amount: 0 };
    var cuts = rows.slice(1, -1).filter(function (r) { return Number(r.amount) < 0; });
    var out = cuts.reduce(function (s, r) { return s - Number(r.amount); }, 0);
    var base = Math.max(balance, out, 1), value = Number(result.value) || 0;
    bar.innerHTML = ""; list.innerHTML = ""; dots.innerHTML = "";
    segs = []; items = []; marks = [];
    var rest = document.createElement("div"); rest.className = "seg";
    rest.style.width = Math.max(0, balance - out) / base * 100 + "%"; bar.appendChild(rest);
    steps = [{ caption: "You have this much in your account today.", what: "in your account", left: balance, spent: 0 }];
    var left = balance;
    cuts.forEach(function (r, i) {
      var n = -Number(r.amount);
      var seg = document.createElement("div"); seg.className = "seg"; seg.style.width = n / base * 100 + "%"; bar.appendChild(seg); segs.push(seg);
      var li = document.createElement("li"), sw = document.createElement("i"), a = document.createElement("span"), b = document.createElement("span");
      sw.style.background = COLORS[i % COLORS.length]; a.textContent = r.term; b.textContent = "\\u2212" + mydata.formatEur(n);
      li.append(sw, a, b); list.appendChild(li); items.push(li);
      left -= n;
      steps.push({ caption: r.term + ": " + mydata.formatEur(n) + " is set aside.", what: "left after this", left: left, spent: i + 1 });
    });
    var end = Number(last.amount) || 0;
    steps.push({ caption: last.term + ".", what: "safe to spend until payday", left: end, spent: cuts.length });
    if (Math.abs(value - end) > 0.5) steps.push({ caption: "Spread evenly over the days until payday, that is this much for now.", what: "safe to spend this week", left: value, spent: cuts.length });
    steps.forEach(function () { var d = document.createElement("i"); dots.appendChild(d); marks.push(d); });
  }

  var seen = false, latest = null;
  function start(rows, result) {
    var fresh = JSON.stringify(rows) + "|" + result.value;
    if (fresh === sig) return;   // same figures (e.g. a theme change): leave the story where it is
    sig = fresh;
    build(rows, result);
    if (mydata.reducedMotion) { go(steps.length - 1, true); return; }
    go(0, true); play();
  }
  mydata.onData(function (rows, result) { latest = [rows, result]; if (seen) start(rows, result); });
  mydata.whenVisible(function () { seen = true; if (latest) start(latest[0], latest[1]); });
})();
</script>`;

export const widgets = {
  /** Spending by category as a 3D city to look around in. */
  city: (period = "last_3_months"): Block => ({
    id: id("city"),
    title: "Your spending city",
    explanation: "Money out for the period by category. Each tower is one category and its height is the amount, so the skyline shows where your money goes.",
    source: "own",
    data: { kind: "engine", fn: "spendBy", args: { period, by: "category", category: "" } },
    view: { kind: "code", code: CITY_CODE, libs: ["three"] },
    controls: [periodControl],
  }),

  /** Safe-to-spend told step by step. */
  story: (horizon: "week" | "until_payday" = "week"): Block => ({
    id: id("story"),
    title: "From your balance to what's safe to spend",
    explanation:
      "Starts from your balance today and takes away, one step at a time, the bills, essentials and planned saving still due before payday, and a buffer for unexpected costs. What remains is safe to spend.",
    source: "estimate",
    data: { kind: "engine", fn: "safeToSpend", args: { horizon } },
    view: { kind: "code", code: STORY_CODE, libs: ["gsap"] },
    controls: [
      {
        kind: "select",
        arg: "horizon",
        label: "Horizon",
        options: [
          { value: "week", label: "This week" },
          { value: "until_payday", label: "Until payday" },
        ],
      },
    ],
  }),

  /** Goal progress as a 3D jar filling with coins. */
  jar: (target?: number, label?: string): Block => ({
    id: id("jar"),
    title: label ?? "Savings jar",
    explanation:
      "Saved = transfers to investments and savings minus withdrawals. The jar is full at your goal (the green ring), so the coins show how far along you are. Without a goal set, it uses your mortgage down payment or a 3-month emergency fund.",
    source: "estimate",
    data: { kind: "engine", fn: "goalProgress", args: { ...(target ? { target } : {}), ...(label ? { label } : {}) } },
    view: { kind: "code", code: JAR_CODE, libs: ["three", "matter", "gsap"] },
    ...(target ? { controls: [{ kind: "slider", arg: "target", label: "Goal", min: 1000, max: Math.max(50_000, target * 2), step: 500, unit: " €" } satisfies Control] } : {}),
  }),

  /** Safe-to-spend as a gauge with the working shown line by line. */
  gauge: (horizon: "week" | "until_payday" = "week"): Block => ({
    id: id("gauge"),
    title: horizon === "week" ? "Safe to spend this week" : "Safe to spend until payday",
    explanation:
      "Your balance today, minus regular bills and planned saving still due before payday, minus a buffer for unexpected costs based on your last 12 months. The gauge shows the safe amount as a share of your balance.",
    source: "estimate",
    data: { kind: "engine", fn: "safeToSpend", args: { horizon } },
    view: { kind: "code", code: GAUGE_CODE, libs: ["gsap"] },
    controls: [
      {
        kind: "select",
        arg: "horizon",
        label: "Horizon",
        options: [
          { value: "week", label: "This week" },
          { value: "until_payday", label: "Until payday" },
        ],
      },
    ],
  }),

  /** The three baskets as streams flowing out of total spending. */
  flow: (period = "last_3_months"): Block => ({
    id: id("flow"),
    title: "Where your money flows",
    explanation:
      "Your spending for the period split into the three baskets. Regular essentials repeat monthly; unexpected necessities are unusually large purchases in Home & Tech, Lifestyle, Travel or Health; the rest is everyday spending. Each stream is as wide as its share.",
    source: "own",
    data: { kind: "engine", fn: "baskets", args: { period } },
    view: { kind: "code", code: FLOW_CODE, libs: ["gsap"] },
    controls: [periodControl],
  }),

  /** What-if as a pile of coins that grows and shrinks with the slider. */
  coins: (category = "Restaurants", cutPct = 20): Block => ({
    id: id("coins"),
    title: `What if I cut ${category}?`,
    explanation: `Your average monthly spending on ${category} over the last 12 months, times the cut you choose, added up over a year. Each coin stands for the same amount of money.`,
    source: "estimate",
    data: { kind: "engine", fn: "whatIf", args: { category, cutPct } },
    view: { kind: "code", code: COINS_CODE, libs: ["matter", "gsap"] },
    controls: [
      { kind: "select", arg: "category", label: "Category", options: SPENDING_CATEGORIES.map((c) => ({ value: c, label: c })) },
      { kind: "slider", arg: "cutPct", label: "Cut by", min: 0, max: 100, step: 5, unit: "%" },
    ],
  }),
};
