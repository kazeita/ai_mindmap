// The fairness test: are Draft Board teams visibly closer than a random split
// or captains' picks? This is the product's own kill criterion, measured.

export const ARM_LABELS = {
  balanced: "Draft Board",
  random: "Random (blind)",
  captains: "Captains' pick",
};

export const MIN_SESSIONS = 8; // per arm before the comparison says anything

// 0 = dead even, 1 = shutout. Comparable across sports with different scoring.
export function margin(m) {
  if (!Number.isFinite(m.sa) || !Number.isFinite(m.sb)) return null;
  const total = m.sa + m.sb;
  return total > 0 ? Math.abs(m.sa - m.sb) / total : 0;
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export function summarizeExperiment(sessions) {
  const arms = new Map();
  for (const s of sessions) {
    if (!arms.has(s.arm)) arms.set(s.arm, { arm: s.arm, sessions: 0, edited: 0, margins: [], lopsided: 0, close: 0, rated: 0 });
    const a = arms.get(s.arm);
    a.sessions++;
    if (s.edited) a.edited++;
    for (const m of s.matches) {
      const mg = margin(m);
      if (mg != null) a.margins.push(mg);
    }
    if (s.feel) {
      a.rated++;
      if (s.feel === "lopsided") a.lopsided++;
      if (s.feel === "close") a.close++;
    }
  }
  const order = Object.keys(ARM_LABELS);
  return [...arms.values()]
    .sort((x, y) => order.indexOf(x.arm) - order.indexOf(y.arm))
    .map((a) => ({
      arm: a.arm,
      label: ARM_LABELS[a.arm] || a.arm,
      sessions: a.sessions,
      editedRate: a.edited / a.sessions,
      scoredMatches: a.margins.length,
      meanMargin: mean(a.margins),
      rated: a.rated,
      lopsidedRate: a.rated ? a.lopsided / a.rated : null,
      closeRate: a.rated ? a.close / a.rated : null,
    }));
}

// Plain-language read-out. Thresholds are deliberately blunt: small samples
// can only show big differences, and a small difference is a "stop" signal.
export function experimentVerdict(summary, minSessions = MIN_SESSIONS) {
  const bal = summary.find((x) => x.arm === "balanced");
  const controls = summary.filter((x) => x.arm !== "balanced");
  if (!bal || !controls.length) {
    return {
      status: "no-control",
      text: "Nothing to compare against yet: random splits come from the fairness test, or record a night with Captains pick.",
    };
  }
  const ready = controls.filter((c) => c.sessions >= minSessions);
  if (bal.sessions < minSessions || !ready.length) {
    const need = Math.max(0, minSessions - bal.sessions) + Math.max(0, minSessions - Math.max(...controls.map((c) => c.sessions)));
    return { status: "collecting", need, text: `Keep logging: about ${need} more session${need === 1 ? "" : "s"} before the comparison means anything. Pool exports across groups to get there sooner.` };
  }
  const reads = ready.map((c) => {
    const marginGain = bal.meanMargin != null && c.meanMargin != null ? c.meanMargin - bal.meanMargin : null;
    const lopsidedGain = bal.lopsidedRate != null && c.lopsidedRate != null ? c.lopsidedRate - bal.lopsidedRate : null;
    const better = (marginGain != null && marginGain >= 0.05) || (lopsidedGain != null && lopsidedGain >= 0.15);
    const worse = (marginGain != null && marginGain <= -0.05) || (lopsidedGain != null && lopsidedGain <= -0.15);
    return { arm: c.arm, label: c.label, marginGain, lopsidedGain, better: better && !worse, worse };
  });
  if (reads.every((r) => r.better)) return { status: "better", reads, text: "Draft Board games were clearly closer than the control. Keep going." };
  if (reads.some((r) => r.worse)) return { status: "worse", reads, text: "The control produced closer games. That is a stop signal for the balancing claim." };
  return { status: "no-difference", reads, text: "No clear difference from the control yet. If this holds after two weeks, the kill criterion says stop." };
}
