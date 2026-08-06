import * as single from './single_bar';
import * as double from './double_bar';
import * as triple from './triple_bar';
import * as complex from './complex';
import { Bar } from './helpers';

export interface PatternDetector {
  name: string;
  displayName: string;
  detect: (bars: Bar[], index: number) => number;
}

export const PATTERN_DETECTORS: PatternDetector[] = [
  // Single-bar
  { name: 'CDL_DOJI', displayName: 'Doji', detect: single.detectDoji },
  { name: 'CDL_DRAGONFLY_DOJI', displayName: 'Dragonfly Doji', detect: single.detectDragonflyDoji },
  { name: 'CDL_GRAVESTONE_DOJI', displayName: 'Gravestone Doji', detect: single.detectGravestoneDoji },
  { name: 'CDL_LONGLEGGED_DOJI', displayName: 'Long Legged Doji', detect: single.detectLongLeggedDoji },
  { name: 'CDL_HAMMER', displayName: 'Hammer', detect: single.detectHammer },
  { name: 'CDL_INVERTED_HAMMER', displayName: 'Inverted Hammer', detect: single.detectInvertedHammer },
  { name: 'CDL_SHOOTING_STAR', displayName: 'Shooting Star', detect: single.detectShootingStar },
  { name: 'CDL_HANGING_MAN', displayName: 'Hanging Man', detect: single.detectHangingMan },
  { name: 'CDL_MARUBOZU', displayName: 'Marubozu', detect: single.detectMarubozu },
  { name: 'CDL_SPINNING_TOP', displayName: 'Spinning Top', detect: single.detectSpinningTop },
  { name: 'CDL_HIGH_WAVE', displayName: 'High Wave', detect: single.detectHighWave },
  { name: 'CDL_CLOSINGMARUBOZU', displayName: 'Closing Marubozu', detect: single.detectClosingMarubozu },
  { name: 'CDL_LONGLINE', displayName: 'Long Line', detect: single.detectLongLine },
  { name: 'CDL_SHORTLINE', displayName: 'Short Line', detect: single.detectShortLine },
  { name: 'CDL_RICKSHAWMAN', displayName: 'Rickshaw Man', detect: single.detectRickshawMan },
  { name: 'CDL_TAKURI', displayName: 'Takuri', detect: single.detectTakuri },
  { name: 'CDL_BELTHOLD', displayName: 'Belt Hold', detect: single.detectBeltHold },
  
  // Two-bar
  { name: 'CDL_ENGULFING_BULL', displayName: 'Bullish Engulfing', detect: double.detectBullishEngulfing },
  { name: 'CDL_ENGULFING_BEAR', displayName: 'Bearish Engulfing', detect: double.detectBearishEngulfing },
  { name: 'CDL_HARAMI_BULL', displayName: 'Bullish Harami', detect: double.detectBullishHarami },
  { name: 'CDL_HARAMI_BEAR', displayName: 'Bearish Harami', detect: double.detectBearishHarami },
  { name: 'CDL_PIERCING', displayName: 'Piercing Line', detect: double.detectPiercingLine },
  { name: 'CDL_DARK_CLOUD', displayName: 'Dark Cloud Cover', detect: double.detectDarkCloudCover },
  { name: 'CDL_TWEEZER_TOP', displayName: 'Tweezer Top', detect: double.detectTweezerTop },
  { name: 'CDL_TWEEZER_BOTTOM', displayName: 'Tweezer Bottom', detect: double.detectTweezerBottom },
  { name: 'CDL_DOJISTAR', displayName: 'Doji Star', detect: double.detectDojiStar },
  { name: 'CDL_COUNTERATTACK', displayName: 'Counterattack', detect: double.detectCounterattack },
  { name: 'CDL_HOMINGPIGEON', displayName: 'Homing Pigeon', detect: double.detectHomingPigeon },
  { name: 'CDL_MATCHINGLOW', displayName: 'Matching Low', detect: double.detectMatchingLow },
  { name: 'CDL_KICKING', displayName: 'Kicking', detect: double.detectKicking },
  { name: 'CDL_KICKINGBYLENGTH', displayName: 'Kicking By Length', detect: double.detectKickingByLength },
  { name: 'CDL_INNECK', displayName: 'In-Neck', detect: double.detectInNeck },
  { name: 'CDL_ONNECK', displayName: 'On-Neck', detect: double.detectOnNeck },
  { name: 'CDL_SEPARATINGLINES', displayName: 'Separating Lines', detect: double.detectSeparatingLines },
  { name: 'CDL_GAPSIDESIDEWHITE', displayName: 'Gap Side-by-Side White', detect: double.detectGapSideSideWhite },

  // Three-bar
  { name: 'CDL_MORNING_STAR', displayName: 'Morning Star', detect: triple.detectMorningStar },
  { name: 'CDL_EVENING_STAR', displayName: 'Evening Star', detect: triple.detectEveningStar },
  { name: 'CDL_3WHITE_SOLDIERS', displayName: 'Three White Soldiers', detect: triple.detectThreeWhiteSoldiers },
  { name: 'CDL_3BLACK_CROWS', displayName: 'Three Black Crows', detect: triple.detectThreeBlackCrows },
  { name: 'CDL_3INSIDE_UP', displayName: 'Three Inside Up', detect: triple.detectThreeInsideUp },
  { name: 'CDL_3INSIDE_DOWN', displayName: 'Three Inside Down', detect: triple.detectThreeInsideDown },
  { name: 'CDL_2CROWS', displayName: 'Two Crows', detect: triple.detect2Crows },
  { name: 'CDL_3OUTSIDE', displayName: 'Three Outside Up/Down', detect: triple.detect3Outside },
  { name: 'CDL_MORNINGDOJISTAR', displayName: 'Morning Doji Star', detect: triple.detectMorningDojiStar },
  { name: 'CDL_EVENINGDOJISTAR', displayName: 'Evening Doji Star', detect: triple.detectEveningDojiStar },
  { name: 'CDL_IDENTICAL3CROWS', displayName: 'Identical Three Crows', detect: triple.detectIdentical3Crows },
  { name: 'CDL_ADVANCEBLOCK', displayName: 'Advance Block', detect: triple.detectAdvanceBlock },
  { name: 'CDL_STALLEDPATTERN', displayName: 'Stalled Pattern', detect: triple.detectStalledPattern },
  { name: 'CDL_STICKSANDWICH', displayName: 'Stick Sandwich', detect: triple.detectStickSandwich },
  { name: 'CDL_3STARSINSOUTH', displayName: 'Three Stars in the South', detect: triple.detect3StarsInSouth },
  { name: 'CDL_TASUKIGAP', displayName: 'Tasuki Gap', detect: triple.detectTasukiGap },

  // Four-bar
  { name: 'CDL_3LINESTRIKE', displayName: 'Three Line Strike', detect: complex.detect3LineStrike },
  { name: 'CDL_CONCEALBABYSWALL', displayName: 'Concealing Baby Swallow', detect: complex.detectConcealBabySwallow },
  { name: 'CDL_HIKKAKE', displayName: 'Hikkake', detect: complex.detectHikkake },
  { name: 'CDL_HIKKAKEMOD', displayName: 'Modified Hikkake', detect: complex.detectHikkakeMod },

  // Five-bar
  { name: 'CDL_ABANDONEDBABY', displayName: 'Abandoned Baby', detect: complex.detectAbandonedBaby },
  { name: 'CDL_BREAKAWAY', displayName: 'Breakaway', detect: complex.detectBreakaway },
  { name: 'CDL_LADDERBOTTOM', displayName: 'Ladder Bottom', detect: complex.detectLadderBottom },
  { name: 'CDL_MATHOLD', displayName: 'Mat Hold', detect: complex.detectMatHold },
  { name: 'CDL_RISEFALL3METHODS', displayName: 'Rising/Falling Three Methods', detect: complex.detectRiseFall3Methods },
];
