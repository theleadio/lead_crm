// Where a scatter label goes so it does not sit on another label, on a point
// or on the x-axis figures. Placement only: the mark itself never moves.
//
// A label is a box from where its text starts (`x`) to about `chars`
// characters on, one line tall above its baseline. One that would clash is
// moved a line at a time, down first, then up, at most MAX_STEPS lines, never
// below `floor` (the last baseline clear of the axis figures) and never above
// `ceiling`. Moved any further, a label reads as belonging to another point,
// so it is left off (null): the point keeps its hover text and the table
// under the chart names every campaign.

// 10px text in the report's font measures about 5.8 user units a character;
// 5.2 under-measured long campaign names, which is how two of them overlapped.
export const LABEL_CHAR = 5.8;
export const LABEL_LINE = 12;
export const MAX_STEPS = 2;

export type Box = { left: number; right: number; top: number; bottom: number };

const overlaps = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// `points` are the marks a label must not cover, as boxes.
export function labelSlots(
  bounds: { floor: number; ceiling: number },
  points: Box[] = [],
) {
  const taken: Box[] = [...points];
  // The baseline offset from the label's own baseline (`y`), or null when
  // there is no room near its point. Call in order of importance: earlier
  // labels keep their place.
  return (x: number, y: number, chars: number): number | null => {
    const box = (dy: number): Box => ({
      left: x,
      right: x + chars * LABEL_CHAR,
      top: y + dy - LABEL_LINE + 3,
      bottom: y + dy + 2,
    });
    const free = (dy: number) =>
      y + dy <= bounds.floor &&
      y + dy - LABEL_LINE >= bounds.ceiling &&
      !taken.some((t) => overlaps(t, box(dy)));
    for (let step = 0; step <= MAX_STEPS; step++) {
      for (const dy of step === 0
        ? [0]
        : [step * LABEL_LINE, -step * LABEL_LINE]) {
        if (free(dy)) {
          taken.push(box(dy));
          return dy;
        }
      }
    }
    return null;
  };
}
