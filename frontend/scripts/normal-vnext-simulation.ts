import { resolve } from "node:path";
import { runNormalVNextSimulation, type SimulationProfile } from "./normal-vnext-simulation-runner";

const raw = Object.fromEntries(
  process.argv.slice(2).map((part) => {
    const [key, value] = part.replace(/^--/, "").split("=");
    return [key, value ?? "true"];
  })
);
const positive = (name: string, fallback: number) => {
  const value = Number(raw[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1)
    throw new Error(`--${name} must be a positive integer`);
  return value;
};
const profile = (raw.profile ?? "normal-vNext") as SimulationProfile;
if (!(["normal-v1", "normal-vNext", "compare"] as const).includes(profile))
  throw new Error("--profile must be normal-v1, normal-vNext, or compare");
const seeds = (raw.seeds ?? "0,1").split(",").map(Number);
if (!seeds.length || seeds.some((seed) => !Number.isInteger(seed) || seed < 0))
  throw new Error("--seeds must be comma-separated non-negative integers");
const outputDir = resolve(raw["output-dir"] ?? "../temp/normal-vnext-simulation");
runNormalVNextSimulation({
  profile,
  seeds,
  gamesPerSeed: positive("games-per-seed", 1),
  maxTurns: positive("max-turns", 1000),
  outputDir
});
console.log(resolve(outputDir, "report.json"));
