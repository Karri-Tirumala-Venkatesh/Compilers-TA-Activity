(() => {
  const $ = (id) => document.getElementById(id);
  const NS = "http://www.w3.org/2000/svg";
  const palette = ["#2563eb","#06b6d4","#22c55e","#f59e0b","#a855f7","#e11d48","#14b8a6","#f97316","#0ea5e9","#84cc16","#6366f1","#ec4899"];

  let payload = null;

  const TAC_EXAMPLES = [
`
dummy1 = 1
dummy2 = 2
dummy3 = 3
dummy4 = 4
z_accumulator = 0
loop:
z_accumulator = z_accumulator + dummy1
if z_accumulator < 500 goto loop
result = z_accumulator + dummy2 + dummy3 + dummy4
ret result`,
`
L0:
a = 100
b = a
c = b
d = c
e = 200
f = e
g = 5
h = d + f + g
ret h`,
`
n1 = 10
n2 = 20
n3 = 30
n4 = 40
m_core = n1 + n2
m_core = m_core + n3
m_core = m_core + n4
o1 = m_core
o2 = m_core
ret o2`
  ];
  let exampleIndex = 0;

  function loadNextExample() {
    const ta = $("tacInput");
    if (!ta) return;
    ta.value = TAC_EXAMPLES[exampleIndex];
    exampleIndex = (exampleIndex + 1) % TAC_EXAMPLES.length;

    // Optional auto-refresh graph after replacing code
    generatePayload();
  }

  function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
      const cookies = document.cookie.split(';');
      for (let i = 0; i < cookies.length; i++) {
        const cookie = cookies[i].trim();
        if (cookie.substring(0, name.length + 1) === (name + '=')) {
          cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
          break;
        }
      }
    }
    return cookieValue;
  }

  function mulberry32(a) {
    return function () {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function key(a, b) { return `${a}|${b}`; }

  function updateLabels() {
    $("kRegVal").textContent = $("kReg").value;
  }

  function generatePayload() {
    const K = Number($("kReg").value);
    const tac = $("tacInput")?.value || "";
    const g = buildInterferenceGraphFrom3AC(tac);

    const rand = mulberry32(42 + K + g.nodes.length);

    const registers = Array.from({ length: K }, (_, i) => ({
      name: `R${i + 1}`,
      size_cost: +(0.1 + rand() * 1.2).toFixed(2),
      bank_penalty: +(rand() * 1.0).toFixed(2),
      energy_penalty: +(rand() * 1.0).toFixed(2),
    }));

    const variables = g.nodes.map((name) => ({
      name,
      frequency: +(1 + rand() * 9).toFixed(2),
      loop_depth: +(rand() * 4).toFixed(2),
      move_gain: +(rand() * 3).toFixed(2),
      bank_penalty: +(rand() * 1.2).toFixed(2),
      energy_penalty: +(rand() * 1.2).toFixed(2),
      allowed_registers: [],
    }));

    const interference = g.interferenceEdges.map(({ u, v }) => [u, v]);
    const move_preferences = g.moveEdges.map(({ u, v }) => ({
      from: u,
      to: v,
      gain: +(0.5 + rand() * 2.5).toFixed(2),
    }));

    payload = { registers, variables, interference, move_preferences, weights: {} };

    renderGraph("graphClassical", payload, { assignments: {}, spilled_variables: [] });
    renderGraph("graphMogra", payload, { assignments: {}, spilled_variables: [] });
    renderLegend("legendClassical", payload.registers);
    renderLegend("legendMogra", payload.registers);

    $("compareBody").innerHTML = "";
    $("traceOut").innerHTML = "Graph built from 3AC. Click <strong>Run Allocation</strong>.";
  }

  function circleLayout(nodes, w, h) {
    const cx = w / 2, cy = h / 2;
    const r = Math.min(w, h) * 0.47; // larger spread
    const pos = {};
    nodes.forEach((n, i) => {
      const a = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
      pos[n] = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });
    return pos;
  }

  function renderLegend(containerId, registers) {
    const host = $(containerId);
    host.innerHTML = "";
    registers.forEach((r, i) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.innerHTML = `<span class="dot" style="background:${palette[i % palette.length]}"></span>${r.name}`;
      host.appendChild(chip);
    });
    const spill = document.createElement("span");
    spill.className = "chip";
    spill.innerHTML = `<span class="dot" style="background:#ef4444"></span>Spill`;
    host.appendChild(spill);
  }

  function renderGraph(svgId, pl, result) {
    const svg = $(svgId);
    if (!svg) return;

    const nodeRadius = 30; // larger nodes
    const labelSize = 16;

    const W = 700, H = 460; // larger drawing space
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = "";

    const nodes = pl.variables.map(v => v.name);
    const pos = circleLayout(nodes, W, H);
    const colorByReg = Object.fromEntries(pl.registers.map((r, i) => [r.name, palette[i % palette.length]]));

    // edges
    for (const [a, b] of pl.interference) {
      const line = document.createElementNS(NS, "line");
      line.setAttribute("x1", pos[a].x);
      line.setAttribute("y1", pos[a].y);
      line.setAttribute("x2", pos[b].x);
      line.setAttribute("y2", pos[b].y);
      line.setAttribute("stroke", "#bfd2ff");
      line.setAttribute("stroke-width", "2.2");
      svg.appendChild(line);
    }

    // nodes
    for (const n of nodes) {
      const g = document.createElementNS(NS, "g");
      const c = document.createElementNS(NS, "circle");
      const t = document.createElementNS(NS, "text");

      const reg = result.assignments[n];
      const spilled = result.spilled_variables.includes(n);
      const fill = spilled ? "#ef4444" : (reg ? colorByReg[reg] : "#9db5ea");

      c.setAttribute("cx", pos[n].x);
      c.setAttribute("cy", pos[n].y);
      c.setAttribute("r", nodeRadius);
      c.setAttribute("fill", fill);
      c.setAttribute("stroke", "#1b3b7a");
      c.setAttribute("stroke-width", "1.5");

      t.setAttribute("x", pos[n].x);
      t.setAttribute("y", pos[n].y + 5);
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("font-size", labelSize);
      t.setAttribute("font-weight", "700");
      t.setAttribute("fill", "#fff");
      t.textContent = n;

      g.appendChild(c);
      g.appendChild(t);
      svg.appendChild(g);
    }
  }

  function renderComparison(classical, mogra) {
    const rows = [
      ["Assigned Variables", classical.metrics.assigned, mogra.metrics.assigned],
      ["Spilled Variables", classical.metrics.spills, mogra.metrics.spills],
      ["Spill Ratio (%)", classical.metrics.spill_ratio, mogra.metrics.spill_ratio],
      ["Total Spill Cost (lower better)", classical.metrics.spill_cost, mogra.metrics.spill_cost],
      ["Move Penalty (lower better)", classical.metrics.move_penalty, mogra.metrics.move_penalty],
      ["Bank Cost (lower better)", classical.metrics.bank_cost, mogra.metrics.bank_cost],
      ["Energy Cost (lower better)", classical.metrics.energy_cost, mogra.metrics.energy_cost],
    ];
    $("compareBody").innerHTML = rows
      .map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`)
      .join("");
  }

  async function runAllocation() {
    if (!payload) {
      $("traceOut").innerHTML = "Please generate a graph first!";
      return;
    }

    $("btnRun").disabled = true;
    $("btnRun").textContent = "Running...";
    $("traceOut").innerHTML = "Sending to server...";

    try {
      const csrftoken = getCookie('csrftoken');
      const headers = { "Content-Type": "application/json" };
      if (csrftoken) {
        headers["X-CSRFToken"] = csrftoken;
      }

      console.log("Sending payload:", payload);

      const response = await fetch("/api/allocate/", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      console.log("Response status:", response.status);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      console.log("Response data:", data);

      if (!data.success) {
        throw new Error(data.error || "Unknown error");
      }

      const classical = data.classical;
      const mogra = data.mogra;

      renderGraph("graphClassical", payload, classical);
      renderGraph("graphMogra", payload, mogra);
      renderLegend("legendClassical", payload.registers);
      renderLegend("legendMogra", payload.registers);
      renderComparison(classical, mogra);

      $("traceOut").innerHTML = [
        `<div><strong>Classical:</strong> assigned <span class="ok">${classical.metrics.assigned}</span>, spilled <span class="spill">${classical.metrics.spills}</span></div>`,
        `<div><strong>MOGRA:</strong> assigned <span class="ok">${mogra.metrics.assigned}</span>, spilled <span class="spill">${mogra.metrics.spills}</span></div>`,
        `<div>Provisional spill candidates (MOGRA): ${mogra.provisional_spill_candidates.join(", ") || "None"}</div>`,
      ].join("");
    } catch (err) {
      console.error("Error:", err);
      $("traceOut").innerHTML = `<div style="color:red"><strong>Error:</strong> ${err.message}</div>`;
    } finally {
      $("btnRun").disabled = false;
      $("btnRun").textContent = "Run Allocation";
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("kReg").addEventListener("input", updateLabels);
    $("btnGenerate").addEventListener("click", generatePayload);
    $("btnRun").addEventListener("click", runAllocation);
    $("btnExample")?.addEventListener("click", loadNextExample);

    updateLabels();
    generatePayload();
  });
})();

const RESERVED = new Set([
  "if", "goto", "ret", "return", "call", "param", "load", "store"
]);

function isVar(tok) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(tok) &&
         !RESERVED.has(tok) &&
         !/^L\d+$/.test(tok);
}

function varsFromExpr(expr) {
  const toks = (expr.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []);
  return toks.filter(isVar);
}

function parse3AC(input) {
  const raw = input
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  const inst = [];
  const labelToIndex = new Map();

  for (const line of raw) {
    if (/^[A-Za-z_][A-Za-z0-9_]*:$/.test(line)) {
      const label = line.slice(0, -1);
      labelToIndex.set(label, inst.length);
      continue;
    }

    // if x < y goto L1
    let m = line.match(/^if\s+(.+?)\s+goto\s+([A-Za-z_][A-Za-z0-9_]*)$/i);
    if (m) {
      const condVars = varsFromExpr(m[1]);
      inst.push({
        op: "if",
        text: line,
        def: null,
        use: new Set(condVars),
        target: m[2],
        move: null
      });
      continue;
    }

    // goto L1
    m = line.match(/^goto\s+([A-Za-z_][A-Za-z0-9_]*)$/i);
    if (m) {
      inst.push({
        op: "goto",
        text: line,
        def: null,
        use: new Set(),
        target: m[1],
        move: null
      });
      continue;
    }

    // ret x / return x
    m = line.match(/^(ret|return)\s*(.*)$/i);
    if (m) {
      const useVars = varsFromExpr(m[2] || "");
      inst.push({
        op: "ret",
        text: line,
        def: null,
        use: new Set(useVars),
        target: null,
        move: null
      });
      continue;
    }

    // x = expr
    m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (m) {
      const lhs = m[1];
      const rhs = m[2];
      const rhsVars = varsFromExpr(rhs);

      let move = null;
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(rhs.trim()) && isVar(rhs.trim())) {
        move = { from: rhs.trim(), to: lhs };
      }

      inst.push({
        op: "assign",
        text: line,
        def: lhs,
        use: new Set(rhsVars),
        target: null,
        move
      });
      continue;
    }

    // fallback: conservative use-only instruction
    inst.push({
      op: "other",
      text: line,
      def: null,
      use: new Set(varsFromExpr(line)),
      target: null,
      move: null
    });
  }

  return { inst, labelToIndex };
}

function buildCFG(parsed) {
  const { inst, labelToIndex } = parsed;
  const succ = Array.from({ length: inst.length }, () => new Set());

  for (let i = 0; i < inst.length; i++) {
    const cur = inst[i];
    if (cur.op === "goto") {
      const t = labelToIndex.get(cur.target);
      if (t !== undefined) succ[i].add(t);
    } else if (cur.op === "if") {
      const t = labelToIndex.get(cur.target);
      if (t !== undefined) succ[i].add(t);
      if (i + 1 < inst.length) succ[i].add(i + 1);
    } else if (cur.op === "ret") {
      // no successor
    } else {
      if (i + 1 < inst.length) succ[i].add(i + 1);
    }
  }
  return succ;
}

function liveness(parsed, succ) {
  const n = parsed.inst.length;
  const inSet = Array.from({ length: n }, () => new Set());
  const outSet = Array.from({ length: n }, () => new Set());

  let changed = true;
  while (changed) {
    changed = false;

    for (let i = n - 1; i >= 0; i--) {
      const oldIn = new Set(inSet[i]);
      const oldOut = new Set(outSet[i]);

      // out[i] = U in[s], s in succ[i]
      outSet[i].clear();
      for (const s of succ[i]) {
        for (const v of inSet[s]) outSet[i].add(v);
      }

      // in[i] = use[i] U (out[i] - def[i])
      inSet[i].clear();
      for (const v of parsed.inst[i].use) inSet[i].add(v);
      for (const v of outSet[i]) {
        if (parsed.inst[i].def !== v) inSet[i].add(v);
      }

      const sameIn = oldIn.size === inSet[i].size && [...oldIn].every(v => inSet[i].has(v));
      const sameOut = oldOut.size === outSet[i].size && [...oldOut].every(v => outSet[i].has(v));
      if (!sameIn || !sameOut) changed = true;
    }
  }

  return { inSet, outSet };
}

function buildInterferenceGraphFrom3AC(input3ac) {
  const parsed = parse3AC(input3ac);
  const succ = buildCFG(parsed);
  const { outSet } = liveness(parsed, succ);

  const nodes = new Set();
  const edgeSet = new Set();      // interference
  const moveSet = new Set();      // preference

  function addUndirected(s, a, b) {
    if (!a || !b || a === b) return;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    s.add(k);
  }

  // collect nodes
  for (const ins of parsed.inst) {
    if (ins.def) nodes.add(ins.def);
    for (const u of ins.use) nodes.add(u);
  }

  // def x liveOut => interference
  for (let i = 0; i < parsed.inst.length; i++) {
    const ins = parsed.inst[i];
    if (!ins.def) continue;

    for (const live of outSet[i]) {
      // for move x=y, do not force x<->y interference at this point (coalescing-friendly)
      if (ins.move && ((live === ins.move.from && ins.def === ins.move.to) || (live === ins.def && ins.move.from === ins.move.to))) {
        continue;
      }
      addUndirected(edgeSet, ins.def, live);
    }

    if (ins.move) addUndirected(moveSet, ins.move.from, ins.move.to);
  }

  return {
    nodes: [...nodes].sort(),
    interferenceEdges: [...edgeSet].map(k => {
      const [u, v] = k.split("|");
      return { u, v };
    }),
    moveEdges: [...moveSet].map(k => {
      const [u, v] = k.split("|");
      return { u, v };
    }),
    debug: { instructions: parsed.inst, succ }
  };
}

// ---- Hook into existing buttons ----
function buildGraphFromTextarea() {
  const tac = document.getElementById("tacInput")?.value || "";
  const g = buildInterferenceGraphFrom3AC(tac);

  // IMPORTANT:
  // Adapt these assignments to whatever your existing app state uses.
  appState.graph = g; // if your code uses a different state object, replace this line.

  // keep your existing render routine
  renderUnallocatedGraph("graphClassical", "legendClassical", g);
  renderUnallocatedGraph("graphMogra", "legendMogra", g);
}

document.getElementById("btnGenerate")?.addEventListener("click", buildGraphFromTextarea);

// ...existing code...