/** Every control of the page, with its default. Kept in the URL by useStudyControls. */

export const DEFAULTS = {
  tab: "specifications",
  /** Exchange groups hidden from the table and charts, separated by | ("" = all shown). */
  hiddenExchangeGroups: "",
  /** Currencies hidden, separated by | ("" = all shown). */
  hiddenCurrencies: "",
  lakeOnly: false,
  contract: "MNQ",
  contractsHeld: 1,
  /** Whole ticks the index moved; the notebook's slider stepped in ticks too. */
  ticksMoved: 40,
  /** Step i of the running sum (0 = the whole sum). */
  stepIndex: 0,
  rollRoot: "MNQ",
  rollYear: 2025,
  hoursRoot: "MNQ",
  hoursSeries: "allContracts",
  clock: "pacific",
};

type Widen<C> = { [K in keyof C]: C[K] extends string ? string : C[K] extends number ? number : C[K] extends boolean ? boolean : C[K] };

export type Controls = Widen<typeof DEFAULTS>;
export type SetControl = <K extends keyof Controls>(key: K, value: Controls[K]) => void;

export function splitList(value: string): string[] {
  return value === "" ? [] : value.split("|");
}

export function toggleInList(value: string, item: string): string {
  const items = splitList(value);
  return (items.includes(item) ? items.filter((entry) => entry !== item) : [...items, item]).join("|");
}
