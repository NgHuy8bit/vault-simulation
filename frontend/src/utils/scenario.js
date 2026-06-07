export function getScenarioDividers(events, spec) {
  const dividers = new Map(); // eventId -> string (scenario name)
  
  const scenarios = spec?.scenarios || [];
  const boundaries = [];
  
  for (const scen of scenarios) {
    let minTs = null;
    for (const step of scen.steps || []) {
      const ts = step.data?.timestamp;
      if (ts) {
        if (!minTs || ts < minTs) minTs = ts;
      }
    }
    if (minTs) {
      boundaries.push({ name: scen.name, ts: minTs });
    }
  }
  
  // Sort boundaries by time
  boundaries.sort((a, b) => a.ts.localeCompare(b.ts));

  let currentScenario = null;
  let lastTs = null;
  let heuristicIdx = 1;

  for (const event of events) {
    const ts = event.timestamp;
    if (!ts) continue;

    let newScenario = null;

    if (boundaries.length > 0) {
      // Find the last boundary that starts at or before this event
      let matched = currentScenario;
      for (const b of boundaries) {
        if (ts >= b.ts) {
          matched = b.name;
        }
      }
      if (matched && matched !== currentScenario) {
        newScenario = matched;
      }
    } else {
      // Heuristic fallback: > 12h gap
      if (!currentScenario) {
        newScenario = `Scenario 1`;
      } else if (lastTs) {
        const t1 = new Date(lastTs).getTime();
        const t2 = new Date(ts).getTime();
        if (t2 - t1 > 12 * 60 * 60 * 1000) {
          heuristicIdx++;
          newScenario = `Scenario ${heuristicIdx}`;
        }
      }
    }

    if (newScenario) {
      currentScenario = newScenario;
      dividers.set(event.id, currentScenario);
    }
    
    lastTs = ts;
  }

  return dividers;
}
