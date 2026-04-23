(() => {
  const $ = (id) => document.getElementById(id);
  const NS = "http://www.w3.org/2000/svg";
  const palette = ["#2563eb","#06b6d4","#22c55e","#f59e0b","#a855f7","#e11d48","#14b8a6","#f97316","#0ea5e9","#84cc16","#6366f1","#ec4899"];

  let payload = null;

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
    $("nVarVal").textContent = $("nVar").value;
    $("densityVal").textContent = `${$("density").value}%`;
    $("moveDensityVal").textContent = `${$("moveDensity").value}%`;
  }

  function handleModeChange() {
    const mode = document.querySelector('input[name="graphMode"]:checked').value;
    if (mode === "random") {
      $("randomControls").style.display = "block";
      $("tacControls").style.display = "none";
    } else {
      $("randomControls").style.display = "none";
      $("tacControls").style.display = "block";
      if (!$("tacInput").value.trim()) {
        $("tacInput").value = `// High Pressure & Move Optimized Example
// Recommended: Set Registers (K) to 4 or 6

// Initialize variables
a = 5
b = 10
c = 15
d = 20
e = 25
f = 30
g = 35
h = 40
i = 45
j = 50

loop:
  // High interference block
  t1 = a + b
  t2 = c + d
  t3 = e + f
  t4 = g + h
  t5 = i + j
  t6 = t1 * t2
  t7 = t3 * t4
  t8 = t6 + t7
  t9 = t8 + t5

  // Move chain (MOGRA minimizes these costs)
  m1 = t9
  m2 = m1
  m3 = m2
  m4 = m3
  
  // Feedback into variables
  a = m4 + 1
  counter = counter + 1
  
  if counter < 20 goto loop

result = a
return result`;
      }
    }
  }

  async function generatePayload() {
    const K = Number($("kReg").value);
    const N = Number($("nVar").value);
    const density = Number($("density").value) / 100;
    const moveDensity = Number($("moveDensity").value) / 100;
    const seed = Number($("seed").value || 42);
    const rand = mulberry32(seed);

    const registers = Array.from({ length: K }, (_, i) => ({
      name: `R${i + 1}`,
      size_cost: +(0.1 + rand() * 1.2).toFixed(2),
      bank_penalty: +(rand() * 1.0).toFixed(2),
      energy_penalty: +(rand() * 1.0).toFixed(2),
    }));

    const mode = document.querySelector('input[name="graphMode"]:checked').value;
    
    if (mode === "random") {
      const variables = Array.from({ length: N }, (_, i) => ({
        name: `v${i + 1}`,
        frequency: +(1 + rand() * 9).toFixed(2),
        loop_depth: +(rand() * 4).toFixed(2),
        move_gain: +(rand() * 3).toFixed(2),
        bank_penalty: +(rand() * 1.2).toFixed(2),
        energy_penalty: +(rand() * 1.2).toFixed(2),
        allowed_registers: [],
      }));

      const interference = [];
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          if (rand() < density) interference.push([variables[i].name, variables[j].name]);
        }
      }

      const move_preferences = [];
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          if (rand() < moveDensity) {
            move_preferences.push({
              from: variables[i].name,
              to: variables[j].name,
              gain: +(0.5 + rand() * 2.5).toFixed(2),
            });
          }
        }
      }

      payload = { registers, variables, interference, move_preferences, weights: {} };
      renderPayload();
    } else {
      // TAC Mode
      $("btnGenerate").disabled = true;
      $("btnGenerate").textContent = "Parsing TAC...";
      try {
        const csrftoken = getCookie('csrftoken');
        const headers = { "Content-Type": "application/json" };
        if (csrftoken) headers["X-CSRFToken"] = csrftoken;
        
        const response = await fetch("/api/parse_tac/", {
          method: "POST", headers,
          body: JSON.stringify({ tac: $("tacInput").value })
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || `HTTP ${response.status}`);
        }
        const data = await response.json();
        
        // Use parsed variables, interference, moves + generated registers
        payload = { 
          registers, 
          variables: data.data.variables, 
          interference: data.data.interference, 
          move_preferences: data.data.move_preferences, 
          weights: {} 
        };
        renderPayload();
      } catch (err) {
        console.error("TAC Parse error:", err);
        $("traceOut").innerHTML = `<div style="color:red"><strong>Parse Error:</strong> ${err.message}</div>`;
      } finally {
        $("btnGenerate").disabled = false;
        $("btnGenerate").textContent = "Generate Graph";
      }
    }
  }

  function renderPayload() {
    console.log("Payload generated:", payload);
    
    renderGraph("graphClassical", payload, { assignments: {}, spilled_variables: [] });
    renderGraph("graphMogra", payload, { assignments: {}, spilled_variables: [] });
    renderLegend("legendClassical", payload.registers);
    renderLegend("legendMogra", payload.registers);
    $("compareBody").innerHTML = "";
    $("traceOut").innerHTML = "Graph generated. Click <strong>Run Allocation</strong>.";
  }

  function circleLayout(nodes, w, h) {
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.38;
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
    const W = 560, H = 340;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = "";

    const nodes = pl.variables.map(v => v.name);
    const pos = circleLayout(nodes, W, H);
    const colorByReg = Object.fromEntries(pl.registers.map((r, i) => [r.name, palette[i % palette.length]]));

    // edges
    for (const [a, b] of pl.interference) {
      const line = document.createElementNS(NS, "line");
      line.setAttribute("x1", pos[a].x); line.setAttribute("y1", pos[a].y);
      line.setAttribute("x2", pos[b].x); line.setAttribute("y2", pos[b].y);
      line.setAttribute("stroke", "#bfd2ff");
      line.setAttribute("stroke-width", "1.6");
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

      c.setAttribute("cx", pos[n].x); c.setAttribute("cy", pos[n].y);
      c.setAttribute("r", "14");
      c.setAttribute("fill", fill);
      c.setAttribute("stroke", "#1b3b7a");
      c.setAttribute("stroke-width", "1.3");

      t.setAttribute("x", pos[n].x);
      t.setAttribute("y", pos[n].y + 4);
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("font-size", "9.5");
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
      ["Move Penalty (lower better)", classical.metrics.move_penalty, mogra.metrics.move_penalty],
      ["Bank Cost (lower better)", classical.metrics.bank_cost, mogra.metrics.bank_cost],
      ["Energy Cost (lower better)", classical.metrics.energy_cost, mogra.metrics.energy_cost],
      ["Runtime (ms)", classical.runtimeMs, mogra.runtimeMs],
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
    ["kReg", "nVar", "density", "moveDensity"].forEach(id => $(id).addEventListener("input", updateLabels));
    document.querySelectorAll('input[name="graphMode"]').forEach(el => el.addEventListener('change', handleModeChange));
    $("btnGenerate").addEventListener("click", generatePayload);
    $("btnRun").addEventListener("click", runAllocation);

    updateLabels();
    handleModeChange();
    generatePayload();
  });
})();