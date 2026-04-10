import { useState, useEffect } from "react";
import "./App.css";

const ESPN_URL =
  "https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard?league=pga&event=401811941";

type PlayerPicks = Record<string, string[]>;

interface Athlete {
  displayName: string;
  shortName: string;
  headshot?: { href: string };
}

interface Linescore {
  value?: number;
  displayValue?: string;
  period: number;
}

interface Statistic {
  name: string;
  value?: number;
  displayValue?: string;
}

interface Competitor {
  athlete: Athlete;
  score: { value?: number; displayValue: string };
  status: {
    displayValue?: string;
    position: { displayName: string };
    detail?: string;
    todayDetail?: string;
    type?: { state: string };
  };
  linescores: Linescore[];
  statistics: Statistic[];
  sortOrder: number;
}

interface ESPNEvent {
  name: string;
  competitions: { competitors: Competitor[] }[];
}

interface ESPNResponse {
  events: ESPNEvent[];
}

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ø/g, "o")
    .replace(/Ø/g, "o")
    .replace(/å/g, "a")
    .replace(/Å/g, "a")
    .replace(/æ/g, "ae")
    .replace(/Æ/g, "ae")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function extractLastName(name: string): string {
  const parts = normalizeName(name).split(" ");
  return parts[parts.length - 1];
}

function matchPick(pick: string, competitors: Competitor[]): Competitor | null {
  const normalized = normalizeName(pick);

  const exact = competitors.find(
    (c) =>
      normalizeName(c.athlete.shortName) === normalized ||
      normalizeName(c.athlete.displayName) === normalized
  );
  if (exact) return exact;

  const pickLast = extractLastName(pick);
  const lastNameMatches = competitors.filter(
    (c) =>
      extractLastName(c.athlete.displayName) === pickLast ||
      extractLastName(c.athlete.shortName) === pickLast
  );
  if (lastNameMatches.length === 1) return lastNameMatches[0];

  if (lastNameMatches.length > 1) {
    const pickFirst = normalizeName(pick)[0];
    const initialed = lastNameMatches.find(
      (c) => normalizeName(c.athlete.displayName)[0] === pickFirst
    );
    if (initialed) return initialed;
  }

  return null;
}

function getScoreToPar(c: Competitor): number | null {
  const stat = c.statistics.find((s) => s.name === "scoreToPar");
  if (stat?.value !== undefined) return stat.value;
  if (stat?.displayValue === "E") return 0;
  if (stat?.displayValue) {
    const n = parseInt(stat.displayValue, 10);
    if (!isNaN(n)) return n;
  }
  if (c.score.displayValue === "E") return 0;
  const n = parseInt(c.score.displayValue, 10);
  return isNaN(n) ? null : n;
}

function getRoundScore(c: Competitor, round: number): string {
  const ls = c.linescores.find((l) => l.period === round);
  if (!ls || ls.value === undefined) return "-";
  return ls.displayValue ?? String(ls.value);
}

function formatScore(score: number | null): string {
  if (score === null) return "-";
  if (score === 0) return "E";
  return score > 0 ? `+${score}` : String(score);
}

function scoreClass(displayValue: string): string {
  if (displayValue === "E" || displayValue === "-") return "even";
  if (displayValue.startsWith("-")) return "under";
  return "over";
}

// Build a map from golfer displayName -> picker name
function buildPickerMap(
  picks: PlayerPicks,
  competitors: Competitor[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [name, playerNames] of Object.entries(picks)) {
    for (const pick of playerNames) {
      const match = matchPick(pick, competitors);
      if (match) {
        map.set(match.athlete.displayName, name);
      }
    }
  }
  return map;
}

// Rank family members by their best single golfer's position (sortOrder)
function buildFamilyRankings(
  picks: PlayerPicks,
  competitors: Competitor[]
): { name: string; bestGolfer: Competitor | null; bestScore: number | null }[] {
  return Object.entries(picks)
    .map(([name, playerNames]) => {
      const matched = playerNames
        .map((pick) => matchPick(pick, competitors))
        .filter((c): c is Competitor => c !== null);

      // Best = lowest sortOrder (highest on leaderboard)
      matched.sort((a, b) => a.sortOrder - b.sortOrder);
      const best = matched[0] ?? null;

      return {
        name,
        bestGolfer: best,
        bestScore: best ? getScoreToPar(best) : null,
      };
    })
    .sort((a, b) => {
      if (!a.bestGolfer && !b.bestGolfer) return 0;
      if (!a.bestGolfer) return 1;
      if (!b.bestGolfer) return -1;
      return a.bestGolfer.sortOrder - b.bestGolfer.sortOrder;
    });
}

const ROUNDS = [1, 2, 3, 4];

export default function App() {
  const [picks, setPicks] = useState<PlayerPicks | null>(null);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [eventName, setEventName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"leaderboard" | "standings">("leaderboard");

  useEffect(() => {
    Promise.all([
      fetch("/players.json").then((r) => r.json()),
      fetch(ESPN_URL).then((r) => r.json()),
    ])
      .then(([playerData, espnData]: [PlayerPicks, ESPNResponse]) => {
        setPicks(playerData);
        const event = espnData.events?.[0];
        if (event) {
          setEventName(event.name);
          const comps = event.competitions?.[0]?.competitors ?? [];
          comps.sort((a, b) => a.sortOrder - b.sortOrder);
          setCompetitors(comps);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading leaderboard...</div>;
  if (error) return <div className="error">Error: {error}</div>;
  if (!picks || competitors.length === 0)
    return <div className="error">No data available</div>;

  const pickerMap = buildPickerMap(picks, competitors);
  const familyRankings = buildFamilyRankings(picks, competitors);

  return (
    <div className="app">
      <header>
        <h1>🏌️ Masters Pool 2026</h1>
        <p className="event-name">{eventName}</p>
        <nav>
          <button
            className={view === "leaderboard" ? "active" : ""}
            onClick={() => setView("leaderboard")}
          >
            Leaderboard
          </button>
          <button
            className={view === "standings" ? "active" : ""}
            onClick={() => setView("standings")}
          >
            Pool Standings
          </button>
        </nav>
      </header>

      {view === "leaderboard" ? (
        <div className="leaderboard">
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th>Pos</th>
                <th>Player</th>
                <th>Picked By</th>
                <th>Total</th>
                {ROUNDS.map((r) => (
                  <th key={r}>R{r}</th>
                ))}
                <th>Thru</th>
              </tr>
            </thead>
            <tbody>
              {competitors.map((c) => {
                const scoreToPar = formatScore(getScoreToPar(c));
                const picker = pickerMap.get(c.athlete.displayName);
                return (
                  <tr key={c.athlete.displayName} className={picker ? "picked" : ""}>
                    <td className="pos">{c.status.position.displayName}</td>
                    <td className="golfer-name">{c.athlete.displayName}</td>
                    <td className="picker">{picker ?? ""}</td>
                    <td className={`score ${scoreClass(scoreToPar)}`}>{scoreToPar}</td>
                    {ROUNDS.map((r) => {
                      const rs = getRoundScore(c, r);
                      return (
                        <td key={r} className={`score ${scoreClass(rs)}`}>
                          {rs}
                        </td>
                      );
                    })}
                    <td className="thru">{c.status.todayDetail ?? c.status.detail ?? "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="standings">
          <table className="standings-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Person</th>
                <th>Best Golfer</th>
                <th>Pos</th>
                <th>Score</th>
                <th>Other Picks</th>
              </tr>
            </thead>
            <tbody>
              {familyRankings.map((member, rank) => {
                const allGolfers = (picks[member.name] ?? [])
                  .map((pick) => matchPick(pick, competitors))
                  .filter((c): c is Competitor => c !== null);

                const others = allGolfers.filter(
                  (c) => c !== member.bestGolfer
                );

                const bestScore = member.bestGolfer
                  ? formatScore(getScoreToPar(member.bestGolfer))
                  : "-";

                return (
                  <tr key={member.name}>
                    <td className="rank">{rank + 1}</td>
                    <td className="member-name">{member.name}</td>
                    <td className="golfer-name">
                      {member.bestGolfer?.athlete.displayName ?? "-"}
                    </td>
                    <td className="pos">
                      {member.bestGolfer?.status.position.displayName ?? "-"}
                    </td>
                    <td className={`score ${scoreClass(bestScore)}`}>
                      {bestScore}
                    </td>
                    <td className="other-picks">
                      {others.map((c) => {
                        const s = formatScore(getScoreToPar(c));
                        return (
                          <span key={c.athlete.displayName} className="other-pick">
                            {c.athlete.shortName}{" "}
                            <span className={`score ${scoreClass(s)}`}>({s})</span>
                          </span>
                        );
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
