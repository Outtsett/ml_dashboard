/**
 * The MNQ EDA study (apps/api/studies/handlers/mnq-eda-30m.ts and the numerics in
 * packages/shared/src/studies/mnq-eda-30m.ts) against scipy, statsmodels and the notebook's own
 * libraries. EXPECTED was produced by scipy 1.18, statsmodels 0.14.6 and the quant
 * workspace's generate_folds / generate_direction_labels on the same inputs: a
 * 400-value Student-t sample, and 44,162 synthetic half-hour bars built here from an
 * integer linear congruential generator so both languages produce identical bars.
 */

import { describe, expect, it } from "vitest";
import handler, { querySchema, viewFor } from "../../studies/handlers/mnq-eda-30m";
import {
  autocorrelation, chiSquareSurvival, dAgostinoPearson, describeMoments, directionLabelCounts, fillibenPositions,
  kruskalWallis, leastSquaresLine, normalQuantile, partialAutocorrelation, rollingStandardDeviation, walkForwardFolds,
  type AutocorrelationBody, type ColumnsBody, type FoldsBody, type LabelsBody, type PriceBody, type ReturnsBody,
  type StationarityBody, type SummaryBody, type TensorBody, type VolatilityBody, type WeekdayBody,
} from "@shared/studies/mnq-eda-30m";
import type { StudyContext, StudyLake } from "../../studies/types";

const EXPECTED = {"x":[0.000001205,-0.001176576,0.000042188,-0.000568501,0.000174373,0.001443676,-0.003822901,-0.000466713,0.000184939,-0.000601369,-0.002042139,-0.000616222,-0.000026169,-0.000117309,-0.001303358,-0.001254794,-0.000376272,-0.001276732,-0.000162091,0.000455113,0.00026939,-0.001658282,0.000667547,-0.000690461,-0.000527113,0.000862119,-0.000166636,-0.000291909,-0.000359454,-0.000327417,-0.00002083,0.001154961,-0.001243462,-0.002520948,0.000090522,-0.000632516,-0.000209748,0.000907333,0.000062265,-0.000671702,0.000125413,-0.003674506,-0.001733364,0.001199449,0.000306209,0.001620434,-0.000270588,-0.000606697,-0.001250297,-0.000120867,-0.000868177,0.000010159,-0.002143887,-0.001184174,-0.000524981,-0.000298405,0.000812437,-0.000697687,-0.000259552,0.001805783,-0.000044377,0.000779562,0.000016352,0.000530613,0.000744691,0.000450574,0.001217762,-0.001010286,0.000528754,-0.002961827,-0.001117254,-0.005863107,0.000053648,-0.001982398,-0.002437156,-0.000057906,-0.001127735,0.000300374,0.00019804,0.001007359,-0.001920092,-0.000087587,0.001275359,-0.002199107,-0.000936875,0.000088657,0.001166587,-0.000057704,0.000558044,0.000749453,-0.001470019,-0.000835726,-0.000386679,-0.002606221,0.000148608,-0.000130721,-0.000003694,-0.00030562,0.000702558,-0.000299351,0.001354415,-0.00083027,0.000540837,-0.00124706,-0.000470827,0.000265799,-0.000687449,0.000384229,0.000850704,-0.000003467,0.002448534,-0.001016492,-0.000790194,0.000720043,0.000328641,-0.001237888,0.001162522,-0.00115505,-0.000207441,-0.000332449,-0.000076576,0.000634704,0.001211589,0.000728207,-0.002178972,0.000350286,-0.001464663,-0.000328792,-0.00086336,0.001445358,-0.000169556,-0.002866381,-0.00019308,-0.0026656,0.000500853,0.000405014,0.000744651,0.001190276,-0.000473503,0.002979203,-0.000666346,-0.000298669,0.001036308,-0.000663949,-0.000842191,-0.002064815,0.00205461,-0.00110124,-0.000347547,0.000463596,0.000684435,-0.000084859,0.000040848,-0.000104085,-0.003039391,0.000063462,-0.001640765,0.000590217,0.000884814,-0.001868621,0.002320655,-0.00003201,0.003339443,-0.002089366,0.00137867,-0.000245274,0.000939875,-0.001324485,-0.000676605,-0.000644517,-0.000436443,-0.000171612,-0.00002752,-0.000208882,-0.000915928,-0.000918936,0.000294487,-0.001141735,0.000256666,0.000139254,-0.001019645,0.000176059,-0.000632809,-0.000584479,0.000244395,-0.000393921,0.000460393,0.000554067,0.000595781,-0.001364867,0.001012918,0.00109432,0.000857337,-0.000454207,0.000169785,-0.000124699,-0.000650659,0.000085703,-0.000047392,0.001013408,0.000621852,0.000649924,-0.002157501,-0.003506101,0.000853897,-0.000012468,-0.000112043,0.001267051,0.000250647,-0.000032116,-0.000177791,0.001488851,-0.001140069,0.000602068,-0.000884582,-0.001167829,0.000657531,-0.000180859,-0.000866107,0.000671187,0.000092056,0.000170338,-0.000319859,0.002137258,0.001764154,0.000108512,-0.003614649,-0.000878405,0.000776778,-0.00112949,0.001252908,-0.000421694,-0.002789875,0.001992668,0.000411633,-0.000266811,0.000908167,0.001526278,-0.001766867,0.000372613,-0.001616177,-0.000466564,-0.001679242,0.000655361,-0.002926794,-0.000533243,0.000787401,-0.000136139,-0.000765501,-0.000018089,0.001126433,0.001615443,-0.000307989,-0.000150239,0.002567106,0.000453337,-0.000164926,0.000080541,0.00011253,-0.002843182,0.000584409,-0.001321973,-0.00059959,-0.002645215,-0.000619586,0.001881996,-0.001243682,0.000626852,-0.000165813,-0.000106946,0.000681878,0.000402851,-0.001703099,0.000434662,0.000200716,-0.000319155,0.000132378,-0.000805679,0.004427003,-0.000697671,-0.000536728,-0.001276457,-0.00187528,-0.000510021,0.00071526,-0.000775064,-0.001814217,0.000162853,0.001323777,0.002076949,-0.0000823,-0.001312224,0.000016163,0.000260675,0.000496884,0.000261978,-0.001061002,0.00097548,-0.000290776,-0.001260849,-0.001166526,-0.001093709,0.000615771,-0.000184697,0.000067549,0.001178297,0.000273057,0.000795172,-0.001899208,0.000723949,0.001370533,-0.000138227,0.001711266,0.001433794,-0.00028446,-0.000402835,-0.000619101,-0.000719959,0.000041439,0.001125146,0.001064708,-0.000680316,0.001177615,-0.000837003,0.000829528,0.000737479,-0.001971841,0.001150564,0.000612515,-0.001734799,-0.000119547,0.001139929,0.000437309,-0.000284568,-0.000692904,0.000725771,0.000509719,0.000230684,-0.000847833,0.000065748,-0.002167554,0.000556111,-0.000216928,-0.003104598,-0.000632074,0.00137483,-0.000358524,0.001787398,-0.000863915,0.000927067,-0.00244792,-0.000541487,-0.001444575,0.002080537,-0.000313718,-0.000555333,-0.000682466,-0.002772618,-0.000578958,0.00218102,0.001748638,-0.000133894,0.000164397,0.004158628,-0.000744266,-0.001310263,0.00051087,0.005151694,0.002084567,-0.000285644,-0.000463374,-0.000843877,-0.001052257,0.000333565,0.000068157,0.00136099,0.000051524,-0.00069786,0.001754502,-0.000557214,-0.002035583,0.000348356,0.001742332,0.000311263,-0.001136603,-0.000064898,-0.000978047,0.000334611,-0.000740654,-0.001294698,0.000708082,-0.00338159,-0.002748634,-0.000582542,-0.000005617,-0.000234756,0.000197622,-0.000394502,0.000786071,-0.000142779],"moments":{"mean":-0.00015712631500000001,"std":0.0012533429680108398,"skew":-0.14816451158346391,"kurtosis":2.296569878616043,"median":-0.000118428,"p25":-0.0007788465,"p75":0.000591608,"min":-0.005863107,"max":0.005151694},"normaltest":{"stat":27.017435276845724,"p":0.0000013590595042647676,"skew_z":-1.2251766004741158,"kurt_z":5.051373830404597},"acf":[1,-0.021964572093634248,0.013335616428649529,0.011183592971625904,0.015343258976951992,-0.0328175344504153,-0.04231729711002475,0.02418319607371115,-0.062020688810231185,0.025624862400505103,-0.07965644713020838,-0.042978443921121,-0.00628733225364298],"pacf":[1,-0.022019621146500468,0.01292403225539452,0.01185171782602855,0.015841731438442985,-0.03288594752235501,-0.04504997424579723,0.023268059641504617,-0.06071050389551659,0.02520793980957794,-0.08006469984768796,-0.05076219840695344,-0.0057817350265609285],"acf_sq":[1,-0.029252283119392597,0.05805561843862997,-0.008859670585306772,0.08793762099468369,-0.049640481859728115,-0.025302483817331047,-0.0202555229831272,0.017886213713779995,-0.01489181288530791,0.017866363402180754,-0.0086353738155704,0.012421073021411861],"rolling_std_20_tail":[null,0.0010826704775048933,0.0010918110704329406,0.0014367481263488592,0.0012196927200232147],"xr":[0,-0.00118,0.00004,-0.00057,0.00017,0.00144,-0.00382,-0.00047,0.00018,-0.0006,-0.00204,-0.00062,-0.00003,-0.00012,-0.0013,-0.00125,-0.00038,-0.00128,-0.00016,0.00046,0.00027,-0.00166,0.00067,-0.00069,-0.00053,0.00086,-0.00017,-0.00029,-0.00036,-0.00033,-0.00002,0.00115,-0.00124,-0.00252,0.00009,-0.00063,-0.00021,0.00091,0.00006,-0.00067,0.00013,-0.00367,-0.00173,0.0012,0.00031,0.00162,-0.00027,-0.00061,-0.00125,-0.00012,-0.00087,0.00001,-0.00214,-0.00118,-0.00052,-0.0003,0.00081,-0.0007,-0.00026,0.00181,-0.00004,0.00078,0.00002,0.00053,0.00074,0.00045,0.00122,-0.00101,0.00053,-0.00296,-0.00112,-0.00586,0.00005,-0.00198,-0.00244,-0.00006,-0.00113,0.0003,0.0002,0.00101,-0.00192,-0.00009,0.00128,-0.0022,-0.00094,0.00009,0.00117,-0.00006,0.00056,0.00075,-0.00147,-0.00084,-0.00039,-0.00261,0.00015,-0.00013,0,-0.00031,0.0007,-0.0003,0.00135,-0.00083,0.00054,-0.00125,-0.00047,0.00027,-0.00069,0.00038,0.00085,0,0.00245,-0.00102,-0.00079,0.00072,0.00033,-0.00124,0.00116,-0.00116,-0.00021,-0.00033,-0.00008,0.00063,0.00121,0.00073,-0.00218,0.00035,-0.00146,-0.00033,-0.00086,0.00145,-0.00017,-0.00287,-0.00019,-0.00267,0.0005,0.00041,0.00074,0.00119,-0.00047,0.00298,-0.00067,-0.0003,0.00104,-0.00066,-0.00084,-0.00206,0.00205,-0.0011,-0.00035,0.00046,0.00068,-0.00008,0.00004,-0.0001,-0.00304,0.00006,-0.00164,0.00059,0.00088,-0.00187,0.00232,-0.00003,0.00334,-0.00209,0.00138,-0.00025,0.00094,-0.00132,-0.00068,-0.00064,-0.00044,-0.00017,-0.00003,-0.00021,-0.00092,-0.00092,0.00029,-0.00114,0.00026,0.00014,-0.00102,0.00018,-0.00063,-0.00058,0.00024,-0.00039,0.00046,0.00055,0.0006,-0.00136,0.00101,0.00109,0.00086,-0.00045,0.00017,-0.00012,-0.00065,0.00009,-0.00005,0.00101,0.00062,0.00065,-0.00216,-0.00351,0.00085,-0.00001,-0.00011,0.00127,0.00025,-0.00003,-0.00018,0.00149,-0.00114,0.0006,-0.00088,-0.00117,0.00066,-0.00018,-0.00087,0.00067,0.00009,0.00017,-0.00032,0.00214,0.00176,0.00011,-0.00361,-0.00088,0.00078,-0.00113,0.00125,-0.00042,-0.00279,0.00199,0.00041,-0.00027,0.00091,0.00153,-0.00177,0.00037,-0.00162,-0.00047,-0.00168,0.00066,-0.00293,-0.00053,0.00079,-0.00014,-0.00077,-0.00002,0.00113,0.00162,-0.00031,-0.00015,0.00257,0.00045,-0.00016,0.00008,0.00011,-0.00284,0.00058,-0.00132,-0.0006,-0.00265,-0.00062,0.00188,-0.00124,0.00063,-0.00017,-0.00011,0.00068,0.0004,-0.0017,0.00043,0.0002,-0.00032,0.00013,-0.00081,0.00443,-0.0007,-0.00054,-0.00128,-0.00188,-0.00051,0.00072,-0.00078,-0.00181,0.00016,0.00132,0.00208,-0.00008,-0.00131,0.00002,0.00026,0.0005,0.00026,-0.00106,0.00098,-0.00029,-0.00126,-0.00117,-0.00109,0.00062,-0.00018,0.00007,0.00118,0.00027,0.0008,-0.0019,0.00072,0.00137,-0.00014,0.00171,0.00143,-0.00028,-0.0004,-0.00062,-0.00072,0.00004,0.00113,0.00106,-0.00068,0.00118,-0.00084,0.00083,0.00074,-0.00197,0.00115,0.00061,-0.00173,-0.00012,0.00114,0.00044,-0.00028,-0.00069,0.00073,0.00051,0.00023,-0.00085,0.00007,-0.00217,0.00056,-0.00022,-0.0031,-0.00063,0.00137,-0.00036,0.00179,-0.00086,0.00093,-0.00245,-0.00054,-0.00144,0.00208,-0.00031,-0.00056,-0.00068,-0.00277,-0.00058,0.00218,0.00175,-0.00013,0.00016,0.00416,-0.00074,-0.00131,0.00051,0.00515,0.00208,-0.00029,-0.00046,-0.00084,-0.00105,0.00033,0.00007,0.00136,0.00005,-0.0007,0.00175,-0.00056,-0.00204,0.00035,0.00174,0.00031,-0.00114,-0.00006,-0.00098,0.00033,-0.00074,-0.00129,0.00071,-0.00338,-0.00275,-0.00058,-0.00001,-0.00023,0.0002,-0.00039,0.00079,-0.00014],"kruskal":{"h":2.117442077534409,"p":0.3468991973573168},"chi2_sf":{"2|0.5":0.7788007830714049,"2|5.339":0.06928686007997176,"2|12.0":0.002478752176666357,"2|40.0":2.0611536224385566e-9,"4|0.5":0.9735009788392561,"4|5.339":0.2542481330634562,"4|12.0":0.01735126523666451,"4|40.0":4.328422607120966e-8,"5|0.5":0.9921232932326296,"5|5.339":0.3759231391248908,"5|12.0":0.03478778050624185,"5|40.0":1.493367900050393e-7},"norm_ppf":{"1e-10":-6.361340902404056,"0.0001":-3.7190164854556804,"0.01":-2.3263478740408408,"0.3":-0.5244005127080409,"0.5":0,"0.975":1.959963984540054,"0.99999":4.264890793923841},"probplot50":{"osm":[-2.2038543193919886,-1.832934782096951,-1.6140232349225472,-1.4529684907558387,-1.3226775907499744,-1.2116334217984945,-1.113805000713168,-1.0256152690243034,-0.9447567372367901,-0.8696472647994755,-0.7991502146206946,-0.7324180714913386,-0.66879924550216,-0.6077795951824284,-0.5489441469321729,-0.4919511230407071,-0.43651376730447095,-0.38238727333683137,-0.3293591439228716,-0.27724190958337397,-0.22586749816478416,-0.17508277411238346,-0.12474591089442287,-0.07472335405014022,-0.024887193818824104,0.024887193818824104,0.07472335405014036,0.12474591089442287,0.1750827741123836,0.22586749816478416,0.27724190958337414,0.3293591439228716,0.3823872733368312,0.43651376730447067,0.4919511230407068,0.5489441469321724,0.6077795951824281,0.6687992455021594,0.7324180714913382,0.7991502146206944,0.8696472647994751,0.9447567372367895,1.0256152690243034,1.1138050007131675,1.2116334217984945,1.3226775907499735,1.4529684907558387,1.6140232349225463,1.8329347820969502,2.2038543193919886],"slope":0.0010776530041671682,"intercept":-0.0004244161399999999,"r":0.95944409772062},"bars":{"n":44162,"first":"2019-05-05T15:00:00","last":"2022-06-30T23:30:00"},"folds":{"12|240|24":[[1,0,27601,27842,41825]],"6|100|12":[[1,0,13777,13878,20921],[2,0,20773,20874,27841],[3,0,27741,27842,34905],[4,0,34757,34858,41825]],"3|0|6":[[1,0,6909,6910,10421],[2,0,10421,10422,13905],[3,0,13877,13878,17389],[4,0,17389,17390,20921],[5,0,20873,20874,24453],[6,0,24405,24406,27841],[7,0,27841,27842,31373],[8,0,31325,31326,34905],[9,0,34857,34858,38437],[10,0,38389,38390,41825]]},"labels":{"1|0.0":[21952,22209,0],"1|5.0":[8370,8435,27356],"1|20.5":[0,0,44161],"3|0.0":[22041,22118,0],"4|7.25":[9978,9985,24195]},"tensor_last32":{"first":[0,0,0,0,0],"last":[0.0006064366898499429,0.00005320350464899093,0.0004374811833258718,-0.00011478768283268437,0.9783848524093628],"mean":[0.00006780086550861597,0.00005161473018233664,0.0000622706938884221,0.000039909962652018294,0.05698782950639725],"std":[0.0004850366385653615,0.00040019096923060715,0.0004634919168893248,0.0004688015324063599,1.5657025575637817],"min":-5,"max":4.143134593963623},"dow":{"0":[-0.0000023850616230050496,0.00047184502155188043,7920],"1":[-6.541609501606513e-8,0.00047669530821640456,7920],"2":[6.146663263551629e-7,0.00046718112232173905,7920],"3":[-3.1468696533593133e-7,0.000471843314375128,7920],"4":[0.00001363268252062748,0.0004791029053110071,4592],"6":[-0.00001118399238706429,0.00047331239047184907,7889]},"dow_kw":[3.786933657849364,0.43560846682541243],"dow_kw_all":[8.24509659718006,0.14323516068754366],"vol":{"thr75":5.376347839081156,"high":11017,"last":5.229099398760837,"overall":5.201267184966687},"closes_head":[10000,9998.25,10000.79,10007.51,10012.86],"synthetic_series_spec":"see test generator"};

/** A lookup the test needs to have found something: fails the test otherwise, and narrows the type. */
function defined<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  return value as T;
}

function close(actual: number | null | undefined, expected: number, tolerance = 1e-9): void {
  expect(actual).not.toBeNull();
  expect(actual).not.toBeUndefined();
  expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(tolerance * Math.max(1, Math.abs(expected)));
}

// ── the synthetic bars ───────────────────────────────────────────────────────

function buildBars() {
  const times: number[] = [];
  for (let stamp = Date.UTC(2019, 4, 5, 15, 0); stamp < Date.UTC(2022, 6, 1); stamp += 30 * 60_000) {
    const date = new Date(stamp);
    const day = date.getUTCDay();
    if (day === 6 || (day === 5 && date.getUTCHours() >= 14)) continue;
    times.push(stamp);
  }
  let state = 12345;
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state;
  };
  const closeCents = [1000000];
  const openCents = [1000000];
  const highCents: number[] = [];
  const lowCents: number[] = [];
  const volume: number[] = [];
  for (let index = 0; index < times.length; index += 1) {
    const step = ((next() >>> 8) % 1601) - 800;
    const previous = closeCents[closeCents.length - 1] as number;
    const closeNow = index > 0 ? previous + step : 1000000;
    if (index > 0) {
      closeCents.push(closeNow);
      openCents.push(previous);
    }
    const up = (next() >>> 8) % 401;
    const down = (next() >>> 8) % 401;
    highCents.push(Math.max(openCents[index] as number, closeNow) + up);
    lowCents.push(Math.min(openCents[index] as number, closeNow) - down);
    volume.push((next() >>> 8) % 900);
  }
  return {
    times,
    open: openCents.map((cents) => cents / 100),
    high: highCents.map((cents) => cents / 100),
    low: lowCents.map((cents) => cents / 100),
    close: closeCents.map((cents) => cents / 100),
    volume,
  };
}

const BARS = buildBars();

const STATIONARITY_ROWS = [
  { source: "full", timeframe: "30m", series: "log_return", test: "augmented_dickey_fuller", bar_count: 100, statistic: -39.2, p_value: 0, p_value_is_table_edge: false, lags_used: 59, observations_used: 40, critical_value_1_percent: -3.43, critical_value_2_5_percent: null, critical_value_5_percent: -2.86, critical_value_10_percent: -2.57, null_hypothesis: "unit root", verdict: "stationary (the unit root is rejected)", computed_with: "statsmodels" },
  { source: "full", timeframe: "30m", series: "log_return", test: "kpss", bar_count: 100, statistic: 0.05, p_value: 0.1, p_value_is_table_edge: true, lags_used: 11, observations_used: 100, critical_value_1_percent: 0.739, critical_value_2_5_percent: 0.574, critical_value_5_percent: 0.463, critical_value_10_percent: 0.347, null_hypothesis: "stationary", verdict: "stationary (stationarity is not rejected)", computed_with: "statsmodels" },
];

let queryCount = 0;
function fakeLake(present: string[] = ["mnq_ohlcv_30m", "derived_study_mnq_eda_30m_stationarity_tests"]): StudyLake {
  return {
    async query<T>(sql: string): Promise<T[]> {
      queryCount += 1;
      if (sql.includes("epoch_ms(timestamp) AS t")) {
        return BARS.times.map((t, index) => ({ t, open: BARS.open[index], high: BARS.high[index], low: BARS.low[index], close: BARS.close[index], volume: BARS.volume[index] })) as T[];
      }
      if (sql.includes("count(*) AS n")) {
        return [{ n: BARS.times.length, first: BARS.times[0], last: BARS.times[BARS.times.length - 1] }] as T[];
      }
      if (sql.includes("derived_study_mnq_eda_30m_stationarity_tests")) return STATIONARITY_ROWS as T[];
      throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
    },
    async hasView(name) {
      return present.includes(name);
    },
    async columns() {
      return [];
    },
  };
}

/** The response body of each section, so a test reads typed fields. */
interface BodyOf {
  summary: SummaryBody; price: PriceBody; returns: ReturnsBody; stationarity: StationarityBody;
  autocorrelation: AutocorrelationBody; volatility: VolatilityBody; weekday: WeekdayBody; tensor: TensorBody;
  labels: LabelsBody; folds: FoldsBody; columns: ColumnsBody;
}

async function run<S extends keyof BodyOf>(
  params: { section: S } & Record<string, string | number>,
  lake: StudyLake = fakeLake(),
): Promise<{ body: BodyOf[S]; notes: string[] }> {
  const query = handler.query.parse(params);
  const context: StudyContext = { lake, notes: [] };
  const body = await handler.run(query, context);
  return { body: body as BodyOf[S], notes: context.notes };
}

// ── the pure numerics against scipy / statsmodels ────────────────────────────

describe("numerics agree with scipy and statsmodels", () => {
  const x = EXPECTED.x as number[];

  it("the eight numbers in the notebook's convention", () => {
    const moments = describeMoments(x);
    const expected = EXPECTED.moments;
    expect(moments.count).toBe(x.length);
    close(moments.mean, expected.mean);
    close(moments.standardDeviation, expected.std);
    close(moments.skewness, expected.skew);
    close(moments.kurtosis, expected.kurtosis);
    close(moments.median, expected.median);
    close(moments.percentile25, expected.p25);
    close(moments.percentile75, expected.p75);
    close(moments.minimum, expected.min);
    close(moments.maximum, expected.max);
  });

  it("D'Agostino-Pearson: both z scores, K squared and its p", () => {
    const result = dAgostinoPearson(x);
    close(result.skewnessZ, EXPECTED.normaltest.skew_z);
    close(result.kurtosisZ, EXPECTED.normaltest.kurt_z);
    close(result.statistic, EXPECTED.normaltest.stat);
    close(result.pValue, EXPECTED.normaltest.p);
  });

  it("autocorrelation, partial autocorrelation (Yule-Walker, adjusted) and squared autocorrelation", () => {
    const acf = autocorrelation(x, 12);
    const pacf = partialAutocorrelation(x, 12);
    const squared = autocorrelation(x.map((value) => value * value), 12);
    for (let lag = 0; lag <= 12; lag += 1) {
      close(acf[lag], EXPECTED.acf[lag], 1e-10);
      close(pacf[lag], EXPECTED.pacf[lag], 1e-10);
      close(squared[lag], EXPECTED.acf_sq[lag], 1e-10);
    }
  });

  it("rolling standard deviation is the sample one and NaN until the window is full", () => {
    const full = [Number.NaN, ...x.slice(0, -1)];
    const rolling = rollingStandardDeviation(full, 20);
    expect(Number.isNaN(rolling[18])).toBe(true);
    // pandas: the first valid window is [1..20]
    const indices = [19, 20, 21, 150, 399];
    const expected = EXPECTED.rolling_std_20_tail as Array<number | null>;
    indices.forEach((index, position) => {
      const want = expected[position];
      if (want === null || Number.isNaN(want)) expect(Number.isNaN(rolling[index])).toBe(true);
      else close(rolling[index], want, 1e-10);
    });
  });

  it("Kruskal-Wallis with ties", () => {
    const xr = EXPECTED.xr as number[];
    const result = kruskalWallis([xr.slice(0, 130), xr.slice(130, 270), xr.slice(270)]);
    close(result.h, EXPECTED.kruskal.h);
    close(result.pValue, EXPECTED.kruskal.p);
    expect(result.degreesOfFreedom).toBe(2);
  });

  it("chi-square survival for 2, 4 and 5 degrees of freedom", () => {
    for (const [key, want] of Object.entries(EXPECTED.chi2_sf as Record<string, number>)) {
      const [df, value] = key.split("|").map(Number) as [number, number];
      close(chiSquareSurvival(value, df), want, 1e-9);
    }
  });

  it("the normal quantile used for the Q-Q abscissae", () => {
    for (const [probability, want] of Object.entries(EXPECTED.norm_ppf as Record<string, number>)) {
      close(normalQuantile(Number(probability)), want, 5e-9);
    }
  });

  it("probplot: Filliben positions and the least-squares line", () => {
    const sample = [...x.slice(0, 50)].sort((a, b) => a - b);
    const positions = fillibenPositions(50);
    const theoretical = Array.from(positions, normalQuantile);
    EXPECTED.probplot50.osm.forEach((want: number, index: number) => close(theoretical[index], want, 5e-9));
    const line = leastSquaresLine(theoretical, sample);
    close(line.slope, EXPECTED.probplot50.slope, 1e-7);
    close(line.intercept, EXPECTED.probplot50.intercept, 1e-7);
    close(line.correlation, EXPECTED.probplot50.r, 1e-7);
  });
});

describe("walk-forward folds and direction labels match the notebook's libraries", () => {
  it("has the same 44,162 bars the Python built", () => {
    expect(BARS.times.length).toBe(EXPECTED.bars.n);
    expect(BARS.close.slice(0, 5)).toEqual(EXPECTED.closes_head);
  });

  it("generate_folds, line for line, for three configurations", () => {
    for (const [key, folds] of Object.entries(EXPECTED.folds as Record<string, number[][]>)) {
      const [foldMonths, purge, minTrain] = key.split("|").map(Number) as [number, number, number];
      const got = walkForwardFolds(BARS.times, foldMonths, purge, minTrain).map((fold) => [fold.fold, fold.trainStart, fold.trainEnd, fold.testStart, fold.testEnd]);
      expect(got).toEqual(folds);
      expect(got.length).toBeGreaterThan(0);
    }
  });

  it("generate_direction_labels counts: up, down and flat", () => {
    for (const [key, counts] of Object.entries(EXPECTED.labels as Record<string, number[]>)) {
      const [horizon, threshold] = key.split("|").map(Number) as [number, number];
      const got = directionLabelCounts(BARS.close, horizon, threshold);
      expect([got.up, got.down, got.flat]).toEqual(counts);
    }
  });
});

// ── the handler on a fake lake ───────────────────────────────────────────────

describe("the handler", () => {
  it("names every view it reads, both sources of every timeframe and the landed tests", () => {
    expect(handler.datasets).toContain("mnq_ohlcv_30m");
    expect(handler.datasets).toContain("ohlcv_30m");
    expect(handler.datasets).toContain("ohlcv_1h_v");
    expect(handler.datasets).toContain("derived_study_mnq_eda_30m_stationarity_tests");
    expect(viewFor("notebook", "1h")).toBe("ohlcv_1h_v");
    expect(viewFor("full", "4h")).toBe("mnq_ohlcv_4h");
  });

  it("refuses a section, timeframe or number outside its schema", () => {
    expect(() => querySchema.parse({ section: "nope" })).toThrow();
    expect(() => querySchema.parse({ timeframe: "1m" })).toThrow();
    expect(() => querySchema.parse({ lags: 5000 })).toThrow();
    expect(() => querySchema.parse({ confidencePercent: 97 })).toThrow();
    expect(querySchema.parse({}).section).toBe("summary");
  });

  it("answers unavailable with a note when the view is not in the lake", async () => {
    const { body, notes } = await run({ section: "returns" }, fakeLake([]));
    expect(body).toEqual({ unavailable: true });
    expect(notes[0]).toContain("mnq_ohlcv_30m");
  });

  it("reads the bars once for every section and serves slider drags from memory", async () => {
    const lake = fakeLake();
    queryCount = 0;
    await run({ section: "tensor", tensorWindow: 16 }, lake);
    const afterFirst = queryCount;
    await run({ section: "tensor", tensorWindow: 24 }, lake);
    await run({ section: "labels", horizon: 2 }, lake);
    expect(afterFirst).toBe(1);
    expect(queryCount).toBe(1);
  });

  it("returns: the moments, the normality test, a histogram that accounts for every return and a Q-Q line", async () => {
    const { body } = await run({ section: "returns", histogramBins: 50 });
    expect(body.moments.count).toBe(BARS.times.length - 1);
    expect(body.histogram).toHaveLength(50);
    const inBins = body.histogram.reduce((sum: number, bin: { count: number }) => sum + bin.count, 0);
    expect(inBins).toBe(body.moments.count);
    expect(body.qq.theoretical.length).toBe(body.qq.sample.length);
    expect(body.qq.pointCount).toBe(body.moments.count);
    expect(body.qq.theoretical[0]).toBeLessThan(body.qq.theoretical[body.qq.theoretical.length - 1]);
    expect(body.normality.pValue).toBeGreaterThanOrEqual(0);
    const core = (await run({ section: "returns", histogramRange: "core" })).body;
    expect(core.histogramRange.clippedCount).toBeGreaterThan(0);
  });

  it("autocorrelation: lag 0 is one and the band is z over root n", async () => {
    const { body } = await run({ section: "autocorrelation", lags: 12, confidencePercent: 95 });
    expect(body.autocorrelation).toHaveLength(13);
    expect(body.autocorrelation[0]).toBe(1);
    close(body.band, 1.96 / Math.sqrt(BARS.times.length - 1), 1e-12);
    const wide = (await run({ section: "autocorrelation", lags: 12, confidencePercent: 99 })).body;
    expect(wide.band).toBeGreaterThan(body.band);
  });

  it("volatility: threshold, high-volatility count, last value and overall match pandas", async () => {
    const { body } = await run({ section: "volatility", shortWindowDays: 2, longWindowDays: 4, highVolatilityPercentile: 0.75 });
    expect(body.barsPerDayUsed).toBe(48);
    close(body.highVolatilityThresholdPercent, EXPECTED.vol.thr75, 1e-9);
    expect(body.highVolatilityBarCount).toBe(EXPECTED.vol.high);
    close(body.shortLastPercent, EXPECTED.vol.last, 1e-9);
    close(body.overallAnnualisedPercent, EXPECTED.vol.overall, 1e-9);
    expect(body.series.time.length).toBe(body.series.short.length);
    expect(body.series.short[0]).toBeNull();
  });

  it("weekday: count, mean and sample standard deviation per day and the Kruskal-Wallis test", async () => {
    const { body } = await run({ section: "weekday" });
    const byIndex = new Map(body.rows.map((row) => [row.dayIndex, row]));
    for (const [pandasDay, [mean, std, count]] of Object.entries(EXPECTED.dow as unknown as Record<string, [number, number | null, number]>)) {
      const dayIndex = (Number(pandasDay) + 1) % 7; // pandas Monday = 0, JavaScript Sunday = 0
      const row = defined(byIndex.get(dayIndex));
      expect(row.count).toBe(count);
      close(row.mean, mean, 1e-9);
      if (std !== null) close(row.standardDeviation, std, 1e-9);
    }
    close(body.kruskalWeekdays.h, EXPECTED.dow_kw[0]);
    close(body.kruskalWeekdays.pValue, EXPECTED.dow_kw[1]);
    close(body.kruskalAllDays.h, EXPECTED.dow_kw_all[0]);
    expect(body.kruskalAllDays.groupCount).toBe(6);
    const session = (await run({ section: "weekday", dayBasis: "session" })).body;
    expect(session.rows.find((row) => row.dayIndex === 0)).toBeUndefined();
  });

  it("tensor: the window's channels, the zero first row, the clamp and per-channel statistics", async () => {
    const { body } = await run({ section: "tensor", tensorWindow: 32 });
    expect(body.values).toHaveLength(32);
    expect(body.values[0]).toEqual([0, 0, 0, 0, 0]);
    body.values[31].forEach((value: number, channel: number) => close(value, EXPECTED.tensor_last32.last[channel], 1e-6));
    body.perChannel.forEach((channel, index) => {
      close(channel.mean, EXPECTED.tensor_last32.mean[index], 1e-6);
      close(channel.standardDeviation, EXPECTED.tensor_last32.std[index], 1e-6);
    });
    close(body.minimum, EXPECTED.tensor_last32.min, 1e-6);
    close(body.maximum, EXPECTED.tensor_last32.max, 1e-6);
    const early = (await run({ section: "tensor", tensorWindow: 8, tensorPosition: 0 })).body;
    expect(early.endIndex).toBe(0);
    const clamped = (await run({ section: "tensor", tensorWindow: 200, tensorClamp: 0.5 })).body;
    expect(clamped.maximum).toBeLessThanOrEqual(0.5);
  });

  it("labels: the notebook's five configurations plus the chosen one, and the change histogram", async () => {
    const { body } = await run({ section: "labels", horizon: 4, flatThresholdPoints: 7.25 });
    expect(body.configs.filter((row) => row.notebook)).toHaveLength(5);
    const custom = defined(body.configs.find((row) => !row.notebook));
    expect([custom.up, custom.down, custom.flat]).toEqual(EXPECTED.labels["4|7.25"]);
    close(custom.upShare, EXPECTED.labels["4|7.25"][0] / (EXPECTED.labels["4|7.25"][0] + EXPECTED.labels["4|7.25"][1]), 1e-12);
    const binned = body.deltaHistogram.up.reduce((a: number, b: number) => a + b, 0) + body.deltaHistogram.down.reduce((a: number, b: number) => a + b, 0);
    expect(binned + body.deltaHistogram.outsideCount).toBe(custom.usable);
    expect(body.deltaHistogram.outsideCount).toBeGreaterThan(0);
    const notebookOnly = (await run({ section: "labels", horizon: 1, flatThresholdPoints: 20.5 })).body;
    expect(notebookOnly.configs).toHaveLength(5);
  });

  it("folds: the planner's indices, dates, counts, purge and overlap", async () => {
    const { body } = await run({ section: "folds", foldMonths: 6, purgeBars: 100, minTrainMonths: 12 });
    expect(body.folds.map((fold) => [fold.fold, fold.trainStartIndex, fold.trainEndIndex, fold.testStartIndex, fold.testEndIndex])).toEqual(EXPECTED.folds["6|100|12"]);
    const first = body.folds[0];
    expect(first.trainCount).toBe(first.trainEndIndex - first.trainStartIndex);
    expect(first.purgedBars).toBe(first.testStartIndex - first.trainEndIndex);
    expect(first.purgedBars).toBe(101);
    expect(first.trainEnd).toBe(BARS.times[first.trainEndIndex - 1]);
    // adjacent test windows share the boundary day's bars
    expect(body.folds[0].overlapWithNext).toBeGreaterThan(0);
    expect(body.folds[body.folds.length - 1].overlapWithNext).toBe(0);
    const none = (await run({ section: "folds", minTrainMonths: 60 })).body;
    expect(none.folds).toEqual([]);
  });

  it("price: a window of candles, daily buckets by trading session, a bucket no finer than the bar stays native", async () => {
    const native = (await run({ section: "price", priceBars: 100 })).body;
    expect(native.candles.time).toHaveLength(100);
    expect(native.windowEndIndex).toBe(BARS.times.length - 1);
    expect(native.candles.time[99]).toBe((BARS.times[BARS.times.length - 1] as number) / 1000);
    const daily = (await run({ section: "price", priceBucket: "1d", priceBars: 3000 })).body;
    expect(daily.bucket).toBe("1d");
    expect(daily.bucketCount).toBeLessThan(BARS.times.length / 30);
    expect(daily.candles.high.every((value: number, i: number) => value >= daily.candles.low[i])).toBe(true);
    const volume = daily.candles.volume.reduce((a: number, b: number) => a + b, 0);
    expect(volume).toBe(BARS.volume.reduce((a, b) => a + b, 0));
    const finer = (await run({ section: "price", timeframe: "30m", priceBucket: "1h", priceBars: 50 })).body;
    expect(finer.bucket).toBe("1h");
    const scrubbed = (await run({ section: "price", priceBars: 100, pricePosition: 0 })).body;
    expect(scrubbed.windowEndIndex).toBe(0);
  });

  it("columns: every frame's columns with the eight numbers and a histogram that counts every value", async () => {
    const { body } = await run({ section: "columns" });
    const names = body.columns.map((column) => column.name);
    expect(names).toEqual(expect.arrayContaining(["open", "high", "low", "close", "volume", "log_return", "open_log_change", "volume_log_change", "rolling_volatility_short_percent", "next_bar_close_change_points"]));
    for (const column of body.columns) {
      const counted = column.histogram.counts.reduce((a: number, b: number) => a + b, 0);
      expect(counted).toBe(column.moments.count);
      expect(column.histogram.upper).toBeGreaterThan(column.histogram.lower);
    }
    const closeColumn = defined(body.columns.find((column) => column.name === "close"));
    expect(closeColumn.moments.count).toBe(BARS.times.length);
  });

  it("stationarity reads the landed tests for the chosen source and timeframe", async () => {
    const { body } = await run({ section: "stationarity", source: "full", timeframe: "30m" });
    expect(body.rows).toHaveLength(2);
    expect(body.rows[1].p_value_is_table_edge).toBe(true);
    const absent = await run({ section: "stationarity" }, fakeLake(["mnq_ohlcv_30m"]));
    expect(absent.body).toEqual({ unavailable: true });
    expect(absent.notes[0]).toContain("derived_study_mnq_eda_30m_stationarity_tests");
  });

  it("summary: the headline numbers, both sources' bar counts and the landed p-values", async () => {
    const { body } = await run({ section: "summary" });
    expect(body.series?.barCount).toBe(BARS.times.length);
    expect(body.sources.map((row) => row.source)).toEqual(["full", "notebook"]);
    expect(body.sources[1].barCount).toBe(0);
    close(body.upShareHorizonOne, EXPECTED.labels["1|0.0"][0] / (EXPECTED.labels["1|0.0"][0] + EXPECTED.labels["1|0.0"][1]), 1e-12);
    close(body.dayOfWeekKruskalP, EXPECTED.dow_kw[1]);
    expect(body.adfReturnsP).toBe(0);
    expect(body.kpssReturnsP).toBe(0.1);
    expect(body.lagOneSquaredAutocorrelation).not.toBeNull();
  });
});
