/** One figure stands for this many men, rounded up, so a formation with any men left shows one. */
export const MEN_PER_FIGURE = 50;
/**
 * The most figures one formation shows. A recruited formation of 1,000 men shows 20 and
 * the starting 1,200 spearmen 24; above 1,500 men a block keeps its size, so the cost of
 * a hundred armies in view stays bounded.
 */
export const FIGURE_CAP = 30;

export function figuresFor(men: number): number {
  if (men <= 0) return 0;
  return Math.min(FIGURE_CAP, Math.ceil(men / MEN_PER_FIGURE));
}
