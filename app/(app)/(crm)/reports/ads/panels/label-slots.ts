// Where a scatter label goes so it does not sit on another label, on a point,
// on a guide label, on the x-axis figures or off the chart. Placement only:
// the mark itself never moves.
//
// A label is a box one line tall, about `chars` characters wide, on the
// right of its point or, failing that, on the left. One that would clash is
// moved a line at a time, down first, then up, at most MAX_STEPS lines, and
// must stay inside `bounds`: `floor` is the last baseline clear of the axis
// figures, `ceiling` the plot's top. With no room within those lines it is
// left off (null): the point keeps its hover text and the table under the
// chart names every campaign. A moved label can still end up beside an
// unlabelled point; two lines is the limit that keeps that rare and the
// label near its own.

// 10px text in the report's font measures about 5.8 user units a character;
// 5.2 under-measured long campaign names, which is how two of them overlapped.
export const LABEL_CHAR = 5.8;
export const LABEL_LINE = 12;
export const MAX_STEPS = 2;

export type Box = { left: number; right: number; top: number; bottom: number };
export type Slot = { side: "right" | "left"; dy: number };

const overlaps = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// The box a line of text takes at baseline `y`, from `left` to `right`.
export const textBox = (left: number, right: number, y: number): Box => ({
  left,
  right,
  top: y - LABEL_LINE + 3,
  bottom: y + 2,
});

// `taken` are boxes a label must not cover: the points and any fixed text.
export function labelSlots(
  bounds: { floor: number; ceiling: number; left: number; right: number },
  taken: Box[] = [],
) {
  const used: Box[] = [...taken];
  // `at.right` is where text starts on the right of the point, `at.left`
  // where it ends on the left; `y` is the label's own baseline. Call in
  // order of importance: earlier labels keep their place.
  return (
    at: { right: number; left: number },
    y: number,
    chars: number,
  ): Slot | null => {
    const width = chars * LABEL_CHAR;
    const box = (side: Slot["side"], dy: number) =>
      side === "right"
        ? textBox(at.right, at.right + width, y + dy)
        : textBox(at.left - width, at.left, y + dy);
    const free = (side: Slot["side"], dy: number) => {
      const b = box(side, dy);
      return (
        y + dy <= bounds.floor &&
        b.top >= bounds.ceiling &&
        b.left >= bounds.left &&
        b.right <= bounds.right &&
        !used.some((t) => overlaps(t, b))
      );
    };
    for (let step = 0; step <= MAX_STEPS; step++) {
      for (const side of ["right", "left"] as const) {
        for (const dy of step === 0
          ? [0]
          : [step * LABEL_LINE, -step * LABEL_LINE]) {
          if (free(side, dy)) {
            used.push(box(side, dy));
            return { side, dy };
          }
        }
      }
    }
    return null;
  };
}
