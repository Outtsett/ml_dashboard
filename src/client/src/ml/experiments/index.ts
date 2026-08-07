/**
 * Experiment tracking views — the card/leaderboard reading of the same
 * `state.experiments` the ledger table renders as rows.
 *
 * The table answers "what are all the runs and their exact numbers". These
 * answer "which one is winning, and is that number trustworthy".
 */

export { Leaderboard, type LeaderboardProps } from "./Leaderboard";
export { ExperimentCard, type ExperimentCardProps } from "./ExperimentCard";
export {
  rankExperiments,
  rankDelta,
  rankSnapshot,
  sharpeCurve,
  fragility,
  FRAGILITY_THRESHOLD,
  type RankedExperiment,
} from "./ranking";
