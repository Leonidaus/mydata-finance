import type { Block } from "../blocks";

let sequence = 0;
const makeId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(sequence++).toString(36)}`;

const downsideCode = `<style>
  .scenario { max-width: 560px; margin: 0 auto; }
  .scenario h4 { margin: 4px 0; font-size: 18px; }
  .scenario p { margin: 6px 0 12px; color: var(--muted); }
  .scenario .tag { color: var(--danger); font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  .scenario .controls { display: grid; gap: 10px; margin: 14px 0; }
  .scenario label { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; font-size: 13px; }
  .scenario label input { grid-column: 1 / -1; width: 100%; accent-color: var(--danger); }
  .scenario .stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .scenario .stat { padding: 10px; border: 1px solid var(--border); border-radius: 10px; }
  .scenario .stat span { display: block; color: var(--muted); font-size: 12px; }
  .scenario .stat b { display: block; margin-top: 3px; font-size: 18px; font-variant-numeric: tabular-nums; }
  .scenario .bar { height: 12px; margin: 12px 0 6px; overflow: hidden; border-radius: 99px; background: var(--surface-weak); }
  .scenario .bar i { display: block; width: 50%; height: 100%; background: var(--danger); transition: width .2s; }
  .scenario .result { padding: 10px 12px; border-radius: 10px; background: var(--surface-weak); color: var(--danger); font-weight: 650; }
  .scenario small { display: block; margin-top: 10px; color: var(--muted); line-height: 1.4; }
</style>
<section class="scenario">
  <div class="tag">Downside example · illustrative only</div>
  <h4>Borrowed money can leave a debt after losses</h4>
  <p>This example shows leverage: the loan still has to be repaid if the investment falls.</p>
  <div class="controls">
    <label>Own money invested <b id="own-value"></b><input id="own" type="range" min="1000" max="50000" step="1000" value="10000" aria-label="Own money invested"></label>
    <label>Borrowed to invest <b id="loan-value"></b><input id="loan" type="range" min="0" max="100000" step="1000" value="20000" aria-label="Borrowed to invest"></label>
    <label>Investment loss <b id="fall-value"></b><input id="fall" type="range" min="0" max="80" step="5" value="40" aria-label="Investment loss percentage"></label>
  </div>
  <div class="stats">
    <div class="stat"><span>Investment after loss</span><b id="after"></b></div>
    <div class="stat"><span>Loan balance</span><b id="debt"></b></div>
    <div class="stat"><span>Value after loan</span><b id="equity"></b></div>
    <div class="stat"><span>Own money lost</span><b id="lost"></b></div>
  </div>
  <div class="bar"><i id="bar"></i></div>
  <div class="result" id="result" aria-live="polite"></div>
  <small>A negative result here means this investment alone would not cover the loan. It does not determine whether someone is legally bankrupt; that depends on their full finances and ability to pay. No loan or investment is being recommended.</small>
</section>
<script>
(function () {
  var own = document.getElementById("own"), loan = document.getElementById("loan"), fall = document.getElementById("fall");
  function eur(n) { return mydata.formatEur(Math.round(n)); }
  function update() {
    var capital = Number(own.value), debt = Number(loan.value), loss = Number(fall.value) / 100;
    var invested = capital + debt, after = invested * (1 - loss), equity = after - debt;
    document.getElementById("own-value").textContent = eur(capital);
    document.getElementById("loan-value").textContent = eur(debt);
    document.getElementById("fall-value").textContent = Math.round(loss * 100) + "%";
    document.getElementById("after").textContent = eur(after);
    document.getElementById("debt").textContent = eur(debt);
    document.getElementById("equity").textContent = (equity < 0 ? "−" : "") + eur(Math.abs(equity));
    document.getElementById("lost").textContent = eur(Math.min(capital, Math.max(0, capital - equity)));
    document.getElementById("bar").style.width = (invested ? Math.max(0, Math.min(100, after / invested * 100)) : 0) + "%";
    document.getElementById("result").textContent = equity < 0
      ? "The investment is " + eur(-equity) + " short of the loan balance."
      : "After the loss, " + eur(equity) + " remains after subtracting the loan.";
  }
  [own, loan, fall].forEach(function (input) { input.addEventListener("input", update); });
  update();
})();
</script>`;

const goalCode = `<style>
  .scenario { max-width: 560px; margin: 0 auto; }
  .scenario h4 { margin: 4px 0; font-size: 18px; }
  .scenario p { margin: 6px 0 12px; color: var(--muted); }
  .scenario .tag { color: var(--chart-1); font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  .scenario .controls { display: grid; gap: 10px; margin: 14px 0; }
  .scenario label { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; font-size: 13px; }
  .scenario label input { grid-column: 1 / -1; width: 100%; accent-color: var(--chart-1); }
  .scenario .stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .scenario .stat { padding: 10px; border: 1px solid var(--border); border-radius: 10px; }
  .scenario .stat span { display: block; color: var(--muted); font-size: 12px; }
  .scenario .stat b { display: block; margin-top: 3px; font-size: 18px; font-variant-numeric: tabular-nums; }
  .scenario svg { display: block; width: 100%; height: 170px; margin: 10px 0; overflow: visible; }
  .scenario .goal-line { stroke: var(--border); stroke-dasharray: 5 4; }
  .scenario .contrib { fill: none; stroke: var(--chart-4); stroke-width: 3; }
  .scenario .growth { fill: none; stroke: var(--chart-1); stroke-width: 3; }
  .scenario .legend { display: flex; gap: 16px; color: var(--muted); font-size: 12px; }
  .scenario .legend i { display: inline-block; width: 9px; height: 9px; margin-right: 5px; border-radius: 50%; background: var(--chart-4); }
  .scenario .legend span:last-child i { background: var(--chart-1); }
  .scenario .result { padding: 10px 12px; border-radius: 10px; background: var(--surface-weak); color: var(--text); font-weight: 650; }
  .scenario small { display: block; margin-top: 10px; color: var(--muted); line-height: 1.4; }
</style>
<section class="scenario">
  <div class="tag">Favorable example · illustrative only</div>
  <h4>Could regular investing reach a savings goal?</h4>
  <p>Compare contributions alone with one smooth, hypothetical return assumption.</p>
  <div class="controls">
    <label>Starting amount <b id="start-value"></b><input id="start" type="range" min="0" max="20000" step="500" value="3000" aria-label="Starting amount"></label>
    <label>Monthly contribution <b id="monthly-value"></b><input id="monthly" type="range" min="50" max="1000" step="50" value="200" aria-label="Monthly contribution"></label>
    <label>Savings goal <b id="target-value"></b><input id="target" type="range" min="5000" max="100000" step="2500" value="25000" aria-label="Savings goal"></label>
    <label>Assumed annual return <b id="rate-value"></b><input id="rate" type="range" min="0" max="10" step="0.5" value="5" aria-label="Assumed annual return percentage"></label>
  </div>
  <div class="stats">
    <div class="stat"><span>After 10 years, contributions only</span><b id="plain"></b></div>
    <div class="stat"><span>After 10 years, with assumed return</span><b id="growth-total"></b></div>
  </div>
  <svg viewBox="0 0 320 150" role="img" aria-label="Illustrative ten-year savings projection">
    <line id="goal-line" class="goal-line" x1="0" x2="320" y1="0" y2="0" />
    <path id="plain-line" class="contrib" d="" />
    <path id="growth-line" class="growth" d="" />
  </svg>
  <div class="legend"><span><i></i>Contributions only</span><span><i></i>Assumed return</span></div>
  <div class="result" id="goal-result" aria-live="polite"></div>
  <small>Assumes the same return every year, compounded monthly. Real returns vary and can be negative. Fees, taxes and inflation are excluded; these figures are not a forecast or investment recommendation.</small>
</section>
<script>
(function () {
  var start = document.getElementById("start"), monthly = document.getElementById("monthly"), target = document.getElementById("target"), rate = document.getElementById("rate");
  function eur(n) { return mydata.formatEur(Math.round(n)); }
  function update() {
    var initial = Number(start.value), payment = Number(monthly.value), goal = Number(target.value), annual = Number(rate.value) / 100;
    var simple = initial, invested = initial, reached = initial >= goal ? 0 : -1;
    var plainPoints = [simple], growthPoints = [invested], month;
    for (month = 1; month <= 120; month++) {
      simple += payment;
      invested = invested * (1 + annual / 12) + payment;
      if (reached < 0 && invested >= goal) reached = month;
      if (month % 12 === 0) { plainPoints.push(simple); growthPoints.push(invested); }
    }
    document.getElementById("start-value").textContent = eur(initial);
    document.getElementById("monthly-value").textContent = eur(payment) + "/month";
    document.getElementById("target-value").textContent = eur(goal);
    document.getElementById("rate-value").textContent = (annual * 100).toFixed(1) + "%";
    document.getElementById("plain").textContent = eur(simple);
    document.getElementById("growth-total").textContent = eur(invested);
    var max = Math.max(goal, simple, invested) * 1.12;
    function path(values) {
      return values.map(function (v, i) { return (i ? "L" : "M") + (i * 32) + " " + (140 - v / max * 130); }).join(" ");
    }
    document.getElementById("plain-line").setAttribute("d", path(plainPoints));
    document.getElementById("growth-line").setAttribute("d", path(growthPoints));
    var goalY = 140 - goal / max * 130;
    document.getElementById("goal-line").setAttribute("y1", goalY);
    document.getElementById("goal-line").setAttribute("y2", goalY);
    document.getElementById("goal-result").textContent = reached === 0
      ? "The starting amount already meets the goal in this example."
      : reached > 0
        ? "At this assumed return, the goal is reached in about " + (reached / 12).toFixed(1) + " years."
        : "The goal is not reached within the ten-year chart at this assumed return.";
  }
  [start, monthly, target, rate].forEach(function (input) { input.addEventListener("input", update); });
  update();
})();
</script>`;

function scenarioBlock(prefix: string, title: string, explanation: string, code: string): Block {
  return {
    id: makeId(prefix),
    title,
    explanation,
    source: "estimate",
    component: `widget:${prefix}`,
    data: { kind: "engine", fn: "monthlyTrend", args: { metric: "saving", months: 12 } },
    view: { kind: "code", code },
  };
}

export const investmentDownsideScenario = () =>
  scenarioBlock(
    "investment-downside",
    "Bad scenario: borrowing to invest",
    "A made-up leverage example: a market loss can leave an investment worth less than the remaining loan. Not a personal insolvency forecast.",
    downsideCode,
  );

export const investmentGoalScenario = () =>
  scenarioBlock(
    "investment-goal",
    "Good scenario: investing toward a savings goal",
    "A made-up ten-year projection comparing contributions alone with a fixed hypothetical return. Actual returns vary and can be negative.",
    goalCode,
  );
