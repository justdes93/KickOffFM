// Round-robin fixture generator (circle method).
// For N teams (must be even — for odd, add a "bye"), produces 2*(N-1) rounds:
// first half each pair plays once (home/away assigned), second half mirrors with home/away swapped.

export function generateRoundRobin(teamIds) {
  if (teamIds.length % 2 !== 0) throw new Error('round-robin requires even team count');
  const N = teamIds.length;
  const rounds = [];
  // Standard circle method: team[0] is fixed; others rotate.
  let arr = teamIds.slice();
  for (let r = 0; r < N - 1; r++) {
    const matches = [];
    for (let i = 0; i < N / 2; i++) {
      const home = arr[i];
      const away = arr[N - 1 - i];
      // Alternate home/away each round so team-0 doesn't always host
      if (r % 2 === 0 && i === 0) {
        matches.push({ home: away, away: home });
      } else {
        matches.push({ home, away });
      }
    }
    rounds.push(matches);
    // Rotate (keeping arr[0] fixed)
    arr = [arr[0], ...arr.slice(2), arr[1]];
  }
  // Second half — mirror with H/A swapped
  for (let r = 0; r < N - 1; r++) {
    const swapped = rounds[r].map(m => ({ home: m.away, away: m.home }));
    rounds.push(swapped);
  }
  return rounds;
}

// Schedule rounds to dates: 3 per week (Tue/Thu/Sat) at 19:00 UTC starting `seasonStart`.
// Returns array parallel to rounds: each entry is the scheduled Date for that round.
export function scheduleRoundDates(numRounds, seasonStart) {
  const start = new Date(seasonStart);
  // Snap to next Tuesday (UTC).
  const dow = start.getUTCDay();              // 0 Sun .. 6 Sat
  const daysToTue = (2 - dow + 7) % 7;        // 2 = Tuesday
  const firstTue = new Date(start);
  firstTue.setUTCDate(start.getUTCDate() + daysToTue);
  firstTue.setUTCHours(19, 0, 0, 0);

  const offsets = [0, 2, 4];                  // Tue, Thu, Sat from base Tue
  const dates = [];
  for (let r = 0; r < numRounds; r++) {
    const week = Math.floor(r / 3);
    const slot = r % 3;
    const d = new Date(firstTue);
    d.setUTCDate(firstTue.getUTCDate() + week * 7 + offsets[slot]);
    dates.push(d);
  }
  return dates;
}
