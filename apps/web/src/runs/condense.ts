/**
 * The terminal's short form of the engine's longest lines. The engine writes
 * every landing with its full object path and manifest note; on the page that
 * is noise, and the path is one toggle away ("Full lines").
 */

const LANDED = /^\[save\] landed (\w+): ([\d,]+) rows -> s3:\/\/\S+(?: \((manifest[^)]*)\))?$/;
const ARTIFACTS = /^\[save\] artifacts written to (.+)$/;
const INPUTS = /^\[save\] model inputs for Inside the model .* (\S+[\\/]explain)\s*$/;
const RECORD = /^\[save\] the record so far written to (.+)$/;
const DROPPED = /^\[features\] dropped (\w+): the shared feature engine could not compute it from OHLCV alone$/;

export function condenseLine(message: string): string {
  const landed = LANDED.exec(message);
  if (landed) return `[save] landed ${landed[1]} · ${landed[2]} rows`;
  const artifacts = ARTIFACTS.exec(message);
  if (artifacts) return `[save] artifacts written · ${artifacts[1]!.split(/[\\/]/).pop()}`;
  const inputs = INPUTS.exec(message);
  if (inputs) return "[save] model inputs for Inside the model written";
  if (RECORD.test(message)) return "[save] the record so far written";
  const dropped = DROPPED.exec(message);
  if (dropped) return `[features] dropped ${dropped[1]} (needs more than OHLCV)`;
  return message;
}
