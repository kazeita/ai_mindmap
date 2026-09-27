# Draft Board: decision record and V1 plan

26 Sep 2026. Built from the *Idea Shortlist — Build Brief* (Innovative Ideas project).
Live as a new tab at `/draft-board`, next to the AI Map (which is unchanged).

## 1. Ranking of the four candidates

Scored in the brief's filter order: cold start, platform ToS, regulatory, pull distribution, competition; then effort, revenue and code reuse.

| Rank | Idea | Cold start | ToS / API | Regulatory | Pull distribution | Competition | Effort | Revenue | Read |
|---|---|---|---|---|---|---|---|---|---|
| 1 | math-tools | None needed | None | None | Strong: npm, MCP Registry | MCP form crowded; framework-native form unverified | S | Weak | Best on the filter, weakest commercially |
| 2 | The Vault | Single-player | None | None without prizes | Medium: daily share card | Not checked | M | Weak–medium | Retention unproven; solvable mazes undercut any prize framing |
| 3 | **The Draft Board** | One organiser is enough (see §2) | Low | Light: peer-rating privacy | Medium: every shared team link reaches ~10 players | Crowded and free, on Discord *and* on the web (§3) | M | Medium on paper | Only worth it if the blind test (§4) shows a real gap |
| 4 | LoopTik | Single user | Medium | None | Weak: no native channel | Not checked | S (bug) / M | Weak | Park |

**Pick: The Draft Board** (the builder's call). The rest of this doc is about making that bet cheap to test and easy to kill.

## 2. Audience and surface

Recurring pickup groups **outside Discord**: futsal/football, basketball, badminton, office and club nights. Web app, share links, group-chat text.

- Discord skill balancing is table stakes and free (Team Up, In-House Queue, open-source bots; see the brief).
- The host gets value alone on night one, so cold start is one organiser, not a network. Players only ever receive a link.
- Distribution loop: each shared team link and chat message is seen by the whole group; the page offers "Make teams for your group" to the organisers among them.

## 3. Stress test: weak points found early

1. **The web angle is crowded too.** Two searches on 26 Sep found skill-tier balancers with chat sharing and history: [MatchBalancer](https://matchbalancer.com/en/football-team-generator) (WhatsApp/Telegram sharing, match history), [Keamk](https://www.keamk.com/), [Shuffly](https://shuffly.netlify.app/), [voll-e](https://apps.apple.com/us/app/voll-e-pickup-team-generator/id6751260723), [Belo](https://play.google.com/store/apps/details?id=com.balanceteammaker&hl=en_US) (positions), [Futsal Squad](https://futsalsquad.com/blog/best-futsal-app) (ratings, tracks games). Not yet verified: install counts, and whether any of them *learn ratings from results*. Tier balancing, sharing and positions are table stakes.
2. **The differentiator is invisible on night one.** Tiers-only night one looks like every rival. The edge (ratings that learn from results, rules, teammate mixing, chemistry) needs hosts to log results for several sessions. That's a retention bet.
3. **Tiers are coarse.** With an odd headcount the best split often reads 56/44, and the app says so. Balance can't beat the input.
4. **Uneven team sizes.** Team strength is the sum of player skill (as in TrueSkill and OpenSkill), so the smaller team gets stronger players. Whether that matches real 6-v-5 games is untested.
5. **Small samples.** The blind test needs about 8 sessions per side. A weekly group gives one session a week, and half of a test group's sessions go to the random side. Two weeks with 3–5 groups can only show a *large* difference.
6. **Local-first limits.** One device per group, no co-host sync, and pass-the-phone can't enforce host-only visibility. Backups exist, sync doesn't.
7. **Revenue.** Free rivals everywhere. A paid tier (sync, co-hosts, club history) would need a backend, and only makes sense after §4 passes.

## 4. Kill criteria

Stop if any of these holds:

- **No visible gap (brief's criterion, made measurable).** After two weeks with 3–5 real groups, with the fairness test on and results pooled, Draft Board games are *not* clearly closer than the control. "Clearly" means the average margin is at least 0.05 lower, or the "felt lopsided" rate at least 15 points lower. The History tab computes exactly this.
- **The learning loop never starts.** Fewer than half of the test hosts log results for 3+ sessions. Without results, Draft Board is a commodity tier balancer.
- **The audit finds it done.** A free, widely installed app (e.g. 100k+ installs) already learns ratings from results and supports keep-apart/together rules.

## 5. V1: what's built (this branch)

- **Roster.** Paste the list straight from a group chat ("1. Minh", "- Lan", commas). Tiers 1–5 (optional, unknown counts as 3), here-tonight toggle, New tag, positions (e.g. GK).
- **Cold start.** Host tiers, plus *pass the phone*: each person privately taps tiers for the others in about 30 seconds. Only running sums are stored, never who rated whom, and each person rates once per round.
- **Balancer** (`engine/balance.js`, deterministic and seedable). The objective is the brief's: skill gap + keep-apart/together + position coverage + newcomers spread + teammates repeated from last time. Search is exhaustive for 2 teams up to ~18 players, and random restarts + swap local search beyond that (60 players / 6 teams in ~35 ms). It picks randomly among near-optimal splits, so *Shuffle again* gives a different fair split.
- **Ratings** (`engine/rating.js`). The Weng–Lin Bayesian model behind OpenSkill: skill plus uncertainty, so newcomers start wide and settle. Ratings are replayed from the result log, so deleting a result rewinds it.
- **Teams screen.** Predicted win chance, rule warnings, tap-to-swap, latecomer/leaver fixes, captains'-pick recording, *Copy for group chat*, and a read-only share link (names only, carried in the URL hash so it never reaches a server).
- **Results.** Scores or just the winner; several short games per session; "how did it feel" (lopsided / fair / close).
- **Fairness test** (`engine/experiment.js`). When on, half the splits are random (still honouring team sizes, rules and positions). Balance info is hidden, *Shuffle again* is removed, and the arm is revealed only after the result is logged. History shows per-arm margin, felt-lopsided / felt-close and edit rates, plus a plain verdict. *Download anonymised test data* exports sessions with names replaced (p1, p2, …) so several groups can be pooled.
- **Chemistry (early signal).** Pairs whose teams beat or miss the prediction together, shrunk toward zero, shown after 5+ games together. Display only; not used for balancing until it proves itself.
- **Data.** Everything in `localStorage`; backup/restore JSON; delete a group. No accounts, no server, no LLM anywhere in the correctness path.

Tests: `npm test` runs 26 engine tests (balancer optimality against brute force, rules, positions, determinism, ratings, share-link round trip, storage hardening, experiment verdicts). The UI was driven end to end in Chromium at 390 px and 1280 px.

## 6. Next steps, in order

1. **Competitor audit (1 day):** install counts and reviews for the apps in §3. Check whether any learns from results; if so, check the third kill criterion.
2. **Two-week test:** 3–5 real groups, fairness test on, hosts send the anonymised export; pool and read against §4.
3. **Decide** continue or stop.
4. Only if continuing: QR code for the team link, per-player rating links on their own phones, co-host sync (needs a backend), PWA install, a Vietnamese translation for local search traffic.

## How a test host runs a night

1. Players tab: paste the group list, tap tiers (or *Pass the phone*), untick anyone missing.
2. Teams tab: turn on *Fairness test*, press *Make fair teams*, *Copy for group chat*, and play the first split you get.
3. After the game: *Log result* (score or winner, plus how it felt). The app reveals which kind of split it was.
4. After two weeks: History, then *Download anonymised test data*, and send the file.

## Code map

```
src/main.jsx                 site tabs: AI Map (/) and Draft Board (/draft-board), both kept alive
src/SiteTabs.jsx             tab bar
src/draft-board/
  DraftBoard.jsx             state, persistence, section switcher, shared-link view
  PlayersView.jsx            roster, tiers, positions      PeerRating.jsx    pass the phone
  TeamsView.jsx              setup, rules, teams, sharing  CaptainsPick.jsx  ResultForm.jsx
  HistoryView.jsx            fairness test, chemistry, sessions, backups
  engine/                    pure JS, no React: balance, rating, experiment, share, store
```
